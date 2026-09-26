# Identity Management Service — Security Model

IMS is the platform's authority for identity and authorization data, so its own protections matter as much as the decisions it serves. This page describes, as implemented in version 0.1.0, how callers authenticate, how IMS authorizes its own API, how realms are isolated, how sign-in sessions and tokens work, and how a new installation is bootstrapped.

## Authentication Surfaces

IMS serves four kinds of caller:

| Surface | Paths | How the caller authenticates |
|---------|-------|------------------------------|
| Management API | `/v1/principals*`, `/v1/groups*`, `/v1/roles*`, `/v1/role-assignment*`, `/v1/permissions*`, `/v1/realms*`, `/v1/audit-log` | Service API key in the `X-API-Key` header |
| Policy decision | `/v1/check`, `/v1/check-batch` | **None** (see [below](#the-policy-decision-endpoint)) |
| OpenID Provider | `/realms/{realm}/...` | Browser sign-in (email link + MFA) for end users; client authentication at the token endpoint for confidential clients |
| Probes | `/`, `/health`, `/ready`, `/status` | None |

### Service API keys

A service API key is an opaque secret held by a calling service. IMS never stores the key itself: it stores the SHA-256 digest as an external identity with the reserved source `ims-internal-api-key`, bound to the caller's own principal (normally a `ServiceAccount`). On each management request IMS:

1. Hashes the `X-API-Key` value and looks up the bound principal in the target realm (see [Realm isolation](#realm-isolation)).
2. Rejects the request with **401** if the header is missing, the key is unknown, or the bound principal is `deprovisioned`.
3. Evaluates the permission the route requires against that principal. A recognized caller without the permission gets **403** `FORBIDDEN`, and a `permission.denied` audit row is written.

The management API does not accept bearer tokens in place of an API key.

Treat API keys like passwords: generate them with a cryptographically secure random source (at least 32 bytes), deliver them through Kubernetes Secrets or a secret manager, and never place them in values files, images, or logs. To retire a key, deprovision its principal (`PUT /v1/principals/{id}` with `status: "deprovisioned"`) or unlink the key identity; either takes effect on the next request.

## IMS's Own Authorization

Every management route is gated by an IMS permission, evaluated with the same engine that powers `/v1/check`. The `resource` for these internal checks is always the literal string `ims`.

| Permission (`action`) | Grants |
|-----------------------|--------|
| `ims:ensure-principal` | `POST /v1/principals/ensure` |
| `ims:manage-principals` | Create, read, update, delete principals; invite, read, enable, disable realm users; revoke sessions. Also required (with `ims:link-external-identity`) to unlink an identity |
| `ims:manage-groups` | Group CRUD, membership, and group–permission mappings (including reads) |
| `ims:manage-roles` | Role CRUD and role–permission mappings (including reads) |
| `ims:manage-role-assignments` | Role assignment CRUD (including reads) and fenced role handoffs |
| `ims:manage-permissions` | Permission CRUD (including reads) |
| `ims:grant-global` | Additionally required to create or update a permission or role assignment with `environment_scope: null` (global) |
| `ims:link-external-identity` | Link a new external identity onto a principal (subject to proof of control) |
| `ims:manage-api-keys` | Additionally required to link an identity with source `ims-internal-api-key` (that is, to mint a callable API key binding) |
| `ims:read-external-identities` | List a principal's external identities |
| `ims:read-audit-log` | `GET /v1/audit-log` |
| `ims:manage-realms` | Create, list, read, and update realms; register OIDC clients |
| `ims:reset-mfa` | Reset a realm user's MFA enrolment |

Design notes that matter when you grant these:

- **Reads are gated too.** Listing groups, roles, permissions, role assignments, or principals needs the corresponding `ims:manage-*` permission. Unscoped reads are authorized in the `default` realm rather than served anonymously.
- **Wildcards apply.** Permission patterns are glob-matched, so an allow of `ims:*` on `ims` (or `*` on `*`) grants **every** row above, including `ims:grant-global` and `ims:manage-api-keys`. Grant exact action names to service principals.
- **Deny wins.** An explicit deny (for example `ims:grant-global` denied to a group of operators) overrides any allow from any source.
- **Link reads are separate from link writes.** `ims:read-external-identities` is deliberately distinct from `ims:link-external-identity`, so a caller that can link cannot harvest another principal's identifiers to forge link evidence.
- **Internal checks ignore environment scope**, except for the role handoff endpoints, which authorize against the exact `environment_scope` in the request body.

## Realm Isolation

Every row IMS stores is owned by one realm, and every query filters by realm. Foreign keys include the realm, so a group in one realm cannot contain a principal from another, and a role in one realm cannot carry another realm's permissions.

### Selecting a realm

Management requests select a realm with a `realm` field in the JSON body or a `realm` query parameter (realm-admin routes use the realm in the URL path). The rules:

- A body selector and a query selector that disagree → **400**. A selector that disagrees with the URL path realm → **400**. An empty selector → **400**.
- **Mutations require a realm selector** (400 `a realm selector is required` without one). Reads without a selector use the `default` realm.
- The realm validated during authorization is the one the handler uses for the mutation; a request cannot be authorized in one realm and applied to another.
- An unknown realm name is treated as an authentication failure for the caller (401) or `REALM_NOT_FOUND` (404) on other paths.

### Cross-realm authority

When a request targets realm *R*, IMS first looks for the API key's binding **in R**. If found, the caller is a realm-local administrator and is authorized with its grants in R. If not found, IMS falls back to a binding in the **`default` realm** and authorizes with the caller's grants there. A key bound only in some other realm cannot cross into R.

The consequence: **`ims:*` grants held in the `default` realm are platform-wide authority over every realm.** Keep the set of principals with management grants in the `default` realm small, and give per-application administrators keys and grants inside their own realm instead.

## External Identity Linking

`POST /v1/principals/{id}/external-identities` can merge a new identity into an existing principal — the operation most likely to cause an account takeover if abused. IMS applies a denied-by-default protocol:

1. The caller must hold `ims:link-external-identity` (plus `ims:manage-api-keys` when linking an `ims-internal-api-key` identity).
2. The body must include `proof_of_control` with two attestations:
   - `subject_auth` — names exactly the identity being linked (same `source`, `external_value`, and `environment_scope`) and carries a fresh-authentication attestation (`method` and `authenticated_at`)
   - `target_evidence` — names an identity **already bound to the target principal**, with its own fresh-authentication attestation
3. IMS verifies that `target_evidence` resolves to the target principal and that the principal is `active`.
4. If the new identity already belongs to a **different** principal, the request fails with 409 and nothing is re-pointed. If it already belongs to the target, the call is an idempotent 200 with no audit row.

Every rejection after the caller is identified is written to the audit log as `external-identity.link-denied`, and every successful link records the full proof envelope. IMS records the attestations but cannot cryptographically verify them; the calling identity broker is responsible for having actually performed the authentications it attests. Restrict `ims:link-external-identity` to that broker's principal.

Unlinking requires both `ims:link-external-identity` and `ims:manage-principals`, and the audit row retains the removed identity so the operation can be reversed.

## The Policy Decision Endpoint

`POST /v1/check` and `POST /v1/check-batch` do **not** authenticate callers. Anyone who can reach them can ask whether any principal ID is allowed any action. Protect them at the network layer:

- Keep IMS on a `ClusterIP` Service (the chart default) and do not route `/v1/*` through a public ingress.
- If IMS must be reachable from outside the cluster for OIDC sign-in, expose only the `/realms/` path prefix.
- Use Kubernetes NetworkPolicies (or your gateway's ACLs) to limit which workloads can call `/v1/check`.

To bound audit-log growth from anonymous callers, only decisions made by an explicit deny rule are audited (`check.deny`); default-deny results are not. A batch is limited to 100 checks.

## Token and Session Model

Each realm is a separate OpenID Provider with issuer `{IMS_PUBLIC_URL}/realms/{realm}`. Discovery is served at `{issuer}/.well-known/openid-configuration`.

### Flows and clients

- **Authorization code flow only** (`response_type=code`), with **PKCE S256 required for every client**, public or confidential. Requests without a code challenge, or with the `plain` method, are rejected and audited (`authorize.reject`).
- **Refresh tokens** — the `refresh_token` grant is enabled for every client; request the `offline_access` scope to obtain one.
- **Not enabled**: device authorization flow (a realm policy cannot turn it on), client credentials grant, dynamic client registration, and the development-only interaction pages.
- **Clients** are registered per realm by an administrator. Public clients use `token_endpoint_auth_method: "none"`; confidential clients use `client_secret_basic` or `client_secret_post`. Redirect URIs must be exact `https://` URIs or `http://` loopback URIs (`127.0.0.1`, `localhost`, `::1`), with no wildcards, fragments, or embedded credentials.
- A confidential client's secret is generated by IMS and returned **once**, in the create response. IMS keeps only a salted scrypt hash plus an AES-256-GCM envelope (bound to the realm and client ID) encrypted under `IMS_CREDENTIAL_KEY`.

### Tokens and claims

| Artifact | Format |
|----------|--------|
| ID token | JWT signed with the key set supplied in `IMS_OIDC_JWKS` |
| Access token | Opaque; validate by introspection |
| Refresh token | Opaque |

Claims by scope:

| Scope | Claims |
|-------|--------|
| `openid` | `sub` (the principal ID), `acr`, `amr` |
| `email` | `email`, `email_verified` |
| `profile` | `realm` |

`acr` is `urn:firefoundry:acr:mfa` when the user completed a second factor, otherwise `urn:firefoundry:acr:email`. `amr` lists the methods used: `email`, `otp`, `recovery`, and `mfa` when two or more factors were used.

### Admin API audience and introspection

IMS recognizes exactly one protected resource, the Admin API (resource indicator from `IMS_ADMIN_API_RESOURCE`, default `urn:firefoundry:admin-api`), with scopes `admin:environments:read` and `admin:environments:write`. A client must be registered with those scopes before it can request them, and any other `resource=` value is rejected. Tokens from a grant that carries the admin resource are not accepted by the userinfo endpoint; use the ID token for user claims.

Token introspection (RFC 7662) is available only to **confidential** clients whose IDs appear in `IMS_INTROSPECTION_CLIENT_IDS`. With the variable unset, no client can introspect.

### Sessions, lifetimes, and revocation

- A realm's `session_ttl_seconds` (default 8 hours, minimum 300) sets both the browser session and grant lifetime. `magic_link_ttl_seconds` (default 15 minutes, minimum 60) bounds the sign-in interaction and email link.
- Sessions, grants, codes, and tokens are stored in PostgreSQL (`ims.oidc_model`), so they survive restarts.
- Session cookies are signed with `IMS_OIDC_COOKIE_KEY` and scoped to the realm's path.
- When a realm requires MFA, a session that was established without MFA does not satisfy a new authorization request; the user must complete MFA.
- Each local account has an **authentication generation**. Stored OIDC artifacts record the generation they were issued under and are refused once it changes. Disabling an account, revoking its sessions, or resetting its MFA increments the generation and deletes the account's stored OIDC artifacts, so existing sessions and refresh tokens stop working.
- RP-initiated logout is enabled at the realm's end-session endpoint.

## Native Sign-in Protections

The sign-in pages at `/realms/{realm}/interaction/...` add these controls:

- **No account enumeration** — submitting an email always leads to the same "check your email" page, whether or not an account exists.
- **One-time, browser-bound links** — the email link token is random, stored only as a hash, expires with the interaction, and is valid only in the browser that started the sign-in (bound through an HTTP-only cookie).
- **CSRF protection** on every form, with tokens rotated after each step.
- **Rate limiting** per email or account and per client address over a 15-minute window, returning 429. Set `IMS_TRUST_PROXY_HOPS` correctly so the client address is the real one (see [Operations](./operations.md#configuration)).
- **TOTP** — secrets are encrypted with AES-256-GCM under `IMS_CREDENTIAL_KEY`; a code's time step cannot be reused.
- **Recovery codes** — eight single-use codes are shown once at enrolment, must be acknowledged before enrolment completes, and are stored only as salted hashes.
- Responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Secrets and Keys

| Secret | Purpose | Notes |
|--------|---------|-------|
| `IMS_CREDENTIAL_KEY` | 32-byte AES key (base64) that encrypts TOTP secrets, confidential client secrets, and pending sign-in state | **Required** — the service will not start without it. There is no default and no rotation procedure yet; losing or changing it makes existing TOTP enrolments and runtime-registered client secrets unusable. |
| `IMS_OIDC_JWKS` | Private JSON Web Key Set for signing ID tokens | Required when `NODE_ENV=production`. Outside production IMS generates an ephemeral key, so tokens do not verify after a restart. |
| `IMS_OIDC_COOKIE_KEY` | Signing key(s) for OIDC cookies, at least 32 characters each | Required in production. Accepts a JSON array or comma-separated list to support rotation. |
| `IMS_OIDC_CLIENT_SECRETS` | JSON map of `"realm/client_id"` → secret for externally provisioned confidential clients | Optional compatibility path |
| Service API keys | Caller authentication | Stored only as SHA-256 digests |
| `PG_PASSWORD` | Database role password | Standard database credential |

Store all of these in a Kubernetes Secret (or reference an existing Secret) and keep them out of Git.

## Bootstrap

IMS has no unauthenticated setup endpoint. A fresh database contains only the `default` realm — no principals, keys, or grants — so every management call returns 401 until an operator creates the first administrative principal **directly in the IMS database**:

1. Generate a strong random API key and keep it in a secret store.
2. In one transaction, insert a `ServiceAccount` principal in the `default` realm, an `ims-internal-api-key` external identity whose value is the SHA-256 hex digest of the key, and `allow` permissions on resource `ims` for exactly the management actions needed.

[Getting Started — Step 2](./getting-started.md#step-2-bootstrap-an-administrator-api-key) shows the statements. Because this principal lives in the `default` realm, it holds [cross-realm authority](#cross-realm-authority); after using it to set up realms and per-realm administrators, reduce its grants or deprovision it.

The `firefoundry-system` chart's IMS registration Job uses such a key (read from a Secret you create) to create the system realm and register the `ff-cli` public client and, optionally, the Console's confidential client, storing the one-time client secret straight into a Kubernetes Secret.

For roles that must have exactly one holder (such as a first-operator role), use the [fenced handoff endpoints](./reference.md#role-assignment-handoffs) rather than plain role assignments. A retried or delayed bootstrap job then cannot restore a grant after a newer handoff.

## Auditing

Security-relevant actions write to `ims.audit_log` with the acting principal, target, before/after state, request ID, and owning realm. The service only ever appends rows, and a database trigger prevents the owning realm of an event from changing. The table is not otherwise write-protected at the database level, so restrict direct database access to the IMS role and operators. Principal references are cleared (not cascaded) when a principal is deleted, so history survives. See [Reference — Audit log](./reference.md#audit-log) for the event types.

## Known Gaps

- Group, group membership, and principal create/update/delete are not audited.
- `/v1/check` has no caller authentication; rely on network controls.
- Service API keys can be issued for new service principals only through the database; the link endpoint requires the target to already hold a verifiable identity.
- No production email transport is wired, so native sign-in is not usable with `NODE_ENV=production` yet.
- The service must run as a single replica (per-process OIDC provider cache).

## Related

- [Concepts](./concepts.md)
- [Reference](./reference.md)
- [Operations](./operations.md)
