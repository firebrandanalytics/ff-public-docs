# Identity Management Service — Reference

Complete REST API and configuration reference for IMS 0.1.0. All management endpoints accept and return JSON. The service listens on port `8081`.

## Conventions

### Authentication

| Header | Used by | Description |
|--------|---------|-------------|
| `X-API-Key` | All endpoints marked with a permission below | Service API key; resolved to the caller's principal. See [Security Model](./security-model.md#service-api-keys). |
| `X-Request-Id` | Optional, all endpoints | Correlation ID recorded in audit rows. Must match `[A-Za-z0-9._-]{1,128}`; otherwise IMS generates a UUID. |

### Realm selection

Endpoints marked **realm required** need a realm selector: a `realm` field in the JSON body or a `?realm=` query parameter (they must agree if both are present). Other endpoints accept an optional selector and default to the `default` realm. `/v1/realms/{name}/...` endpoints take the realm from the path.

### Environment scope values

For permissions and role assignments, `environment_scope` may be:

| Value sent | Stored as |
|------------|-----------|
| omitted, `""`, or whitespace | `"default"` |
| a string | that string, trimmed |
| JSON `null` | `null` (global) — requires `ims:grant-global` |

### Common error responses

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `{ "error": "..." }` | Missing/invalid fields or conflicting realm selectors |
| 401 | `{ "error": "X-API-Key header is required", "message": ... }` or `"X-API-Key does not match a known service principal"` | Missing, unknown, or deprovisioned caller key |
| 403 | `{ "error": "FORBIDDEN", "message": "Caller lacks required permission \"ims:...\"", "reason": "..." }` | Caller lacks the required permission |
| 404 | `{ "error": "..." }` / `{ "error": "REALM_NOT_FOUND", "message": ... }` / `{ "error": "Not Found" }` | Unknown object, realm, or route |
| 409 | `{ "error": "..." }` | Conflict (duplicates, lifecycle rules, fencing) |
| 500 | `{ "error": "Internal Server Error" }` | Unexpected error (message detail only when `NODE_ENV=development`) |

---

## Standard Endpoints

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/` | None | `{ message, service, version }` |
| GET | `/health` | None | `{ status: "healthy", service, version, timestamp }` — liveness, no I/O |
| GET | `/ready` | None | `200 { ready: true, database: "connected" }` or `503 { ready: false, database: "disconnected" }` |
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

Find or create a principal by external identity. **Permission:** `ims:ensure-principal`. **Realm required.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `HumanUser` or `Developer` only |
| `source` | string | Yes | Identity source label |
| `external_value` | string | Yes | Subject value within the source |
| `display_name` | string | No | Used only when creating |
| `environment_scope` | string | No | Stored on the external identity; defaults to `default` |

| Code | Condition |
|------|-----------|
| 201 | New principal and identity created |
| 200 | Existing principal returned |
| 400 | Missing fields or disallowed `type` |
| 409 | `{ "error": "PRINCIPAL_DEPROVISIONED" }` — the identity maps to a deprovisioned principal |

### POST /v1/principals

Create a platform-provisioned principal. **Permission:** `ims:manage-principals`. **Realm required.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `ServiceAccount`, `Application`, `AgentBundle`, or `FaaSFunction` (`HumanUser`/`Developer` → 400) |
| `display_name` | string | No | |
| `environment_scope` | string | No | |
| `type_meta` | object | No | Free-form metadata |

Returns `201` with the principal.

### GET /v1/principals

List principals in a realm. **Permission:** `ims:manage-principals`. Query: `realm`, `type`, `status`.

### GET /v1/principals/{id}

**Permission:** `ims:manage-principals`. Returns the principal or 404.

### PUT /v1/principals/{id}

Update `status`, `display_name`, `type_meta`, or `environment_scope` (`type` is immutable). **Permission:** `ims:manage-principals`. **Realm required.** Returns 404 if missing, 409 `NATIVE_PRINCIPAL_LIFECYCLE` for principals that own a native-login account (use the realm user endpoints instead).

### DELETE /v1/principals/{id}

**Permission:** `ims:manage-principals`. **Realm required.** Returns `204`, 404, 409 `NATIVE_PRINCIPAL_LIFECYCLE`, or 409 `FENCED_ASSIGNMENT` when the principal holds a role assignment protected by a handoff fence (hand the role off first).

---

## External Identities

### External identity object

```json
{
  "id": "uuid",
  "principal_id": "uuid",
  "source": "string",
  "external_value": "string",
  "environment_scope": "string",
  "linked_at": "timestamp",
  "linked_by_principal_id": "uuid | null"
}
```

### POST /v1/principals/{id}/external-identities

Link an identity onto an existing principal. **Permission:** `ims:link-external-identity` (plus `ims:manage-api-keys` when `source` is `ims-internal-api-key`). **Realm required.** See [Security Model — External identity linking](./security-model.md#external-identity-linking).

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
      "source": "entra-oid", "external_value": "…", "environment_scope": "default",
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
| 401 | — | Missing or unknown `X-API-Key` |
| 403 | `LINK_PERMISSION_REQUIRED`, `MANAGE_API_KEYS_REQUIRED`, `TARGET_CONTROL_NOT_PROVEN` | Not authorized or target evidence does not resolve to the target |
| 404 | `PRINCIPAL_NOT_FOUND` | Target missing |
| 409 | `PRINCIPAL_DEPROVISIONED`, `EXTERNAL_IDENTITY_CONFLICT` | Target deprovisioned, or identity belongs to another principal |

### GET /v1/principals/{id}/external-identities

**Permission:** `ims:read-external-identities`. **Realm required.** Returns an array of external identities, or 404.

### DELETE /v1/principals/{id}/external-identities/{extId}

**Permissions:** `ims:link-external-identity` **and** `ims:manage-principals`. **Realm required.** Returns `204`, or 404 `EXTERNAL_IDENTITY_NOT_FOUND`.

---

## Policy Decisions

### POST /v1/check

Evaluate one permission. **No authentication** — restrict network access.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `principal_id` | uuid | Yes | Principal to evaluate |
| `action` | string | Yes | Requested action |
| `resource` | string | Yes | Requested resource |
| `environment_scope` | string | No | When present, only grants for this scope or global grants apply |
| `realm` | string | No | Defaults to `default` |

Response: `{ "allowed": boolean, "reason": "explicit-allow | explicit-deny | group-allow | group-deny | role-allow | role-deny | no-matching-permission" }`. An unknown realm returns 404 `REALM_NOT_FOUND`.

### POST /v1/check-batch

Body `{ "checks": [ <check>, ... ] }` with 1–100 items of the same shape as `/v1/check`. Response `{ "results": [ <result>, ... ] }` in the same order. More than 100 items, an empty array, or an item missing required fields → 400.

---

## Groups

Group object: `{ id, name, parent_group_id, environment_scope, created_at, updated_at }`.

All group routes require `ims:manage-groups`; mutations are **realm required**.

| Method | Path | Body / Query | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/v1/groups` | `name` (required), `parent_group_id`, `environment_scope` | 201 group | 409 duplicate name |
| GET | `/v1/groups` | `?parent_group_id=<uuid>` or `?parent_group_id=null` for roots | 200 array | |
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

All role routes require `ims:manage-roles`; mutations are **realm required** and audited.

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

All routes require `ims:manage-role-assignments`; mutations are **realm required** and audited. Creating or updating with `environment_scope: null` also requires `ims:grant-global`.

| Method | Path | Body / Query | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/v1/role-assignments` | `principal_id`, `role_id` (required), `environment_scope`, `expires_at` | 201 | 404 principal/role, 409 duplicate or fenced scope |
| GET | `/v1/role-assignments` | `?principal_id=&role_id=` | 200 array | |
| GET | `/v1/role-assignments/{id}` | | 200 | 404 |
| PUT | `/v1/role-assignments/{id}` | `environment_scope`, `expires_at` | 200 | 404, 409 |
| DELETE | `/v1/role-assignments/{id}` | | 204 | 404, 409 fenced |

A 409 with `"role assignment scope is managed by a fenced handoff"` means the role/scope is owned by the handoff endpoints. A 409 mentioning a concurrent handoff is retryable after re-reading state.

### Role assignment handoffs

Generation-fenced transfer of a scoped role. **Permission:** `ims:manage-role-assignments` in the requested `environment_scope`. **Realm required.** Global scope is not allowed. Both calls are idempotent by `operation_id`.

**POST /v1/role-assignment-handoffs/begin** — revoke the expected current holder and advance the generation.

| Field | Type | Description |
|-------|------|-------------|
| `role_id` | uuid | Role being handed off; its own `environment_scope` must equal the request's |
| `new_principal_id` | uuid | Successor (must be `active` or `invited`) |
| `environment_scope` | string | Non-empty scope |
| `expected_assignment_id` | uuid \| null | The current holder's assignment ID, or `null` if there is none |
| `expected_generation` | integer | `0` for a role never handed off, otherwise the last generation you recorded |
| `operation_id` | uuid | New ID per handoff; reuse it to retry |

Returns `201 { generation, assignment: null, idempotent: false }` (or `200` with `idempotent: true` on retry).

**POST /v1/role-assignment-handoffs/grant** — create the successor's assignment.

| Field | Type | Description |
|-------|------|-------------|
| `role_id`, `principal_id`, `environment_scope`, `operation_id` | | Same values as `begin` (`principal_id` = the successor) |
| `generation` | integer | The generation returned by `begin` |

Returns `201 { generation, assignment, idempotent: false }` (or `200` on retry). A stale generation, changed input, unexpected holder, or overlapping global holder → 409 without changes. Do not fall back to `POST /v1/role-assignments` after a 409; re-read current state and begin a new handoff.

---

## Permissions

Permission object: `{ id, principal_id, effect, action, resource, environment_scope, created_at }`.

All routes require `ims:manage-permissions`; mutations are **realm required** and audited. `environment_scope: null` also requires `ims:grant-global`.

| Method | Path | Body / Query | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/v1/permissions` | `effect` (`allow`/`deny`), `action`, `resource` (required), `principal_id`, `environment_scope` | 201 | 400, 404 principal |
| GET | `/v1/permissions` | `?principal_id=` | 200 array | |
| GET | `/v1/permissions/{id}` | | 200 | 404 |
| PUT | `/v1/permissions/{id}` | any of the create fields | 200 | 400, 404 |
| DELETE | `/v1/permissions/{id}` | | 204 | 404 |

---

## Audit Log

### GET /v1/audit-log

**Permission:** `ims:read-audit-log`. Query: `realm` (**required**), `event_type`, `actor_principal_id`, `target_principal_id`, `limit` (default 100, max 1000). Returns newest first:

```json
[{ "id": "uuid", "event_type": "role.create", "actor_principal_id": "uuid", "target_principal_id": null,
   "before_state": null, "after_state": { }, "request_id": "…", "created_at": "timestamp" }]
```

**Event types:**

| Area | Events |
|------|--------|
| Principals & identities | `ensure`, `external-identity.link`, `external-identity.link-denied`, `external-identity.unlink` |
| Authorization | `permission.denied` (management gate), `check.deny` (explicit-deny decisions) |
| RBAC | `role.create`, `role.update`, `role.delete`, `role.permission-attach`, `role.permission-detach`, `role-assignment.create`, `role-assignment.update`, `role-assignment.delete`, `role-assignment.handoff-begin`, `role-assignment.handoff-grant`, `permission.create`, `permission.update`, `permission.delete` |
| Realm administration | `realm.create`, `realm.update`, `client.create`, `user.invite`, `user.disabled`, `user.enabled`, `sessions.revoke`, `mfa.reset`, `admin.mutation-denied` |
| Sign-in | `login.challenge-issued`, `login.challenge-consumed`, `login.challenge-delivery-failed`, `login.magic-link-rejected`, `login.totp-enrolled`, `login.totp-verified`, `login.recovery-acknowledged`, `login.recovery-consumed`, `login.completed`, `authorize.reject` |
| OIDC artifacts | `oidc.artifact-upsert`, `oidc.artifact-consume`, `oidc.artifact-destroy`, `oidc.artifact-revoke`, `oidc.artifact-revoked`, `oidc.artifact-expire` |

---

## Realm Administration

Realm object: `{ id, name, display_name, status, login_policy }`.

Login policy fields:

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `mfa_required` | boolean | `true` | Cannot be `false` for a realm named `platform` |
| `device_code_enabled` | boolean | `false` | Must be `false` (device flow is not supported) |
| `magic_link_ttl_seconds` | integer | `900` | Minimum 60 |
| `session_ttl_seconds` | integer | `28800` | Minimum 300 |

| Method | Path | Permission | Body | Success |
|--------|------|------------|------|---------|
| POST | `/v1/realms` | `ims:manage-realms` | `name` (`^[a-z0-9-]{2,64}$`), `display_name`, `login_policy` | 201 realm |
| GET | `/v1/realms` | `ims:manage-realms` | | 200 `{ items: [realm] }` (a realm-local admin sees only its realm) |
| GET | `/v1/realms/{name}` | `ims:manage-realms` | | 200 realm |
| PATCH | `/v1/realms/{name}` | `ims:manage-realms` | any of `display_name`, `status` (`active`/`disabled`), `login_policy` (merged) | 200 realm |
| POST | `/v1/realms/{name}/clients` | `ims:manage-realms` | see below | 201 client |
| POST | `/v1/realms/{name}/users` | `ims:manage-principals` | `email` (required), `display_name` | 201 account (new) / 200 (existing) |
| GET | `/v1/realms/{name}/users/{principalId}` | `ims:manage-principals` | | 200 account |
| POST | `/v1/realms/{name}/users/{principalId}/disable` | `ims:manage-principals` | optional `{ "reason": "..." }` | 200 account |
| POST | `/v1/realms/{name}/users/{principalId}/enable` | `ims:manage-principals` | empty | 200 account |
| POST | `/v1/realms/{name}/users/{principalId}/sessions/revoke` | `ims:manage-principals` | optional `{ "reason": "..." }` | 204 |
| POST | `/v1/realms/{name}/users/{principalId}/mfa/reset` | `ims:reset-mfa` | `{ "reason": "..." }` (required) | 204 |

Unknown body fields are rejected. Enabling returns an account to `active` if its email was verified, otherwise to `invited`. MFA reset requires an `active` account.

**Client registration body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `client_id` | string | No | Generated if omitted |
| `display_name` | string | Yes | Shown on sign-in pages |
| `redirect_uris` | string[] | Yes | Exact `https://` or loopback `http://` URIs |
| `post_logout_redirect_uris` | string[] | No | Same rules |
| `scopes` | string[] | No | Default `["openid","email","profile"]`; must include `openid`; allowed: `openid`, `email`, `profile`, `offline_access`, `admin:environments:read`, `admin:environments:write` |
| `token_endpoint_auth_method` | string | No | `none` (default, public), `client_secret_basic`, or `client_secret_post` |

The response includes `client_secret` **only once**, for confidential clients. There are no endpoints to list, update, or delete clients, or to list realm users, in this version.

**Local account object:** `{ id, realm_id, principal_id, principal_type, email, email_verified_at, status (invited|active|disabled), auth_generation, created_at, updated_at }`.

**Realm-admin errors:**

| Status | `error` | Cause |
|--------|---------|-------|
| 400 | `INVALID_REALM`, `INVALID_REALM_UPDATE`, `INVALID_CLIENT`, `INVALID_EMAIL`, `INVALID_REQUEST` | Malformed or unsupported body |
| 400 | policy message (for example `platform realm requires MFA`) | Login policy rule violated |
| 404 | `realm not found` / `user not found` | |
| 409 | `CONFLICT` | Realm name or client ID already exists |
| 409 | `ACCOUNT_DISABLED` | Inviting an email whose account is disabled |
| 409 | `account already disabled` / `account already enabled` / `MFA reset requires an active account` | Lifecycle conflict |

---

## OpenID Provider Endpoints

Each realm is served under `/realms/{realm}` with issuer `{IMS_PUBLIC_URL}/realms/{realm}`. Read endpoint URLs from the discovery document rather than hard-coding them:

```
GET /realms/{realm}/.well-known/openid-configuration
```

It advertises the authorization, token, userinfo, JWKS, introspection, and end-session endpoints. An unknown realm returns 404 `REALM_NOT_FOUND`; a disabled realm returns 503 `REALM_DISABLED`.

| Capability | Setting |
|------------|---------|
| Response types | `code` |
| Grant types | `authorization_code`, `refresh_token` |
| PKCE | Required, `S256` |
| Scopes | `openid`, `email`, `profile`, `offline_access`, `admin:environments:read`, `admin:environments:write` |
| ACR values | `urn:firefoundry:acr:email`, `urn:firefoundry:acr:mfa` |
| Access tokens | Opaque |
| Introspection | Allow-listed confidential clients only |
| Resource indicators | Only the Admin API resource (`IMS_ADMIN_API_RESOURCE`) |
| Device flow, client credentials | Not enabled |

### Sign-in interaction pages

Browser-facing HTML pages used during the authorization flow (not called directly by applications):

| Path under `/realms/{realm}/interaction/{uid}` | Purpose |
|-------------------------------------------------|---------|
| `GET ` (root) | Start: email form, or the next pending step |
| `POST /email` | Submit email; always redirects to `check-email` |
| `GET /check-email` | "Check your email" page |
| `GET /verify?token=…` | Email link target |
| `GET`/`POST /totp` | TOTP verification |
| `POST /totp/enrol` | Confirm TOTP enrolment |
| `GET`/`POST /recovery` | Sign in with a recovery code |
| `GET /recovery-codes/download` | Download pending recovery codes |
| `POST /recovery-codes/ack` | Acknowledge recovery codes and finish enrolment |

If no mail transport is configured, these paths return `503 { "error": "NATIVE_LOGIN_UNAVAILABLE" }`.

---

## Configuration

### Service and database

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development`, `production`, or `test`. `production` makes the OIDC signing and cookie keys mandatory and disables the local mail sink |
| `PORT` | `8081` | HTTP port |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SERVICE_NAME` | `ff-services-identity` | Reported by `/health` and `/status` |
| `PG_HOST` | `localhost` | PostgreSQL host |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_DATABASE` | `ims` | Database name |
| `PG_USER` | `ims` | Database role |
| `PG_PASSWORD` | (empty) | Database password (secret) |
| `PG_POOL_MAX` / `PG_POOL_MIN` | `10` / `2` | Connection pool bounds |
| `PG_SSL_DISABLED` | `false` | `true` disables TLS. TLS is also skipped automatically for `localhost`/`127.0.0.1` |

### Identity and OIDC

| Variable | Default | Description |
|----------|---------|-------------|
| `IMS_PUBLIC_URL` | `http://127.0.0.1:8081` | External base URL; realm issuers are `{IMS_PUBLIC_URL}/realms/{realm}`. Use HTTPS in real deployments (also makes the sign-in cookie `Secure`) |
| `IMS_TRUST_PROXY_HOPS` | `0` | Number of trusted reverse-proxy hops (0–5) for client IP resolution and forwarded-protocol handling |
| `IMS_CREDENTIAL_KEY` | none | **Required.** 32 random bytes, base64. Encrypts TOTP and client secrets |
| `IMS_OIDC_JWKS` | ephemeral (non-production only) | Private JWKS (JSON) for signing ID tokens; required in production |
| `IMS_OIDC_COOKIE_KEY` | random (non-production only) | Cookie signing key(s), ≥32 characters; JSON array or comma-separated for rotation; required in production |
| `IMS_OIDC_CLIENT_SECRETS` | `{}` | JSON object `"realm/client_id" → secret` for externally provisioned confidential clients |
| `IMS_ADMIN_API_RESOURCE` | `urn:firefoundry:admin-api` | The only accepted resource indicator |
| `IMS_INTROSPECTION_CLIENT_IDS` | empty (nobody) | Confidential clients allowed to introspect: JSON array (all realms), JSON object `realm → [ids]`, or comma-separated list. Malformed JSON fails startup |
| `IMS_MAIL_TRANSPORT` | `local-sink` in development, otherwise unset | `local-sink` (non-production only) or `notification-service` (not yet implemented). Unset disables native sign-in pages |
| `IMS_MAIL_SINK_DIR` | `.ims-mail-sink` | Directory for `local-sink` messages (owner-readable JSON and EML files) |

### Entitlements

IMS checks the platform entitlement for check site `identity.access` on every request except `/health`, `/ready`, and `/realms/*`.

| Variable | Default | Description |
|----------|---------|-------------|
| `FF_ENTITLEMENT_MODE` | `report` | `report` logs would-refuse decisions without refusing; `enforce` refuses |
| `FF_ENTITLEMENT_AGENT_URL` | `http://ff-entitlement-agent:8090` | Entitlement agent URL |
| `FF_ENTITLEMENT_ISSUER` | `https://license.firefoundry.ai` | Entitlement token issuer |
| `FF_ENTITLEMENT_JWKS_URL` | `https://license.firefoundry.ai/.well-known/jwks.json` | Issuer key set |
| `FF_ENTITLEMENT_POLL_SECONDS` | `30` | Must be positive; invalid values fail startup |
| `FF_CLUSTER_REF` | none | Cluster UUID (lowercase RFC 4122) |
| `FF_NAMESPACE` | pod namespace | Kubernetes namespace; read from the service account if unset |

An invalid `FF_CLUSTER_REF` or namespace fails startup in `enforce` mode and runs unlicensed in `report` mode.

## Related

- [Concepts](./concepts.md)
- [Security Model](./security-model.md)
- [Operations](./operations.md)
