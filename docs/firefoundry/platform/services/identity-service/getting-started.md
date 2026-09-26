# Identity Management Service — Getting Started

This walkthrough takes a fresh IMS installation from an empty database to a working permission check and an OIDC-ready realm. It uses `curl` and `jq` against the REST API.

## Prerequisites

- IMS deployed with its database migrations applied (see [Operations](./operations.md#deployment)). In `firefoundry-core` this means `identity-service.enabled: true` with the migration Job enabled.
- `kubectl` access to the namespace, and `psql` access to the IMS database (`ims`) for the one-time bootstrap step.
- `curl`, `jq`, and `openssl` on your workstation.

Port-forward the service (the Service name follows the `<release>-identity-service` pattern; `firefoundry-core` is the usual release name):

```bash
kubectl port-forward svc/firefoundry-core-identity-service -n ff-dev 8081:8081
export IMS=http://localhost:8081
```

From inside the cluster, use `http://firefoundry-core-identity-service.<namespace>.svc.cluster.local:8081`.

## Step 1: Check That IMS Is Up

```bash
curl -s $IMS/health | jq
# {"status":"healthy","service":"ff-services-identity","version":"0.1.0","timestamp":"..."}

curl -s -w '\nHTTP %{http_code}\n' $IMS/ready
# {"ready":true,"database":"connected"}
# HTTP 200
```

`/ready` returns 503 with `"database":"disconnected"` if IMS cannot reach PostgreSQL.

## Step 2: Bootstrap an Administrator API Key

A new installation has no principals or keys, so every management call returns 401. Create the first administrative principal directly in the database. See [Security Model — Bootstrap](./security-model.md#bootstrap) for why this is not an HTTP endpoint.

Generate a key and store it somewhere safe (a password manager or secret store). You will pass it in the `X-API-Key` header:

```bash
export IMS_API_KEY="$(openssl rand -hex 32)"
KEY_HASH="$(printf '%s' "$IMS_API_KEY" | sha256sum | cut -d' ' -f1)"
```

Connect to the `ims` database and create a `ServiceAccount` principal in the `default` realm, bind the key's SHA-256 digest to it, and grant it the management permissions this walkthrough uses:

```bash
psql "host=<pg-host> dbname=ims user=<admin-or-ims-user>" -v key_hash="$KEY_HASH" <<'SQL'
BEGIN;
WITH p AS (
  INSERT INTO ims.principal (type, display_name)
  VALUES ('ServiceAccount', 'IMS bootstrap admin')
  RETURNING id
), k AS (
  INSERT INTO ims.external_identity (principal_id, source, external_value)
  SELECT id, 'ims-internal-api-key', :'key_hash' FROM p
)
INSERT INTO ims.permission (principal_id, effect, action, resource)
SELECT p.id, 'allow'::ims.permission_effect, a, 'ims'
FROM p, unnest(ARRAY[
  'ims:manage-realms', 'ims:manage-principals', 'ims:ensure-principal',
  'ims:manage-groups', 'ims:manage-roles', 'ims:manage-role-assignments',
  'ims:manage-permissions', 'ims:read-audit-log'
]) AS a;
COMMIT;
SQL
```

Rows created without an explicit realm belong to the `default` realm. A key bound in the `default` realm can administer every realm, so treat this key as a break-glass credential and narrow or retire it once per-realm administrators exist.

Verify the key works:

```bash
curl -s "$IMS/v1/realms" -H "X-API-Key: $IMS_API_KEY" | jq '.items[].name'
# "default"
```

## Step 3: Create a Realm

Realms isolate principals and grants. Create one for an application:

```bash
curl -s -X POST "$IMS/v1/realms" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name": "acme", "display_name": "Acme Support Portal"}' | jq
```

```json
{
  "id": "0b5e…",
  "name": "acme",
  "display_name": "Acme Support Portal",
  "status": "active",
  "login_policy": {
    "mfa_required": true,
    "device_code_enabled": false,
    "magic_link_ttl_seconds": 900,
    "session_ttl_seconds": 28800
  }
}
```

The default login policy requires MFA. You can pass a `login_policy` object to change the TTLs or MFA requirement.

## Step 4: Create a Service Principal

Register the agent bundle that will be authorized. Mutations must name their realm, here in the body:

```bash
BUNDLE=$(curl -s -X POST "$IMS/v1/principals" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "type": "AgentBundle", "display_name": "case-triage-bundle"}' | jq -r .id)
echo $BUNDLE
```

## Step 5: Grant a Permission Through a Role

Create a reusable permission (no `principal_id`) scoped to the `prod` environment:

```bash
PERM=$(curl -s -X POST "$IMS/v1/permissions" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "effect": "allow", "action": "cases:read", "resource": "case:*", "environment_scope": "prod"}' \
  | jq -r .id)
```

Create a role, attach the permission, and assign the role to the bundle in `prod`:

```bash
ROLE=$(curl -s -X POST "$IMS/v1/roles" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "name": "case-reader"}' | jq -r .id)

curl -s -X POST "$IMS/v1/roles/$ROLE/permissions" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"permission_id\": \"$PERM\"}"

curl -s -X POST "$IMS/v1/role-assignments" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"role_id\": \"$ROLE\", \"environment_scope\": \"prod\"}" | jq
```

Omitting `environment_scope` stores the value `default`. Passing `null` makes a global grant and requires the extra `ims:grant-global` permission, which the bootstrap key in Step 2 intentionally does not have.

## Step 6: Check Permissions

`/v1/check` is the policy decision endpoint your services call:

```bash
curl -s -X POST "$IMS/v1/check" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"action\": \"cases:read\", \"resource\": \"case:42\", \"environment_scope\": \"prod\"}"
# {"allowed":true,"reason":"role-allow"}

curl -s -X POST "$IMS/v1/check" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"action\": \"cases:read\", \"resource\": \"case:42\", \"environment_scope\": \"dev\"}"
# {"allowed":false,"reason":"no-matching-permission"}
```

Now add a direct deny for restricted cases and check again:

```bash
curl -s -X POST "$IMS/v1/permissions" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"effect\": \"deny\", \"action\": \"cases:*\", \"resource\": \"case:restricted-*\", \"environment_scope\": \"prod\"}" > /dev/null

curl -s -X POST "$IMS/v1/check-batch" -H 'Content-Type: application/json' -d "{
  \"checks\": [
    {\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"action\": \"cases:read\", \"resource\": \"case:42\", \"environment_scope\": \"prod\"},
    {\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"action\": \"cases:read\", \"resource\": \"case:restricted-7\", \"environment_scope\": \"prod\"}
  ]}" | jq
```

```json
{
  "results": [
    { "allowed": true,  "reason": "role-allow" },
    { "allowed": false, "reason": "explicit-deny" }
  ]
}
```

The deny wins over the role's allow. Always send `environment_scope` on checks if you depend on environment separation; a check without it ignores scope entirely.

## Step 7: Ensure a Principal for an Externally Authenticated User

When one of your services has authenticated a user against your own IdP, it canonicalizes that identity into an IMS principal. The call is idempotent:

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "$IMS/v1/principals/ensure" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "type": "HumanUser", "source": "corp-oidc", "external_value": "subject-8f2d", "display_name": "Dana Example"}'
# {...,"type":"HumanUser","status":"active",...}
# HTTP 201

# Same call again returns the same principal
# HTTP 200
```

In production, give this capability (`ims:ensure-principal`) to the authenticating service's own principal rather than using the bootstrap key.

## Step 8: Prepare the Realm for Sign-in

Register a public OIDC client (for example a single-page app or CLI on loopback):

```bash
curl -s -X POST "$IMS/v1/realms/acme/clients" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "client_id": "acme-portal",
    "display_name": "Acme Portal",
    "redirect_uris": ["http://127.0.0.1:3000/callback"],
    "scopes": ["openid", "email", "profile"],
    "token_endpoint_auth_method": "none"
  }' | jq
```

Invite a user by email. This creates an `invited` `HumanUser` principal and local account; it does not send an email by itself:

```bash
curl -s -X POST "$IMS/v1/realms/acme/users" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"email": "dana@example.com", "display_name": "Dana Example"}' | jq '{principal_id, status}'
```

Point your client's OIDC library at the realm issuer. The discovery document lists the authorization, token, userinfo, JWKS, introspection, and end-session endpoints:

```bash
curl -s "$IMS/realms/acme/.well-known/openid-configuration" | jq '{issuer, authorization_endpoint, token_endpoint}'
```

The issuer is derived from `IMS_PUBLIC_URL`, so set that to the externally reachable HTTPS address in real deployments. Use the authorization code flow with PKCE (S256); IMS rejects requests without it. When the user signs in, IMS emails a one-time link and then enrols or verifies TOTP.

> Sign-in email delivery currently requires the development `local-sink` mail transport, which writes messages to files inside the container and is refused when `NODE_ENV=production`. See [Operations — Current limitations](./operations.md#current-limitations).

## Step 9: Read the Audit Log

```bash
curl -s "$IMS/v1/audit-log?realm=acme&limit=10" -H "X-API-Key: $IMS_API_KEY" \
  | jq '.[] | {event_type, actor_principal_id, created_at}'
```

You will see entries such as `realm.create`, `permission.create`, `role.create`, `role.permission-attach`, `role-assignment.create`, `ensure`, `client.create`, and `user.invite`.

## Next Steps

- [Concepts](./concepts.md) — groups, inheritance, and evaluation in depth
- [Security Model](./security-model.md) — least-privilege grants, realm authority, and token model
- [Reference](./reference.md) — every endpoint and field
- [Operations](./operations.md) — required secrets and production configuration
