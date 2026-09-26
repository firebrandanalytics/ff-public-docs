# Identity Management Service — Getting Started

This walkthrough models a small app's authorization in IMS, checks a permission the way an agent bundle would, and prepares the realm so end users can sign in. It uses `curl` and `jq` against the REST API.

## Prerequisites

- IMS enabled in your environment (see [Operations — Enabling IMS](./operations.md#enabling-ims-for-your-app)).
- An **administrator API key**. Your environment administrator provisions an admin API key for you. This walkthrough assumes it can create a realm; if your administrator has already created your realm and gave you a key scoped to it, skip Step 2.
- `kubectl` access to the namespace, plus `curl` and `jq`.

Port-forward the service (named `<release>-identity-service`, usually `firefoundry-core-identity-service`):

```bash
kubectl port-forward svc/firefoundry-core-identity-service -n ff-dev 8081:8081
export IMS=http://localhost:8081
export IMS_API_KEY=...   # from your environment administrator; keep it out of shell history and Git
```

From inside the cluster (your backend or agent bundle), use `http://firefoundry-core-identity-service.<namespace>.svc.cluster.local:8081`.

## Step 1: Check That IMS Is Up

```bash
curl -s $IMS/health | jq
# {"status":"healthy","service":"ff-services-identity","version":"0.1.0","timestamp":"..."}

curl -s $IMS/v1/realms -H "X-API-Key: $IMS_API_KEY" | jq '.items[].name'
```

A `401` means the key is missing or not recognized; a `403` means the key works but lacks `ims:manage-realms`.

## Step 2: Create a Realm for Your App

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

MFA is required by default. Pass a `login_policy` object to change the TTLs or the MFA requirement.

## Step 3: Register Your Agent Bundle as a Principal

Management writes must name their realm, here in the body:

```bash
BUNDLE=$(curl -s -X POST "$IMS/v1/principals" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "type": "AgentBundle", "display_name": "case-triage-bundle"}' | jq -r .id)
echo $BUNDLE
```

## Step 4: Grant a Permission Through a Role

Create a reusable permission (no `principal_id`) for the `prod` environment:

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

Omitting `environment_scope` stores `default`. Passing `null` makes a global grant, which needs the extra `ims:grant-global` permission.

## Step 5: Check Permissions

`/v1/check` is the endpoint your backend and bundles call before acting. It takes no API key, so call it only from inside the cluster.

```bash
curl -s -X POST "$IMS/v1/check" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"action\": \"cases:read\", \"resource\": \"case:42\", \"environment_scope\": \"prod\"}"
# {"allowed":true,"reason":"role-allow"}

curl -s -X POST "$IMS/v1/check" -H 'Content-Type: application/json' \
  -d "{\"realm\": \"acme\", \"principal_id\": \"$BUNDLE\", \"action\": \"cases:read\", \"resource\": \"case:42\", \"environment_scope\": \"dev\"}"
# {"allowed":false,"reason":"no-matching-permission"}
```

Add a direct deny for restricted cases and check a batch:

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

The deny wins over the role's allow. If you depend on environment separation, always send `environment_scope`; a check without it ignores scope.

### Calling the check from an agent bundle

There is no SDK client for IMS yet; call the endpoint over HTTP. A minimal helper:

```typescript
const IMS_URL = process.env.IMS_URL
  ?? "http://firefoundry-core-identity-service.ff-dev.svc.cluster.local:8081";

export async function isAllowed(
  principalId: string, action: string, resource: string,
): Promise<boolean> {
  const res = await fetch(`${IMS_URL}/v1/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      realm: "acme",
      principal_id: principalId,
      action,
      resource,
      environment_scope: "prod",
    }),
  });
  if (!res.ok) return false;          // fail closed on 4xx/5xx or unreachable IMS
  const { allowed } = await res.json();
  return allowed === true;
}
```

`IMS_URL` here is an environment variable of your own bundle, not an IMS setting. Take `principalId` from a trusted source (the signed-in user's ID token or your own session), never from untrusted request input.

## Step 6: Onboard Users From Your Own IdP (Optional)

If your app authenticates users elsewhere, map each authenticated user to a principal. The call is idempotent:

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "$IMS/v1/principals/ensure" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "type": "HumanUser", "source": "corp-oidc", "external_value": "subject-8f2d", "display_name": "Dana Example"}'
# {...,"type":"HumanUser","status":"active",...}
# HTTP 201   (the same call again returns HTTP 200 and the same principal)
```

In production, give your backend's own principal `ims:ensure-principal` rather than using an admin key.

## Step 7: Sign Users In With IMS (Optional)

Register an OIDC client for your app. For a single-page app or CLI, use a public client:

```bash
curl -s -X POST "$IMS/v1/realms/acme/clients" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "client_id": "acme-portal",
    "display_name": "Acme Portal",
    "redirect_uris": ["http://127.0.0.1:3000/callback"],
    "scopes": ["openid", "email", "profile", "offline_access"],
    "token_endpoint_auth_method": "none"
  }' | jq
```

For a server-side web app, use `client_secret_basic` or `client_secret_post` instead; the response includes `client_secret` **only once**, so store it in a secret manager immediately. Redirect URIs must be exact `https://` URIs (or `http://` loopback URIs for local development).

Invite a user. This creates an `invited` principal; it does not send an email by itself:

```bash
curl -s -X POST "$IMS/v1/realms/acme/users" \
  -H "X-API-Key: $IMS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"email": "dana@example.com", "display_name": "Dana Example"}' | jq '{principal_id, status}'
```

Point your app's OIDC library at the realm issuer and let it read the discovery document:

```bash
curl -s "$IMS/realms/acme/.well-known/openid-configuration" | jq '{issuer, authorization_endpoint, token_endpoint}'
```

Configure the library for the **authorization code flow with PKCE (S256)**; IMS rejects authorization requests without PKCE. When the user signs in, IMS emails a one-time link and then enrols or verifies their authenticator app (see [Concepts — Signing users in](./concepts.md#signing-users-in-with-ims)). After the code exchange, the ID token's `sub` is the user's principal ID; use it for `/v1/check`.

The issuer must match the address browsers use. Ask your environment administrator for IMS's public URL; if discovery shows a loopback issuer such as `http://127.0.0.1:8081/...`, the public URL has not been configured.

> Native sign-in is not yet available in production environments; in development environments, sign-in emails are captured rather than delivered. See [Operations — Current limitations](./operations.md#current-limitations).

## Step 8: Read the Audit Log

```bash
curl -s "$IMS/v1/audit-log?realm=acme&limit=10" -H "X-API-Key: $IMS_API_KEY" \
  | jq '.[] | {event_type, actor_principal_id, created_at}'
```

You will see entries such as `realm.create`, `permission.create`, `role.create`, `role.permission-attach`, `role-assignment.create`, `ensure`, `client.create`, and `user.invite`.

## Next Steps

- [Concepts](./concepts.md) — groups, inheritance, evaluation, and securing your app's use of IMS
- [Reference](./reference.md) — every endpoint and field
- [Operations](./operations.md) — enabling IMS and troubleshooting
