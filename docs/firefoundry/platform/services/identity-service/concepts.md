# Identity Management Service — Concepts

This page explains how to model your application's identities and authorization in IMS, how checks are evaluated, and what your app must do to use IMS securely.

## The Mental Model

IMS separates three questions:

1. **Who is this?** — A **principal**: a stable, IMS-minted ID.
2. **How did they prove it?** — One or more **external identities** (an IdP subject, an IMS sign-in, a service API key) that resolve to that principal.
3. **What may they do?** — **Permissions**, granted directly or through **groups** and **roles**, evaluated by `POST /v1/check`.

Everything lives inside a **realm**, your app's tenancy boundary.

```
Realm "acme"
│
├── Principal (HumanUser, id=7f3c…)
│     ├── ExternalIdentity (source=corp-oidc, value=…)
│     ├── member of Group "support-tier-2"  ──► parent Group "support"
│     └── RoleAssignment → Role "case-editor" (environment_scope=prod)
│
├── Principal (AgentBundle "case-triage-bundle")
│     └── RoleAssignment → Role "case-reader"
│
├── Group "support"        ── Permission allow  cases:read   case:*
├── Role  "case-editor"    ── Permission allow  cases:write  case:*
└── Permission (direct)    ── deny   cases:delete case:*   → principal 7f3c…
```

## Designing Your App's Authorization Model

A typical app design:

1. **Pick a realm.** One realm per app, or one per customer if customers must not share a user directory. See [Realms](#realms).
2. **Name your actions and resources.** IMS treats them as opaque strings. A `noun:verb` action and `type:id` resource convention works well with wildcards: `cases:read` on `case:1234`, `cases:*` on `case:restricted-*`.
3. **Create reusable permissions** (no `principal_id`) and attach them to **roles** that match job functions (`case-reader`, `case-editor`).
4. **Use groups** for organizational structure (`support` → `support-tier-2`); members inherit permissions from every ancestor group.
5. **Register your workloads** (app backend, agent bundles, FaaS functions) as principals and give them roles, just like people.
6. **Use direct denies sparingly** for exceptions — a deny always wins.
7. **Check at the point of action.** Your backend or bundle calls `/v1/check` (or `/v1/check-batch`) before performing the action, passing the acting principal's ID.

## Principals

A principal is anything that can be authorized:

| Field | Description |
|-------|-------------|
| `id` | UUID minted by IMS. Store this as the user or workload key in your own data. |
| `type` | `HumanUser`, `Developer`, `ServiceAccount`, `Application`, `AgentBundle`, `FaaSFunction` |
| `status` | `active`, `invited`, or `deprovisioned` |
| `display_name` | Optional label |
| `environment_scope` | Optional environment label |
| `type_meta` | Optional free-form JSON for your own metadata |

How principals come into existence depends on their type:

| Type | How to create it |
|------|------------------|
| `ServiceAccount`, `Application`, `AgentBundle`, `FaaSFunction` | `POST /v1/principals` |
| `HumanUser` / `Developer` authenticated by **your own IdP** | `POST /v1/principals/ensure` (find-or-create by external identity) |
| `HumanUser` who signs in **with IMS** | Invite with `POST /v1/realms/{name}/users` |

Creating `HumanUser` or `Developer` directly with `POST /v1/principals` is rejected.

**Status:**

- `invited` — created but has not completed a first IMS sign-in
- `active` — normal
- `deprovisioned` — cannot call the management API, cannot be matched by `ensure` (409 `PRINCIPAL_DEPROVISIONED`), and cannot have identities linked onto it. Reactivate explicitly with `PUT /v1/principals/{id}` and `status: "active"`.

A principal ID is useful beyond IMS. For example, a `Person` node in the [Entity Service](../entity-service/README.md) can store the IMS principal ID of the user it represents, while people who never sign in (document authors, contacts) link to nothing.

## External Identities and `ensure`

If your app authenticates users with its own IdP, your backend maps each authenticated user to a principal with `ensure`. An external identity is a `(source, external_value, environment_scope)` triple:

| Field | Example |
|-------|---------|
| `source` | A label you choose for the identity source, such as `corp-oidc` |
| `external_value` | The subject value from that source |
| `environment_scope` | Defaults to `default` |

Within a realm, a `(source, external_value)` pair maps to at most one principal, so `ensure` is idempotent: the first call creates the principal (`201`), later calls return the same one (`200`). Call it on every sign-in and cache the principal ID for the session.

> `ensure` identifies a user; it does **not** grant anything. A new principal has no permissions until your app's administrator (or your onboarding code) assigns roles or groups.

To attach a second identity to an existing principal (for example, the same person's accounts in two IdPs), use the **link** endpoint. Linking requires proof that the caller freshly authenticated *both* identities, and it never moves an identity that already belongs to another principal. Only the component that actually performs those authentications (your identity broker) should hold the permission to link. See [Reference — External identities](./reference.md#external-identities).

## Groups

- **Hierarchical** — a group can have a `parent_group_id`; members inherit permissions from every ancestor.
- **No cycles** — an update that would make a group its own ancestor is rejected (400).
- **Deletion** — a group with child groups cannot be deleted (409).
- Names are unique within a realm (409 on duplicates).

Manage membership with `/v1/groups/{id}/members` and attach permissions with `/v1/groups/{id}/permissions`.

## Roles and Role Assignments

A **role** is a named bundle of permissions. A **role assignment** gives a principal a role:

| Field | Description |
|-------|-------------|
| `principal_id`, `role_id` | Who gets which role |
| `environment_scope` | Where the assignment applies. Omitted → `default`; `null` → global (needs `ims:grant-global`) |
| `expires_at` | Optional; expired assignments are ignored by checks. Useful for time-boxed access. |

Role names are unique within a realm. A principal can hold a given role at most once per environment scope.

For a role that must have **exactly one holder** at a time (for example, an app owner role), IMS provides fenced handoff endpoints that transfer the role safely even when automation retries. See [Reference — Role assignment handoffs](./reference.md#role-assignment-handoffs).

## Permissions

| Field | Description |
|-------|-------------|
| `effect` | `allow` or `deny` |
| `action` | Action pattern, for example `cases:read` or `cases:*` |
| `resource` | Resource pattern, for example `case:1234` or `case:*` |
| `principal_id` | Set it for a **direct** grant; leave it null for a reusable permission attached to groups or roles |
| `environment_scope` | Omitted → `default`; a string → that environment; `null` → global (needs `ims:grant-global`) |

`*` matches any run of characters (including none); every other character matches literally. A pattern without `*` matches only the identical string.

## Realms

A realm is an isolated identity namespace and your app's **tenancy boundary**. Every principal, identity, group, role, assignment, permission, and audit event belongs to one realm, and nothing is visible across realms.

- A realm named `default` always exists. Requests that do not name a realm read from it; management **writes** must name their realm explicitly.
- Realm names: lowercase letters, digits, hyphens, 2–64 characters.
- Each realm has a **login policy** (`mfa_required`, `magic_link_ttl_seconds`, `session_ttl_seconds`) and a **status** (`active` / `disabled`). A disabled realm's sign-in endpoints return 503.
- Each realm is its own OpenID Provider with issuer `<IMS public URL>/realms/{realm}` and its own registered OIDC clients.
- A realm named `platform` must always require MFA.

Typical layouts:

- **One realm per app** — simplest; all your app's users and workloads share one directory.
- **One realm per customer** — for multi-tenant apps whose customers must not share users, groups, or roles. Your app decides which realm to use per request (for example from the tenant in the URL) and passes it on every call.

Keep platform operators (FireFoundry Console and CLI users) in their own realm, separate from your app's end users.

## Environment Scope

`environment_scope` lets one principal hold different rights in different environments.

When a check includes `environment_scope`:

- a permission applies only if its scope equals the requested scope or is global (`null`)
- a role-derived permission also requires the **role assignment's** scope to equal the requested scope or be global

When a check **omits** `environment_scope`, scope is ignored and every matching grant applies. If your app depends on environment separation, always send `environment_scope` on checks.

## How a Check Is Evaluated

`POST /v1/check` evaluates `(principal_id, action, resource[, environment_scope])` within a realm:

1. Collect candidate permissions:
   - **direct** — permissions whose `principal_id` is the principal
   - **group** — permissions on any group the principal belongs to, plus all ancestor groups
   - **role** — permissions on roles the principal holds through non-expired assignments
2. Keep candidates whose `action` and `resource` patterns match and whose scopes are compatible.
3. If **any** remaining candidate is a deny → `allowed: false`.
4. Otherwise, if any is an allow → `allowed: true`.
5. Otherwise → `allowed: false`, reason `no-matching-permission` (default deny).

| Reason | Meaning |
|--------|---------|
| `explicit-allow` / `explicit-deny` | A direct permission decided |
| `group-allow` / `group-deny` | A group-inherited permission decided |
| `role-allow` / `role-deny` | A role-derived permission decided |
| `no-matching-permission` | Nothing matched; default deny |

When several sources match with the same effect, the reason prefers direct, then group, then role. Base your app's decision on `allowed`; use `reason` for logging and troubleshooting.

## Signing Users In with IMS

If your app does not have its own IdP, it can use the realm's OpenID Provider. From the user's point of view:

1. Your app's administrator **invites** the user's email address into the realm. The user is `invited`; no email is sent yet.
2. The user opens your app, which redirects to the realm's authorization endpoint.
3. IMS asks for the user's email address and emails a one-time sign-in link. The page always says "If an account is available, a sign-in link will arrive soon", whether or not the address is known. The link expires and **must be opened in the same browser** where sign-in began.
4. If the realm requires MFA (the default), on first sign-in the user scans a QR code (or copies a setup key) into an authenticator app, enters a six-digit code, and is shown **eight one-time recovery codes** to save and acknowledge. On later sign-ins the user enters a six-digit code, or a recovery code if the authenticator is unavailable.
5. IMS redirects back to your app with an authorization code; your app exchanges it for tokens. The user's status becomes `active`.

The ID token's `sub` claim is the user's **principal ID** — the same ID you use for `/v1/check` and in your own data. See [Reference — OpenID Provider](./reference.md#openid-provider) for scopes and claims.

Administrators can disable and re-enable a user, revoke all of the user's sessions, and reset the user's MFA. Each of these immediately invalidates the user's existing sessions and refresh tokens, so your app should expect token refreshes to fail and send the user back through sign-in.

## Securing Your App's Use of IMS

### API keys

Your app's backend (and any bundle or function that manages IMS data) authenticates to the management API with an **API key** in the `X-API-Key` header. Each key belongs to a principal, usually a `ServiceAccount`, and the key can do only what that principal's `ims:*` permissions allow.

- Your **environment administrator provisions API keys** and the initial administrator for your realm. There is no self-service API for issuing a key to a new service principal in this version.
- Treat keys like passwords: deliver them through Kubernetes Secrets or a secret manager, never in values files, images, or logs.
- To retire a key, deprovision its principal; the change takes effect on the next request.
- The management API does not accept bearer tokens in place of an API key.

### Least privilege for callers

Every management endpoint requires a specific IMS permission (action `ims:…`, resource `ims`) held by the calling principal; see [Reference — Required permissions](./reference.md#required-ims-permissions). When requesting a key for a component, ask for only what it needs:

| Component | Typical permissions |
|-----------|---------------------|
| Backend that onboards externally authenticated users | `ims:ensure-principal` |
| App admin tooling that manages roles and groups | `ims:manage-groups`, `ims:manage-roles`, `ims:manage-role-assignments`, `ims:manage-permissions` |
| User administration (invite, disable, revoke sessions) | `ims:manage-principals`; `ims:reset-mfa` for MFA resets |
| Realm setup and OIDC client registration | `ims:manage-realms` |
| Agent bundle that only authorizes actions | None — `/v1/check` needs no key |

Keep in mind:

- **Wildcards apply to `ims:*` too.** An allow of `ims:*` (or `*`) grants everything, including `ims:grant-global` and `ims:manage-api-keys`. Grant exact action names.
- **Reads are gated.** Listing groups, roles, or permissions needs the matching `ims:manage-*` permission.
- **Keys live in a realm.** A key bound in your realm can administer only your realm. A key bound in the `default` realm can act on **every** realm, so ask for keys in your own realm.

### Keep the check endpoint internal

`/v1/check` and `/v1/check-batch` **do not authenticate callers**: anyone who can reach them can ask about any principal. Therefore:

- Call them only from inside the cluster (your backend, agent bundles, FaaS functions).
- Never expose `/v1/*` to browsers or through a public ingress. If users must reach IMS for sign-in, only the `/realms/` path prefix should be public.
- Ask your environment administrator to restrict which workloads can reach IMS (for example with NetworkPolicies).
- Never let a client choose the `principal_id` your backend checks. Take it from the verified ID token or your own session, not from request input.

## Audit Log

IMS records, per realm, who changed what: `ensure` calls, identity links and link denials, permission/role/role-assignment changes, realm/client/user administration, denied management calls, explicit-deny check results, and sign-in events. Each entry has the event type, actor, target, before/after state, and a request ID (taken from a valid `X-Request-Id` header, or generated). Read it with `GET /v1/audit-log?realm=…` and `ims:read-audit-log`.

Group, group-membership, and principal create/update/delete are not currently audited, and default-deny check results are not recorded.

## Next Steps

- [Getting Started](./getting-started.md) — try the model end to end
- [Reference](./reference.md) — full API
- [Operations](./operations.md) — enabling IMS and troubleshooting
