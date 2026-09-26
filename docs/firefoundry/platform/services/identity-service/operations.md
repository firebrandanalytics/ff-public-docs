# Identity Management Service — Operations

Deployment, configuration, health checks, scaling, security hardening, monitoring, and troubleshooting for IMS.

## Deployment

IMS ships as the `identity-service` Helm chart (chart version 0.1.0, app version 0.1.0), deployed as an **opt-in** subchart of `firefoundry-core`:

```yaml
identity-service:
  enabled: false   # default — set to true to deploy IMS
```

The container image runs as a non-root user (UID/GID 1001), listens on port **8081**, and is exposed through a `ClusterIP` Service named `<release>-identity-service` (for example `firefoundry-core-identity-service`). Ingress is disabled by default.

### Database

IMS uses its **own** PostgreSQL database and role, both named `ims` by default (`PG_DATABASE` / `PG_USER`), separate from the shared FireFoundry database roles. Host, port, and TLS settings come from the umbrella's shared database ConfigMap through `global.envFrom`.

With `identity-service.migration.enabled: true` (the default when IMS is enabled), `firefoundry-core` runs an `identity-migration` Job that:

1. Waits for PostgreSQL.
2. Creates the `ims` role (or resets its password) and the `ims` database if they do not exist, using the admin credentials in `migration.secretName`.
3. Copies the SQL migrations out of the IMS image and applies them with Flyway (history table `flyway_schema_history_ims`, schema `ims`).
4. Verifies the `ims` schema exists and grants the runtime role access to it.

The Job reads the runtime role password from the chart-managed Secret `<release>-identity-service` (key `PG_PASSWORD`), so the role it creates always matches what the pods use. If you point `identity-service.secret.existingSecret` at a differently named Secret, the migration Job cannot find the password; keep the chart-managed Secret or give your Secret that name.

The IMS service does **not** migrate its own schema. `/ready` only checks connectivity (`SELECT 1`), so a pod can report Ready against an empty database. Make sure the migration Job succeeds before relying on the API. If you disable the Job, create the role and database yourself and apply the migrations shipped in the image under `/app/migrations`.

### Key values

| Value | Default | Description |
|-------|---------|-------------|
| `identity-service.enabled` | `false` | Deploy IMS |
| `identity-service.replicaCount` | `2` | **Set to `1`** — see [Scaling](#scaling) |
| `identity-service.image.repository` / `.tag` | registry image / chart appVersion | Container image |
| `identity-service.migration.enabled` | `true` | Run the Flyway migration Job |
| `identity-service.migration.secretName` | `identity-db-admin-secret` | Secret with `username` / `password` keys for a role that can `CREATE ROLE` and `CREATE DATABASE` |
| `identity-service.migration.autoCreateSecret` | `false` | Let the chart create that Secret from `migration.adminUsername` / `migration.adminPassword` |
| `identity-service.configMap.data` | `NODE_ENV=production`, `LOG_LEVEL=info`, `PG_DATABASE=ims`, `PG_USER=ims`, pool sizes | Non-secret environment variables |
| `identity-service.secret.data` | `{}` | Secret environment variables; `PG_PASSWORD` is required for the chart to render |
| `identity-service.secret.existingSecret` | `""` | Use a pre-existing Secret instead |
| `identity-service.service.port` | `8081` | Service port |
| `identity-service.resources` | requests `100m`/`128Mi`, limits `500m`/`512Mi` | Container resources |
| `identity-service.autoscaling.enabled` | `false` | Leave disabled |

### Required configuration beyond the chart defaults

The chart defaults are not sufficient to start IMS. With `NODE_ENV=production` (the chart default) you must also provide:

| Variable | Where | Why |
|----------|-------|-----|
| `IMS_CREDENTIAL_KEY` | Secret | The process exits at startup without a valid 32-byte base64 key |
| `IMS_OIDC_COOKIE_KEY` | Secret | Startup fails in production without it |
| `IMS_OIDC_JWKS` | Secret | OIDC requests fail in production without a signing key set |
| `IMS_PUBLIC_URL` | ConfigMap | Realm issuers and sign-in links are built from it; the default is a loopback address |
| `IMS_TRUST_PROXY_HOPS` | ConfigMap | Set to the number of proxies in front of IMS (typically `1` behind an ingress or gateway) so rate limits see real client addresses |

Example overlay (keep secret values out of Git — pass them with `--set-string` from a secret store, or use a sealed/gitignored values file):

```yaml
identity-service:
  enabled: true
  replicaCount: 1
  migration:
    enabled: true
    secretName: identity-db-admin-secret
  configMap:
    data:
      IMS_PUBLIC_URL: "https://identity.example.com"
      IMS_TRUST_PROXY_HOPS: "1"
```

```bash
helm upgrade --install firefoundry-core firebrandanalytics/firefoundry-core -n ff-dev \
  -f values.yaml -f identity-overlay.yaml \
  --set-string identity-service.secret.data.PG_PASSWORD="$IMS_DB_PASSWORD" \
  --set-string identity-service.secret.data.IMS_CREDENTIAL_KEY="$IMS_CREDENTIAL_KEY" \
  --set-string identity-service.secret.data.IMS_OIDC_COOKIE_KEY="$IMS_OIDC_COOKIE_KEY" \
  --set-file   identity-service.secret.data.IMS_OIDC_JWKS=./ims-jwks.json
```

Note the `identity-service.` prefix: when installing the umbrella chart, subchart values are namespaced.

### Generating keys

```bash
# 32-byte credential encryption key (base64)
openssl rand -base64 32

# Cookie signing key (any secret string of 32+ characters)
openssl rand -base64 48
```

`IMS_OIDC_JWKS` is a JSON Web Key Set containing a **private** signing key with a `kid`, for example generated with the `jose` package:

```bash
node --input-type=module -e "
import { generateKeyPair, exportJWK } from 'jose';
const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = await exportJWK(privateKey);
console.log(JSON.stringify({ keys: [{ ...jwk, kid: 'ims-sig-1', use: 'sig', alg: 'RS256' }] }));
" > ims-jwks.json
```

Keep all three values stable. Changing `IMS_CREDENTIAL_KEY` makes existing TOTP enrolments and runtime-registered confidential client secrets unreadable; there is no re-encryption procedure in this version. Changing the signing key invalidates previously issued ID tokens. `IMS_OIDC_COOKIE_KEY` accepts a list (JSON array or comma-separated), so you can add a new key ahead of the old one to rotate cookies.

## Registering the System Realm (`firefoundry-system`)

The `firefoundry-system` chart includes an IMS registration Job (`imsRegistration.enabled`) that, using an IMS API key, creates a realm (default `ff-system`) and registers:

- `ff-cli` — a public client with loopback redirect URIs for CLI sign-in
- optionally `ff-admin-app` — the Console's confidential client; the Job writes the one-time client secret directly into a Kubernetes Secret (`imsRegistration.adminAppClient.secretName`)

It is idempotent through a receipt ConfigMap and treats `409` (already exists) as success.

| Value | Description |
|-------|-------------|
| `imsRegistration.imsBaseUrl` | In-cluster IMS base URL, for example `http://firefoundry-core-identity-service.<namespace>.svc.cluster.local:8081` |
| `imsRegistration.bootstrapTokenSecretName` | Secret you create out-of-band holding the IMS API key |
| `imsRegistration.bootstrapTokenSecretKey` | Key within that Secret (default `IMS_BOOTSTRAP_API_KEY`) |
| `imsRegistration.realm.name` / `.displayName` | Realm to create |
| `imsRegistration.cliClient.*`, `imsRegistration.adminAppClient.*` | Client IDs, redirect URIs, scopes, auth methods |

The API key must belong to a principal with `ims:manage-realms` (see [Getting Started — Step 2](./getting-started.md#step-2-bootstrap-an-administrator-api-key)). IMS listens on port 8081; make sure the base URL uses it.

## Configuration

The full list of environment variables is in [Reference — Configuration](./reference.md#configuration). Operationally important settings:

| Variable | Recommendation |
|----------|----------------|
| `NODE_ENV` | `production` in every shared environment |
| `IMS_PUBLIC_URL` | External HTTPS origin that browsers and OIDC clients reach; the realm path is appended |
| `IMS_TRUST_PROXY_HOPS` | Exactly the number of reverse proxies in front of IMS. Too low → every user shares the proxy's address for rate limiting; too high → clients can spoof addresses |
| `IMS_INTROSPECTION_CLIENT_IDS` | List only the confidential clients of resource servers that must introspect tokens |
| `FF_ENTITLEMENT_MODE` | `report` (default) or `enforce` per your licensing setup |
| `PG_POOL_MAX` | Default 10 is sufficient for a single replica; raise with care |

## Health Checks

| Probe | Path | Behavior |
|-------|------|----------|
| Liveness | `GET /health` | Always 200 while the process runs (no I/O) |
| Readiness | `GET /ready` | 200 when `SELECT 1` succeeds; 503 when the database is unreachable |

Chart defaults: liveness initial delay 10s, period 10s; readiness initial delay 5s, period 5s, failure threshold 3. Both probes bypass the entitlement guard. The image also defines a Docker `HEALTHCHECK` against `/health`.

## Scaling

**Run exactly one replica.** Each process caches one OpenID Provider per realm and invalidates that cache only locally when a realm is updated or a client is registered. With more than one pod, other pods keep serving stale realm policy and client lists until they restart. Durable login state (sessions, codes, interaction bindings, rate-limit buckets) is in PostgreSQL, so a single pod can restart without losing it.

The `firefoundry-core` default `replicaCount: 2` does not reflect this; override it to `1` and keep autoscaling disabled. Because the Deployment uses Kubernetes' default rolling update, two pods briefly overlap during an upgrade; avoid realm or client changes during rollouts.

## Security

See the [Security Model](./security-model.md) for the full design. Deployment checklist:

- **Network exposure** — keep the Service `ClusterIP`. `/v1/check` and `/v1/check-batch` are unauthenticated; restrict them with NetworkPolicies to the workloads that need decisions. If browsers must reach IMS for sign-in, route only `/realms/` through your ingress or gateway.
- **TLS** — terminate HTTPS in front of IMS and set `IMS_PUBLIC_URL` to the `https://` origin. IMS connects to PostgreSQL with TLS unless `PG_SSL_DISABLED=true` or the host is loopback.
- **Secrets** — supply `PG_PASSWORD`, `IMS_CREDENTIAL_KEY`, `IMS_OIDC_COOKIE_KEY`, `IMS_OIDC_JWKS`, and any client secrets from a secret store; never commit them. There are no default credentials.
- **Bootstrap key** — the first API key has cross-realm authority. Store it as a break-glass credential, create per-realm administrators, then narrow its grants or deprovision it.
- **Least privilege** — grant exact `ims:*` actions, not wildcards; reserve `ims:grant-global`, `ims:manage-api-keys`, and `ims:link-external-identity` for the few principals that need them.
- **Database access** — the audit log is append-only by application behavior, not by database permissions; limit who can connect to the `ims` database.

## Monitoring

IMS has no metrics endpoint in this version. Monitor through probes, logs, and the audit log.

**Log messages worth alerting on:**

| Message | Meaning |
|---------|---------|
| `Configuration validation failed` | An environment variable failed schema validation at startup |
| `Native-login interaction routes disabled: configure IMS_MAIL_TRANSPORT` | Sign-in pages return 503 |
| `Generating ephemeral IMS OIDC signing key` | Non-production signing key in use; tokens will not verify after restart |
| `Skipping confidential OIDC client without a matching external secret injection` | A confidential client's secret is unavailable; it cannot authenticate |
| `Refusing confidential OIDC client with an invalid encrypted secret` | The stored client secret cannot be decrypted (for example, the credential key changed) |
| `authorize.reject audit write failed` | Audit write failure during an authorization rejection |
| `would-refuse (report mode) identity.access` | Entitlement check would refuse in enforce mode |
| `[ims][db] idle client error` | Database connection problem |

**Audit log queries** — `GET /v1/audit-log?realm=<realm>&event_type=<type>` with a key holding `ims:read-audit-log`. Useful signals: spikes in `permission.denied`, any `external-identity.link-denied`, `admin.mutation-denied`, `authorize.reject`, `login.magic-link-rejected`, and `mfa.reset` or `sessions.revoke` events you did not expect.

## Current Limitations

- **Production sign-in email is not available.** The `local-sink` transport (writes messages to files in the container) is refused when `NODE_ENV=production`, and the `notification-service` transport is not implemented yet — sign-in link delivery fails and is audited as `login.challenge-delivery-failed`. Native login is therefore only usable in non-production environments today. The principal, RBAC, and `/v1/check` APIs are unaffected.
- **Single replica only**, as described in [Scaling](#scaling).
- **No client, user-list, or realm-delete endpoints**; manage those through the database if needed.
- **No external directory sync** (for example, from a corporate IdP); principals are created on demand through `ensure` or invites.
- **API keys for new service principals** can only be provisioned at the database level.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| Pod exits: `IMS_CREDENTIAL_KEY is required` / `must be 32 bytes base64` | Missing or malformed credential key | Add a base64-encoded 32-byte key to the Secret |
| Pod exits: `IMS_OIDC_COOKIE_KEY is required in production` or `entries must be at least 32 characters` | Cookie key missing or too short | Provide one or more 32+ character keys |
| Helm render fails: `secret.data.PG_PASSWORD ... must be set` | Runtime DB password not supplied | `--set-string identity-service.secret.data.PG_PASSWORD=...` |
| Migration Job fails authenticating as admin | Wrong `migration.secretName` contents | Check the Secret's `username`/`password` and that the role can create roles and databases |
| `/ready` is 200 but API calls return 500 | Migrations not applied | Check the `identity-migration` Job logs and rerun it |
| `/ready` returns 503 | Database unreachable or TLS mismatch | Check `PG_HOST`/`PG_PORT`, network policies, and `PG_SSL_DISABLED` |
| 401 `X-API-Key does not match a known service principal` | Key not bootstrapped, bound in another realm, or principal deprovisioned | Verify the key's SHA-256 digest is registered for an `active` principal in the target or `default` realm |
| 400 `a realm selector is required` | Mutation without `realm` | Add `"realm"` to the body or `?realm=` to the URL |
| 403 `FORBIDDEN` | Caller lacks the `ims:*` permission | Grant the permission named in the message |
| 403 creating a grant with `environment_scope: null` | Global grant needs `ims:grant-global` | Grant it, or use a specific scope |
| `/v1/check` returns `no-matching-permission` unexpectedly | Scope mismatch, wrong realm, or expired assignment | Pass the same `realm` and `environment_scope` the grants use; check `expires_at` |
| Sign-in page returns 503 `NATIVE_LOGIN_UNAVAILABLE` | No mail transport configured | See [Current limitations](#current-limitations) |
| OIDC endpoints return 500 in production | `IMS_OIDC_JWKS` missing or invalid JSON | Provide a valid private JWKS |
| Discovery `issuer` shows `http://127.0.0.1:8081/...` | `IMS_PUBLIC_URL` not set | Set it to the external HTTPS origin |
| Realm OIDC endpoints return 503 `REALM_DISABLED` | Realm status is `disabled` | `PATCH /v1/realms/{name}` with `{"status":"active"}` |
| Confidential client gets `invalid_client` after a restart | Secret envelope unreadable or external secret missing | Keep `IMS_CREDENTIAL_KEY` stable; re-register the client if its secret is lost |
| Users hit 429 during sign-in | Rate limits, or all traffic appears to come from the proxy | Set `IMS_TRUST_PROXY_HOPS` to the real proxy count |
| Realm policy change not applied on some requests | More than one replica running | Scale to one replica |
| Management and `/v1/check` requests refused (probes and `/realms/` still work) | Entitlement guard in `enforce` mode without a valid entitlement | Check the entitlement agent and `FF_CLUSTER_REF`, or use `report` mode |

## Related

- [Reference](./reference.md) — full configuration table
- [Security Model](./security-model.md)
- [Platform Operations](../../operations.md)
- [Deployment Guide](../../deployment.md)
