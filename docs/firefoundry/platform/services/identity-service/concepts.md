# Identity Management Service — Concepts

This page explains the IMS data model and how the pieces fit together. For how these objects are protected, see the [Security Model](./security-model.md).

## The Mental Model

IMS separates three questions that are often tangled together:

1. **Who is this?** — A **principal**: a canonical, platform-minted ID that never changes.
2. **How did they prove it?** — One or more **external identities** (an IdP subject, an email login, a service API key) that resolve to that principal.
3. **What may they do?** — **Permissions**, granted directly or through **groups** and **roles**, evaluated by the policy decision endpoint `POST /v1/check`.

Everything lives inside a **realm**, an isolated identity namespace.

```
Realm "acme"
│
├── Principal (HumanUser, id=7f3c…)
│     ├── ExternalIdentity (source=entra-oid, value=…)
│     ├── ExternalIdentity (source=oidc-sub,  value=…)
│     ├── member of Group "support-tier-2"  ──► parent Group "support"
│     └── RoleAssignment → Role "case-editor" (environment_scope=prod)
│
├── Group "support"        ── Permission allow  cases:read   case:*
├── Role  "case-editor"    ── Permission allow  cases:write  case:*
└── Permission (direct)    ── deny   cases:delete case:*   → principal 7f3c…
```

## Principals

A principal is anything that can be authorized. Each has:

| Field | Description |
|-------|-------------|
| `id` | UUID minted by IMS. Use this as the reference key in other services. |
| `type` | One of `HumanUser`, `Developer`, `ServiceAccount`, `Application`, `AgentBundle`, `FaaSFunction` |
| `status` | `active`, `invited`, or `deprovisioned` |
| `display_name` | Optional label |
| `environment_scope` | Optional environment label |
| `type_meta` | Optional free-form JSON for type-specific metadata |

**How principals are created depends on their type:**

- `HumanUser` and `Developer` come from an external authentication, so they are created through `POST /v1/principals/ensure` (find-or-create by external identity). Direct creation of these two types is rejected.
- `ServiceAccount`, `Application`, `AgentBundle`, and `FaaSFunction` are platform-provisioned and created with `POST /v1/principals`.
- Realm users who sign in with IMS's native login are created by the realm **invite** endpoint (`POST /v1/realms/{name}/users`), which creates a `HumanUser` principal plus a local account.

**Status semantics:**

- `invited` — created but has not completed a first sign-in (native login) yet
- `active` — normal
- `deprovisioned` — cannot authenticate as an API caller, cannot be matched by `ensure` (409 `PRINCIPAL_DEPROVISIONED`), and cannot have identities linked onto it. Reactivation is an explicit admin action (`PUT /v1/principals/{id}` with `status: "active"`), never a side effect.

A principal's canonical ID is useful beyond IMS. For example, a domain `Person` node in the [Entity Service](../entity-service/README.md) can optionally store the IMS principal ID of the user it represents, while people who never log in (document authors, contacts) link to nothing.

## External Identities

An external identity is a `(source, external_value, environment_scope)` triple bound to exactly one principal in a realm:

| Field | Example |
|-------|---------|
| `source` | A label for where the identity came from, such as an IdP name |
| `external_value` | The subject value from that source |
| `environment_scope` | Defaults to `default` when omitted or blank |

Within a realm, a `(source, external_value)` pair resolves to at most one principal. That is what makes `ensure` idempotent: the first call mints a principal and binds the identity; every later call with the same pair returns the same principal (`200` instead of `201`).

**Adding a second identity to an existing principal** (for example, the same person's OIDC subject and their directory object ID) uses the **link** endpoint. Linking is deliberately hard because a wrong link merges two people into one authorization subject. A link request must carry proof that the caller freshly authenticated *both* the new identity and an identity already on the target principal; see [Security Model — External identity linking](./security-model.md#external-identity-linking). A link never re-points an identity that already belongs to another principal (409).

Service API keys are also stored as external identities, under the reserved source `ims-internal-api-key`, with only a SHA-256 digest of the key stored.

> `ensure` canonicalizes an identity; it does **not** grant anything. A newly ensured principal has no permissions until an administrator (or a seeded grant) gives it some.

## Groups

Groups collect principals and carry permissions.

- **Hierarchical** — a group may have a `parent_group_id`. A member of a child group inherits permissions attached to every ancestor group.
- **Cycle-safe** — IMS rejects an update that would make a group its own ancestor (400), and the evaluation query terminates even if a cycle were present.
- **Deletion** — a group that still has child groups cannot be deleted (409).
- Group names are unique within a realm (duplicate → 409).

Membership is managed with `POST/DELETE /v1/groups/{id}/members`, and permissions are attached with `POST/DELETE /v1/groups/{id}/permissions`.

## Roles and Role Assignments

A **role** is a named bundle of permissions (`POST /v1/roles/{id}/permissions`). A **role assignment** binds a principal to a role:

| Field | Description |
|-------|-------------|
| `principal_id`, `role_id` | Who gets which role |
| `environment_scope` | Environment in which the assignment applies. Omitted → `default`; `null` → global (requires `ims:grant-global`) |
| `expires_at` | Optional; expired assignments are ignored by evaluation |

Role names are unique within a realm. A principal can hold a given role at most once per environment scope (including at most one global assignment).

### Fenced role handoff

Some roles must have exactly one holder per environment — for example, the first platform operator created during bootstrap. The **handoff** endpoints (`/v1/role-assignment-handoffs/begin` and `/grant`) move such a role from one principal to another using an IMS-owned **generation** counter as a fencing token. A stale automation job holding an old generation cannot re-grant the role after a newer handoff. Once a role scope has been handed off this way, ordinary role-assignment writes to that scope are rejected (409). See [Reference — Role assignment handoffs](./reference.md#role-assignment-handoffs).

## Permissions

A permission is an allow or deny rule:

| Field | Description |
|-------|-------------|
| `effect` | `allow` or `deny` |
| `action` | Action pattern, for example `cases:read` or `cases:*` |
| `resource` | Resource pattern, for example `case:1234` or `case:*` |
| `principal_id` | Optional. Set it for a **direct** grant; leave it null for a reusable permission you will attach to groups or roles |
| `environment_scope` | Omitted → `default`; a string → that environment; `null` → global (requires `ims:grant-global`) |

`action` and `resource` are plain strings chosen by your application. `*` matches any run of characters (including none); every other character matches literally. A pattern without `*` matches only the identical string.

## Realms

A realm is an isolated identity namespace. Every principal, external identity, group, role, role assignment, permission, and audit event belongs to exactly one realm, and lookups never cross realms.

- A realm named `default` is created by the database migrations. Requests that do not name a realm use it.
- Realm names are lowercase letters, digits, and hyphens, 2–64 characters.
- Each realm has a **login policy** (`mfa_required`, `magic_link_ttl_seconds`, `session_ttl_seconds`) and a **status** (`active` / `disabled`). A disabled realm's OIDC endpoints return 503.
- Each realm is its own OpenID Provider with issuer `{IMS_PUBLIC_URL}/realms/{realm}` and its own registered OIDC clients.
- A realm named `platform` must always require MFA; IMS refuses a policy that turns it off.

Typical layouts: one realm for platform operators (Console and CLI sign-in), and one realm per application or customer whose end users should not share a directory with operators.

## Environment Scope

`environment_scope` lets one principal hold different rights in different environments (for example, admin in `dev` but read-only in `prod`).

When a check includes `environment_scope`:

- a permission applies only if its own scope equals the requested scope or is global (`null`)
- a role-derived permission additionally requires the **role assignment's** scope to equal the requested scope or be global

When a check omits `environment_scope`, scope is ignored entirely and every matching grant applies. If you rely on environment separation, always pass `environment_scope` on checks.

## Permission Evaluation

`POST /v1/check` evaluates `(principal_id, action, resource[, environment_scope])` within a realm:

1. Collect candidate permissions from three sources:
   - **direct** — permissions whose `principal_id` is the principal
   - **group** — permissions attached to any group the principal belongs to, plus all ancestor groups
   - **role** — permissions attached to roles the principal holds through non-expired assignments
2. Keep candidates whose `action` and `resource` patterns match and whose scopes are compatible (see above).
3. If **any** remaining candidate is a deny → `allowed: false`.
4. Otherwise, if any is an allow → `allowed: true`.
5. Otherwise → `allowed: false` with reason `no-matching-permission` (default deny).

The `reason` in the response names the source that decided the outcome:

| Reason | Meaning |
|--------|---------|
| `explicit-allow` / `explicit-deny` | A direct permission decided |
| `group-allow` / `group-deny` | A group-inherited permission decided |
| `role-allow` / `role-deny` | A role-derived permission decided |
| `no-matching-permission` | Nothing matched; default deny |

When several sources match with the same effect, the reported reason prefers direct, then group, then role. This only affects the label, never the outcome.

## Native Login (Local Accounts)

For people who sign in with IMS itself, each realm keeps **local accounts** linked one-to-one with `HumanUser` principals:

1. An administrator invites an email address into a realm. The account and principal start as `invited`.
2. The user opens a client application, which redirects to the realm's OIDC authorization endpoint.
3. IMS asks for the email address and sends a one-time sign-in link.
4. If the realm requires MFA (the default), the user enrols a TOTP authenticator on first sign-in, saves eight one-time recovery codes, and on later sign-ins enters a TOTP code (or a recovery code).
5. On success the account becomes `active`, and IMS issues an authorization code to the client.

Administrators can disable and re-enable accounts, revoke all sessions, and reset MFA. Disabling, revoking sessions, and resetting MFA increment the account's **authentication generation**, which invalidates previously issued sessions and tokens. Details are in the [Security Model](./security-model.md#token-and-session-model).

## The Audit Log

IMS writes an append-only audit row for principal ensure, identity link/unlink and link denials, permission/role/role-assignment mutations, realm/client/user administration, permission-gate denials, explicit-deny check results, and sign-in events. Each row records the event type, actor, target, before/after state, the request ID (taken from a valid `X-Request-Id` header or generated), and the realm the event belongs to. Read it with `GET /v1/audit-log?realm=…`.

Group, group-membership, and principal create/update/delete operations are not currently audited.

## How IMS Interacts with Other Services

| Interaction | Direction | Purpose |
|-------------|-----------|---------|
| Services with their own authentication (gateways, bots, BFFs) | → IMS | `ensure` a principal for an authenticated user; call `/v1/check` |
| First-party clients (CLI, Console) | → IMS | Sign in through the realm's OIDC endpoints |
| Resource servers (for example the Admin API) | → IMS | Introspect opaque access tokens (allow-listed confidential clients only) |
| `firefoundry-system` registration Job | → IMS | Creates the system realm and registers the CLI and Console OIDC clients |
| Entitlement agent | IMS → | License/entitlement status for the `identity.access` check site |
| Notification Service | IMS → | Planned transport for sign-in emails (not yet wired) |

## Next Steps

- [Getting Started](./getting-started.md) — try the model end to end
- [Security Model](./security-model.md) — how callers authenticate and what protects each endpoint
- [Reference](./reference.md) — full API
