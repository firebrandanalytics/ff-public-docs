# Identity Management Service — Reference

REST API reference for IMS 0.1.0. All management endpoints accept and return JSON. The service listens on port `8081`; in-cluster it is reached at `http://<release>-identity-service.<namespace>.svc.cluster.local:8081`.

## Conventions

### Headers

| Header | Used by | Description |
|--------|---------|-------------|
| `X-API-Key` | Every endpoint that lists a permission below | Your API key; IMS resolves it to your calling principal. See [Concepts — API keys](./concepts.md#api-keys). |
| `X-Request-Id` | Optional, all endpoints | Correlation ID recorded in audit entries. Must match `[A-Za-z0-9._-]{1,128}`; otherwise IMS generates a UUID. |

### Realm selection

Endpoints marked **realm required** need a realm: a `realm` field in the JSON body or a `?realm=` query parameter (they must agree if both are sent). Other endpoints accept an optional selector and default to the `default` realm. `/v1/realms/{name}/...` endpoints take the realm from the path, and any body or query selector must match it.

### Environment scope values

For permissions and role assignments, `environment_scope` may be:

| Value sent | Meaning |
|------------|---------|
| omitted, `""`, or whitespace | `"default"` |
| a string | that environment (trimmed) |
| JSON `null` | global — requires `ims:grant-global` |

### Common errors

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `{ "error": "..." }` | Missing/invalid fields, missing realm on a write, or conflicting realm selectors |
| 401 | `{ "error": "X-API-Key header is required" }` or `"X-API-Key does not match a known service principal"` | Missing, unknown, or deprovisioned caller key (or a key from another realm) |
| 403 | `{ "error": "FORBIDDEN", "message": "Caller lacks required permission \"ims:...\"" }` | Your principal lacks the named permission |
| 404 | `{ "error": "..." }` / `{ "error": "REALM_NOT_FOUND" }` | Unknown object, realm, or route |
| 409 | `{ "error": "..." }` | Conflict (duplicates, lifecycle rules, fenced roles) |
| 500 | `{ "error": "Internal Server Error" }` | Unexpected error |

## Required `ims:*` Permissions

Each management endpoint requires the caller's principal to hold an `allow` for the listed action on resource `ims`, in the target realm.

| Permission (`action`) | Grants |
|-----------------------|--------|
| `ims:ensure-principal` | `POST /v1/principals/ensure` |
| `ims:manage-principals` | Principal CRUD; invite, read, enable, disable realm users; revoke sessions. Also required (with `ims:link-external-identity`) to unlink an identity |
| `ims:manage-groups` | Group CRUD, membership, and group–permission mappings (including reads) |
| `ims:manage-roles` | Role CRUD and role–permission mappings (including reads) |
| `ims:manage-role-assignments` | Role assignment CRUD (including reads) and fenced handoffs |
| `ims:manage-permissions` | Permission CRUD (including reads) |
| `ims:grant-global` | Additionally required to create or update a permission or role assignment with `environment_scope: null` |
| `ims:link-external-identity` | Link an external identity onto a principal |
| `ims:manage-api-keys` | Additionally required to link an API-key identity (reserved for environment administrators) |
| `ims:read-external-identities` | List a principal's external identities |
| `ims:read-audit-log` | `GET /v1/audit-log` |
| `ims:manage-realms` | Create, list, read, and update realms; register OIDC clients |
| `ims:reset-mfa` | Reset a realm user's MFA |

Patterns are glob-matched, so `ims:*` grants every row above. Grant exact actions. Deny rules override allows here too.

---

## Health

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/health` | None | `{ status: "healthy", service, version, timestamp }` |
| GET | `/ready` | None | `200 { ready: true, database: "connected" }` or `503 { ready: false, ... }` |
| GET | `/status` | None | `{ service, version, uptime, environment }` |

---

## Principals

### Principal object

```json
{
  "id": "uuid",
  "type": "HumanUser | Developer | ServiceAccount | Application | AgentBundle | FaaSFunction",
  "display_name": "string | null",
  "status": "active | invited | deprovisioned",
  "environment_scope": "string | null",
  "type_meta": {},
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### POST /v1/principals/ensure

Find or create a principal for an externally authenticated user. **Permission:** `ims:ensure-principal`. **Realm required.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `HumanUser` or `Developer` only |
| `source` | string | Yes | Identity source label |
| `external_value` | string | Yes | Subject value within the source |
| `display_name` | string | No | Used only when creating |
| `environment_scope` | string | No | Defaults to `default` |

| Code | Condition |
|------|-----------|
| 201 | New principal created |
| 200 | Existing principal returned |
| 400 | Missing fields or disallowed `type` |
| 409 | `{ "error": "PRINCIPAL_DEPROVISIONED" }` |

### POST /v1/principals

Create a workload principal. **Permission:** `ims:manage-principals`. **Realm required.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `ServiceAccount`, `Application`, `AgentBundle`, or `FaaSFunction` (`HumanUser`/`Developer` → 400) |
| `display_name` | string | No | |
| `environment_scope` | string | No | |
| `type_meta` | object | No | Free-form metadata |

Returns `201` with the principal.

### Other principal endpoints

All require `ims:manage-principals`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/principals` | Query: `realm`, `type`, `status` |
| GET | `/v1/principals/{id}` | 404 if missing |
| PUT | `/v1/principals/{id}` | **Realm required.** Update `status`, `display_name`, `type_meta`, `environment_scope` (`type` is immutable). 409 `NATIVE_PRINCIPAL_LIFECYCLE` for users who sign in with IMS — use the [realm user endpoints](#realm-users) instead |
| DELETE | `/v1/principals/{id}` | **Realm required.** `204`; 409 `NATIVE_PRINCIPAL_LIFECYCLE`, or 409 `FENCED_ASSIGNMENT` if the principal holds a handoff-protected role (hand it off first) |

---

## External Identities

External identity object: `{ id, principal_id, source, external_value, environment_scope, linked_at, linked_by_principal_id }`.

### POST /v1/principals/{id}/external-identities

Link another identity onto an existing principal. **Permission:** `ims:link-external-identity`. **Realm required.**

The body must include `proof_of_control` attesting that the caller freshly authenticated both the identity being linked (`subject_auth`, which must name exactly that identity) and an identity already on the target principal (`target_evidence`). IMS records these attestations but cannot verify them cryptographically; only the component that actually performs the authentications should hold this permission.

```json
{
  "realm": "acme",
  "source": "corp-oidc",
  "external_value": "subject-8f2d",
  "environment_scope": "default",
  "proof_of_control": {
    "subject_auth": {
      "source": "corp-oidc", "external_value": "subject-8f2d", "environment_scope": "default",
      "method": "oidc", "authenticated_at": "2026-09-24T10:15:00Z", "assertion_ref": "optional"
    },
    "target_evidence": {
      "source": "partner-idp", "external_value": "…", "environment_scope": "default",
      "method": "oidc", "authenticated_at": "2026-09-24T10:14:30Z"
    }
  }
}
```

| Code | `code` field | Condition |
|------|--------------|-----------|
| 201 | — | Linked |
| 200 | — | Already linked to this principal (no-op) |
| 400 | `MISSING_FIELDS`, `PROOF_OF_CONTROL_REQUIRED`, `PROOF_SUBJECT_MISMATCH` | Invalid request or proof |
| 403 | `LINK_PERMISSION_REQUIRED`, `MANAGE_API_KEYS_REQUIRED`, `TARGET_CONTROL_NOT_PROVEN` | Not authorized, or target evidence does not resolve to the target |
| 404 | `PRINCIPAL_NOT_FOUND` | Target missing |
| 409 | `PRINCIPAL_DEPROVISIONED`, `EXTERNAL_IDENTITY_CONFLICT` | Target deprovisioned, or the identity belongs to another principal |

### Other external identity endpoints

| Method | Path | Permission | Result |
|--------|------|------------|--------|
| GET | `/v1/principals/{id}/external-identities` | `ims:read-external-identities` | Array, or 404. **Realm required** |
| DELETE | `/v1/principals/{id}/external-identities/{extId}` | `ims:link-external-identity` **and** `ims:manage-principals` | `204`, or 404 `EXTERNAL_IDENTITY_NOT_FOUND`. **Realm required** |

---

## Policy Checks

### POST /v1/check

Evaluate one permission. **No authentication** — call only from inside the cluster (see [Concepts — Keep the check endpoint internal](./concepts.md#keep-the-check-endpoint-internal)).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `principal_id` | uuid | Yes | Principal to evaluate |
| `action` | string | Yes | Requested action |
| `resource` | string | Yes | Requested resource |
| `environment_scope` | string | No | When present, only grants for this scope or global grants apply |
| `realm` | string | No | Defaults to `default` |

Response:

```json
{ "allowed": true, "reason": "role-allow" }
```

`reason` is one of `explicit-allow`, `explicit-deny`, `group-allow`, `group-deny`, `role-allow`, `role-deny`, `no-matching-permission`. An unknown realm returns 404 `REALM_NOT_FOUND`. See [Concepts — How a check is evaluated](./concepts.md#how-a-check-is-evaluated).

### POST /v1/check-batch

Body `{ "checks": [ <check>, ... ] }` with 1–100 items shaped like `/v1/check`. Response `{ "results": [ <result>, ... ] }` in the same order. An empty array, more than 100 items, or an item missing required fields → 400.

---

## Groups

Group object: `{ id, name, parent_group_id, environment_scope, created_at, updated_at }`.

All routes require `ims:manage-groups`; writes are **realm required**.

| Method | Path | Body / Query | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/v1/groups` | `name` (required), `parent_group_id`, `environment_scope` | 201 group | 409 duplicate name |
| GET | `/v1/groups` | `?parent_group_id=<uuid>`, or `?parent_group_id=null` for top-level groups | 200 array | |
| GET | `/v1/groups/{id}` | | 200 group | 404 |
| PUT | `/v1/groups/{id}` | `name`, `parent_group_id`, `environment_scope` | 200 group | 400 cycle, 404, 409 duplicate |
| DELETE | `/v1/groups/{id}` | | 204 | 404, 409 has child groups |
| POST | `/v1/groups/{id}/members` | `principal_id` | 201 `{ group_id, principal_id }` | 404 group/principal |
| GET | `/v1/groups/{id}/members` | | 200 `[{ principal_id, created_at }]` | 404 |
| DELETE | `/v1/groups/{id}/members/{principalId}` | | 204 | 404 |
| POST | `/v1/groups/{id}/permissions` | `permission_id` | 201 `{ group_id, permission_id }` | 404 group/permission |
| GET | `/v1/groups/{id}/permissions` | | 200 array of permissions | 404 |
| DELETE | `/v1/groups/{id}/permissions/{permissionId}` | | 204 | 404 |

---

## Roles

Role object: `{ id, name, environment_scope, created_at, updated_at }`.

All routes require `ims:manage-roles`; writes are **realm required**.

| Method | Path | Body | Success | Errors |
|--------|------|------|---------|--------|
| POST | `/v1/roles` | `name` (required), `environment_scope` | 201 role | 409 duplicate |
| GET | `/v1/roles` | | 200 array | |
| GET | `/v1/roles/{id}` | | 200 role | 404 |
| PUT | `/v1/roles/{id}` | `name`, `environment_scope` | 200 role | 404, 409 duplicate or fenced scope change |
| DELETE | `/v1/roles/{id}` | | 204 | 404, 409 fenced |
| POST | `/v1/roles/{id}/permissions` | `permission_id` | 201 `{ role_id, permission_id }` | 404 |
| GET | `/v1/roles/{id}/permissions` | | 200 array | 404 |
| DELETE | `/v1/roles/{id}/permissions/{permissionId}` | | 204 | 404 |

---

## Role Assignments

Role assignment object: `{ id, principal_id, role_id, environment_scope, expires_at, created_at, updated_at }`.

All routes require `ims:manage-role-assignments`; writes are **realm required**. `environment_scope: null` also requires `ims:grant-global`.

| Method | Path | Body / Query | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/v1/role-assignments` | `principal_id`, `role_id` (required), `environment_scope`, `expires_at` | 201 | 404 principal/role, 409 duplicate or fenced scope |
| GET | `/v1/role-assignments` | `?principal_id=&role_id=` | 200 array | |
| GET | `/v1/role-assignments/{id}` | | 200 | 404 |
| PUT | `/v1/role-assignments/{id}` | `environment_scope`, `expires_at` | 200 | 404, 409 |
| DELETE | `/v1/role-assignments/{id}` | | 204 | 404, 409 fenced |

A 409 with `"role assignment scope is managed by a fenced handoff"` means the role/scope is managed by the handoff endpoints below.

### Role assignment handoffs

For roles that must have exactly one holder per environment. Each handoff carries a **generation** number, so a delayed or retried automation job holding an old generation cannot re-grant the role after a newer handoff. Once a role/scope has been handed off, plain role-assignment writes to it are rejected (409).

**Permission:** `ims:manage-role-assignments` in the requested `environment_scope`. **Realm required.** Global scope is not allowed. Both calls are idempotent by `operation_id`.

**POST /v1/role-assignment-handoffs/begin** — revoke the expected current holder and advance the generation.

| Field | Type | Description |
|-------|------|-------------|
| `role_id` | uuid | Role being handed off; its own `environment_scope` must equal the request's |
| `new_principal_id` | uuid | Successor (`active` or `invited`) |
| `environment_scope` | string | Non-empty scope |
| `expected_assignment_id` | uuid \| null | The current holder's assignment ID, or `null` if none |
| `expected_generation` | integer | `0` for a role never handed off, otherwise the last generation you recorded |
| `operation_id` | uuid | New ID per handoff; reuse it to retry |

Returns `201 { generation, assignment: null, idempotent: false }` (or `200` with `idempotent: true` on retry).

**POST /v1/role-assignment-handoffs/grant** — create the successor's assignment.

| Field | Description |
|-------|-------------|
| `role_id`, `principal_id`, `environment_scope`, `operation_id` | Same values as `begin` (`principal_id` = the successor) |
| `generation` | The generation returned by `begin` |

Returns `201 { generation, assignment, idempotent: false }` (or `200` on retry). A stale generation, changed input, or unexpected holder → 409 with no changes. After a 409, re-read current state and begin a new handoff; do not fall back to `POST /v1/role-assignments`.

---

## Permissions

Permission object: `{ id, principal_id, effect, action, resource, environment_scope, created_at }`.

All routes require `ims:manage-permissions`; writes are **realm required**. `environment_scope: null` also requires `ims:grant-global`.

| Method | Path | Body / Query | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/v1/permissions` | `effect` (`allow`/`deny`), `action`, `resource` (required), `principal_id`, `environment_scope` | 201 | 400, 404 principal |
| GET | `/v1/permissions` | `?principal_id=` | 200 array | |
| GET | `/v1/permissions/{id}` | | 200 | 404 |
| PUT | `/v1/permissions/{id}` | any create field | 200 | 400, 404 |
| DELETE | `/v1/permissions/{id}` | | 204 | 404 |

---

## Audit Log

### GET /v1/audit-log

**Permission:** `ims:read-audit-log`. Query: `realm` (**required**), `event_type`, `actor_principal_id`, `target_principal_id`, `limit` (default 100, max 1000). Returns newest first:

```json
[{ "id": "uuid", "event_type": "role.create", "actor_principal_id": "uuid", "target_principal_id": null,
   "before_state": null, "after_state": { }, "request_id": "…", "created_at": "timestamp" }]
```

| Area | Event types |
|------|-------------|
| Principals & identities | `ensure`, `external-identity.link`, `external-identity.link-denied`, `external-identity.unlink` |
| Authorization | `permission.denied` (management call refused), `check.deny` (explicit-deny check results) |
| RBAC | `role.create`, `role.update`, `role.delete`, `role.permission-attach`, `role.permission-detach`, `role-assignment.create`, `role-assignment.update`, `role-assignment.delete`, `role-assignment.handoff-begin`, `role-assignment.handoff-grant`, `permission.create`, `permission.update`, `permission.delete` |
| Realm administration | `realm.create`, `realm.update`, `client.create`, `user.invite`, `user.disabled`, `user.enabled`, `sessions.revoke`, `mfa.reset`, `admin.mutation-denied` |
| Sign-in | `login.challenge-issued`, `login.challenge-consumed`, `login.challenge-delivery-failed`, `login.magic-link-rejected`, `login.totp-enrolled`, `login.totp-verified`, `login.recovery-acknowledged`, `login.recovery-consumed`, `login.completed`, `authorize.reject` |

---

## Realms

Realm object: `{ id, name, display_name, status, login_policy }`.

| Login policy field | Type | Default | Rules |
|--------------------|------|---------|-------|
| `mfa_required` | boolean | `true` | Cannot be `false` for a realm named `platform` |
| `device_code_enabled` | boolean | `false` | Must be `false` (device flow is not supported) |
| `magic_link_ttl_seconds` | integer | `900` | Minimum 60 |
| `session_ttl_seconds` | integer | `28800` | Minimum 300; sets both browser session and grant lifetime |

| Method | Path | Permission | Body | Success |
|--------|------|------------|------|---------|
| POST | `/v1/realms` | `ims:manage-realms` | `name` (`^[a-z0-9-]{2,64}$`), `display_name`, `login_policy` | 201 realm |
| GET | `/v1/realms` | `ims:manage-realms` | | 200 `{ items: [realm] }` (a key scoped to one realm sees only that realm) |
| GET | `/v1/realms/{name}` | `ims:manage-realms` | | 200 realm |
| PATCH | `/v1/realms/{name}` | `ims:manage-realms` | any of `display_name`, `status` (`active`/`disabled`), `login_policy` (merged) | 200 realm |

### OIDC clients

**POST /v1/realms/{name}/clients** — **Permission:** `ims:manage-realms`. Returns `201` with the client.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `client_id` | string | No | Generated if omitted |
| `display_name` | string | Yes | Shown on sign-in pages |
| `redirect_uris` | string[] | Yes | Exact `https://` URIs, or `http://` loopback URIs (`127.0.0.1`, `localhost`, `::1`). No wildcards, fragments, or embedded credentials |
| `post_logout_redirect_uris` | string[] | No | Same rules |
| `scopes` | string[] | No | Default `["openid","email","profile"]`; must include `openid`. App clients use `openid`, `email`, `profile`, `offline_access` |
| `token_endpoint_auth_method` | string | No | `none` (default, public client), `client_secret_basic`, or `client_secret_post` (confidential) |

For confidential clients the response includes `client_secret` **only once**. There are no endpoints to list, update, or delete clients in this version.

### Realm users

For users who sign in with IMS. Local account object: `{ id, realm_id, principal_id, principal_type, email, email_verified_at, status (invited|active|disabled), auth_generation, created_at, updated_at }`.

| Method | Path | Permission | Body | Success |
|--------|------|------------|------|---------|
| POST | `/v1/realms/{name}/users` | `ims:manage-principals` | `email` (required), `display_name` | 201 new / 200 existing |
| GET | `/v1/realms/{name}/users/{principalId}` | `ims:manage-principals` | | 200 account |
| POST | `/v1/realms/{name}/users/{principalId}/disable` | `ims:manage-principals` | optional `{ "reason": "..." }` | 200 account |
| POST | `/v1/realms/{name}/users/{principalId}/enable` | `ims:manage-principals` | empty | 200 account |
| POST | `/v1/realms/{name}/users/{principalId}/sessions/revoke` | `ims:manage-principals` | optional `{ "reason": "..." }` | 204 |
| POST | `/v1/realms/{name}/users/{principalId}/mfa/reset` | `ims:reset-mfa` | `{ "reason": "..." }` (required) | 204 |

Unknown body fields are rejected. Inviting does not send an email; the user receives a sign-in link when they start signing in from your app. Enabling returns an account to `active` if its email was verified, otherwise to `invited`. MFA reset requires an `active` account. Disable, session revoke, and MFA reset immediately invalidate the user's existing sessions and refresh tokens. There is no endpoint to list realm users in this version.

### Realm admin errors

| Status | `error` | Cause |
|--------|---------|-------|
| 400 | `INVALID_REALM`, `INVALID_REALM_UPDATE`, `INVALID_CLIENT`, `INVALID_EMAIL`, `INVALID_REQUEST` | Malformed or unsupported body |
| 400 | policy message (for example `platform realm requires MFA`) | Login policy rule violated |
| 404 | `realm not found` / `user not found` | |
| 409 | `CONFLICT` | Realm name or client ID already exists |
| 409 | `ACCOUNT_DISABLED` | Inviting an email whose account is disabled |
| 409 | `account already disabled` / `account already enabled` / `MFA reset requires an active account` | Lifecycle conflict |

---

## OpenID Provider

Each realm is a separate OpenID Provider served under `/realms/{realm}`, with issuer `<IMS public URL>/realms/{realm}`. Configure your OIDC library with the issuer and let it read the discovery document rather than hard-coding endpoint URLs:

```
GET /realms/{realm}/.well-known/openid-configuration
```

Discovery advertises the authorization, token, userinfo, JWKS, introspection, and end-session endpoints. An unknown realm returns 404 `REALM_NOT_FOUND`; a disabled realm returns 503 `REALM_DISABLED`.

| Capability | Setting |
|------------|---------|
| Response types | `code` |
| Grant types | `authorization_code`, `refresh_token` (request `offline_access` for a refresh token) |
| PKCE | Required for every client, method `S256` (`plain` is rejected) |
| Scopes for apps | `openid`, `email`, `profile`, `offline_access` |
| ID token | JWT signed with keys published at the JWKS endpoint |
| Access and refresh tokens | Opaque |
| Introspection (RFC 7662) | Confidential clients on the environment's allow-list only |
| Logout | RP-initiated logout at the end-session endpoint |
| Not enabled | Device flow, client credentials, dynamic client registration |

The `admin:environments:read` / `admin:environments:write` scopes and the `urn:firefoundry:admin-api` resource indicator are reserved for FireFoundry's own Admin API clients.

### Claims

| Scope | Claims |
|-------|--------|
| `openid` | `sub` (the user's principal ID), `acr`, `amr` |
| `email` | `email`, `email_verified` |
| `profile` | `realm` |

`acr` is `urn:firefoundry:acr:mfa` when the user completed a second factor, otherwise `urn:firefoundry:acr:email`. `amr` lists the methods used: `email`, `otp`, `recovery`, and `mfa` when two or more factors were used. If a feature of your app needs MFA, check `acr` in the ID token.

When a realm requires MFA, an existing session established without MFA does not satisfy a new authorization request; the user is asked to complete MFA.

### Sign-in pages

The authorization endpoint sends the user's browser through IMS-hosted pages under `/realms/{realm}/interaction/...` (email entry, "check your email", authenticator setup with QR code, six-digit code entry, recovery codes). Your app does not call these directly; it only redirects to the authorization endpoint and handles the callback. If sign-in email delivery is not configured in the environment, these pages return `503 { "error": "NATIVE_LOGIN_UNAVAILABLE" }`.

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Operations](./operations.md)
