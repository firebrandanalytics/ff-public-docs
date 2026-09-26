# Identity Management Service — Operations

How to enable IMS for your app, verify it, the limits to design around, and caller-side troubleshooting.

## Enabling IMS for Your App

IMS is an **opt-in** part of `firefoundry-core`:

```yaml
identity-service:
  enabled: true   # default is false
```

Note the `identity-service.` prefix: subchart values are namespaced under the umbrella chart. Enabling IMS also requires its database and signing/encryption keys; your environment administrator supplies those. Once enabled, IMS listens on port **8081** behind an in-cluster Service named `<release>-identity-service` (for example `firefoundry-core-identity-service`).

Settings an app team typically needs to agree with its environment administrator:

| Setting | Why your app cares |
|---------|--------------------|
| IMS public URL (`IMS_PUBLIC_URL` in `identity-service.configMap.data`) | Realm issuers are `<public URL>/realms/{realm}` and sign-in links point there. Must be the external `https://` address your users' browsers reach. |
| Ingress / gateway routing | Only the `/realms/` path prefix should be public, and only if your app uses IMS sign-in. Keep `/v1/*` internal. |
| Trusted proxy hops (`IMS_TRUST_PROXY_HOPS`) | Must equal the number of proxies in front of IMS (typically `1`), or sign-in rate limits treat all users as one client. |
| Token introspection allow-list (`IMS_INTROSPECTION_CLIENT_IDS`) | If a backend of yours validates opaque access tokens by introspection, its confidential client ID must be listed. By default no client can introspect. |
| Network access to `/v1/check` | Ask for NetworkPolicies that let only your backend, bundles, and functions reach IMS. |
| Your realm and admin API key | Your environment administrator provisions an admin API key (and, if needed, your realm). |

## Verifying IMS From a Bundle

From a pod in the same namespace:

```bash
curl -s http://firefoundry-core-identity-service:8081/health
# {"status":"healthy","service":"ff-services-identity","version":"0.1.0",...}

curl -s -w '\nHTTP %{http_code}\n' http://firefoundry-core-identity-service:8081/ready
# {"ready":true,"database":"connected"}
# HTTP 200
```

Then run a check for a principal you know has a grant (see [Getting Started — Step 5](./getting-started.md#step-5-check-permissions)). For sign-in, confirm the discovery document at `<public URL>/realms/<realm>/.well-known/openid-configuration` loads from a browser and shows the expected `issuer`.

## Limits and Behavior to Design Around

| Item | Behavior |
|------|----------|
| Batch checks | 1–100 checks per `/v1/check-batch` request |
| Audit log page size | `limit` default 100, max 1000; newest first |
| Realm names | `^[a-z0-9-]{2,64}$` |
| Sign-in link lifetime | Realm `magic_link_ttl_seconds`, default 900 (15 minutes), minimum 60 |
| Session and grant lifetime | Realm `session_ttl_seconds`, default 28800 (8 hours), minimum 300 |
| Sign-in rate limiting | Per email/account and per client address over a 15-minute window; returns 429 |
| Sign-in links | Single use, and must be opened in the browser that started sign-in |
| Access tokens | Opaque — validate by introspection (allow-listed clients) or rely on the ID token |
| Management API auth | `X-API-Key` only; bearer tokens are not accepted |
| Realm policy and client changes | Normally immediate; if a change to a realm's login policy or a newly registered client is not picked up, ask your environment administrator to restart IMS |

## Current Limitations

- **Native sign-in is not available in production environments yet.** Sign-in email delivery through the [Notification Service](../notification-service/README.md) is in development. In development environments, sign-in emails are captured by a development mail sink instead of being sent; ask your environment administrator how to retrieve them. The principal, RBAC, and `/v1/check` APIs are unaffected. If your app needs production sign-in today, authenticate users with your own IdP and use [`ensure`](./concepts.md#external-identities-and-ensure).
- **No endpoints to list, update, or delete OIDC clients, list realm users, or delete realms.** Record client IDs and secrets when you register them; ask your environment administrator for changes.
- **No self-service API keys for new service principals.** Your environment administrator provisions them.
- **No directory sync** from external IdPs; principals are created on demand through `ensure` or invites.
- **Not enabled:** device authorization flow, client credentials grant, and dynamic client registration.
- **No metrics endpoint.** Use `/health`, `/ready`, and the audit log.

## Monitoring Your Realm

Read the audit log with a key holding `ims:read-audit-log`:

```bash
curl -s "$IMS/v1/audit-log?realm=acme&event_type=permission.denied&limit=50" -H "X-API-Key: $IMS_API_KEY"
```

Useful signals: spikes in `permission.denied` or `admin.mutation-denied` (callers missing `ims:*` permissions), any `external-identity.link-denied`, `authorize.reject` (malformed sign-in requests, for example missing PKCE), `login.magic-link-rejected`, `login.challenge-delivery-failed`, and `mfa.reset` or `sessions.revoke` events you did not expect.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| 401 `X-API-Key header is required` | Header missing | Send `X-API-Key` on management calls |
| 401 `X-API-Key does not match a known service principal` | Key unknown, bound in a different realm, or its principal is deprovisioned | Confirm with your environment administrator which realm the key belongs to |
| 400 `a realm selector is required` | Write without a realm | Add `"realm"` to the body or `?realm=` to the URL |
| 400 about conflicting realm selectors | Body, query, and path name different realms | Send one consistent realm |
| 403 `FORBIDDEN` | Caller lacks the `ims:*` permission named in the message | Ask for that exact permission on your key's principal |
| 403 creating a grant with `environment_scope: null` | Global grants need `ims:grant-global` | Use a specific scope, or ask for the permission |
| 404 `REALM_NOT_FOUND` | Realm name typo or realm not created | Check `GET /v1/realms` |
| 409 creating a group/role/realm/client | Name or client ID already exists | Reuse the existing object or pick a new name |
| 409 `PRINCIPAL_DEPROVISIONED` from `ensure` | The identity belongs to a deprovisioned user | Reactivate with `PUT /v1/principals/{id}` if appropriate |
| `/v1/check` returns `no-matching-permission` unexpectedly | Different `realm` or `environment_scope` than the grants, expired role assignment, or pattern mismatch | Send the same realm and scope the grants use; check `expires_at`; test the pattern |
| `/v1/check` unreachable from a bundle | Network policy or wrong Service name/port | Use `<release>-identity-service:8081`; ask for network access |
| Discovery `issuer` shows `http://127.0.0.1:8081/...` | IMS public URL not configured | Ask your environment administrator to set it |
| Authorization request rejected | Missing PKCE, `plain` PKCE method, unregistered redirect URI, or unregistered scope | Use PKCE S256 and exact registered redirect URIs and scopes |
| Sign-in page returns 503 `NATIVE_LOGIN_UNAVAILABLE` | Sign-in email delivery not configured in this environment | See [Current limitations](#current-limitations) |
| Realm endpoints return 503 `REALM_DISABLED` | Realm status is `disabled` | `PATCH /v1/realms/{name}` with `{"status":"active"}` |
| User sees "The link is invalid, expired, already used, or was opened outside the browser where sign-in began" | Link opened in another browser/device, reused, or expired | Start sign-in again and open the new link in the same browser |
| Users get 429 during sign-in | Rate limit, or all traffic appears to come from one proxy address | Wait, or ask your administrator to check the trusted proxy hop setting |
| Refresh fails after an admin action | User was disabled, sessions revoked, or MFA reset | Send the user through sign-in again |
| Confidential client gets `invalid_client` | Wrong or lost client secret | Use the secret from registration; if lost, register a new client |
| Introspection refused | Client is public or not on the introspection allow-list | Use a confidential client and ask for it to be allow-listed |

## Related

- [Reference](./reference.md)
- [Concepts](./concepts.md)
- [Platform Operations](../../operations.md)
- [Deployment Guide](../../deployment.md)
