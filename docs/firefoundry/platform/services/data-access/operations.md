# Data Access Service — Operations

How to enable the Data Access Service for your app, verify that your agent bundle can reach it, design around its limits, and troubleshoot from the caller's side.

## Enabling the Service

The Data Access Service is an **optional** service in the `firefoundry-core` Helm chart and is disabled by default. Enable it in your environment's values:

```yaml
data-access:
  enabled: true
```

The service exposes HTTP/REST on port `8080` and gRPC on port `50051` (`dataaccess.v1.DataAccessService`) as a `ClusterIP` service. It is not exposed outside the cluster unless your environment routes it through the API gateway.

### Settings an App Team Cares About

| Setting | What it's for |
|---------|---------------|
| `data-access.enabled` | Turns the service on in `firefoundry-core` |
| `data-access.secret.data.API_KEY` | The API key callers send in `X-API-Key` (or `Authorization: Bearer`). The chart ships a placeholder value — make sure your environment sets a real key and share it with the teams that call the service directly |
| `data-access.k8sSecrets.enabled` | Allows connections to use the `k8s_secret` credential method (reading database passwords from Kubernetes Secrets). Can be restricted to specific secret names |

Everything else — the service's own storage, image, and resource settings — is managed by your environment administrator.

### What Your Administrator Provisions vs. What You Do

| Task | Who | How |
|------|-----|-----|
| Enable the service, set the API key | Environment administrator | Helm values (above) |
| Provision database credentials your connections reference | Environment administrator | Environment variables or Kubernetes Secrets available to the service — see [Credential Methods](./reference.md#credential-methods) |
| ACL rules and function blacklist for your app's identities | Environment administrator | Service configuration loaded at startup — see [ACL Configuration](./reference.md#acl-configuration-yaml) for the entry shape to request |
| Register connections | App team | `POST /admin/connections` or `ff-da admin connections create` |
| Data dictionary, stored views, variables, mapping tables, ontology, process models, value stores, wrangle specs | App team | Admin API (see [Reference](./reference.md#admin-api)) |

## Connecting from an Agent Bundle

Use the `@firebrandanalytics/data-access-client` package and point it at the service with `FF_DATA_SERVICE_URL`:

| Where your code runs | Typical `FF_DATA_SERVICE_URL` |
|----------------------|-------------------------------|
| Agent bundle in the same cluster | `http://<release>-data-access.<namespace>.svc.cluster.local:8080` (for example, `http://ff-data-access.ff-dev.svc.cluster.local:8080`) |
| Local development | `http://localhost:8080` via `kubectl port-forward` to the service |
| Remote, through the API gateway | Your gateway URL with the Data Access route (for example, `https://<gateway-host>/das`) |

Inside an agent bundle the client sends the platform's function identity headers for you. When calling the REST API directly (scripts, `curl`), send `X-API-Key` and `X-On-Behalf-Of: {type}:{name}` yourself. The identity you send is what ACL rules, row-level security, scratch pads, and NER scopes are keyed on — pick stable identities such as `app:<your-bundle>` or `user:<email>`.

## Verifying

1. **Service is up**: `GET /health/ready` returns success (no auth required). Readiness includes a check of the configured database connections.
2. **Your identity can see connections**: `ff-da connections` (or `GET /v1/connections`) lists the connections your identity is authorized for. An empty list usually means an ACL entry is missing.
3. **A connection works end to end**: `POST /admin/connections/{name}/test` (or `ff-da admin connections test --name <name>`) reports status and latency.
4. **Queries run**: a simple `SELECT` via `ff-da query` or `POST /v1/connections/{conn}/query`.

## Limits to Design Around

| Area | Limit | Notes |
|------|-------|-------|
| Per-connection results | `limits.maxRows`, `limits.maxBytes`, `limits.queryTimeout`, `limits.requestsPerMinute` | Set on each connection. Request `QueryOptions` can lower but not raise them. Results over the row cap are truncated |
| Staged queries | 10 per request, 1,000 rows each, 10 MB total | Stage small, filtered result sets. Circular dependencies are rejected |
| AST size | 32 nesting levels, 1,000 expression nodes | Identifiers must match `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| Stored views | Up to 10 levels of view-on-view composition | |
| CSV upload | 50 MB, 100,000 rows (defaults) | All columns import as TEXT; re-uploading to the same table overwrites it |
| NER resolve | Up to 1,000 terms per request | Batch terms into one request |
| Audit API | `page_size` up to 200 | |
| Scratch pads | No TTL, no automatic cleanup, no storage quotas, no cross-identity sharing | Drop tables you no longer need (`DELETE /admin/scratch/{identity}/tables/{table}`). Use the `system` scratch pad for shared reference data |

## Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| Connection refused / DNS failure from the bundle | Service not enabled, or wrong URL | Confirm `data-access.enabled: true` and the service name/namespace in `FF_DATA_SERVICE_URL` |
| `401 Unauthenticated` | Missing or wrong API key | Send the key your environment configured in `X-API-Key` |
| `403 PermissionDenied` on a connection | Your identity has no ACL entry for it | Ask your environment administrator to add it; confirm the `X-On-Behalf-Of` identity is the one you expect |
| `404` connection not found | Connection not registered | Register it with `POST /admin/connections` |
| Connection test fails | Database unreachable from the cluster, or credentials not provisioned | Check host/port/SSL settings in the connection; confirm with your administrator that the referenced credentials exist |
| `429 ResourceExhausted` | Staged limits or connection rate limit exceeded | Reduce staged result sizes or request rate |
| `504 DeadlineExceeded` | Query exceeded the timeout | Narrow the query, add filters on indexed columns, or check the plan with EXPLAIN |
| Provenance or variables missing after a restart | Service is running without its persistent metadata store | Report to your environment administrator; the standard deployment persists these |

For error codes and more API-level issues, see [Reference — Error Codes](./reference.md#error-codes) and [Reference — Troubleshooting](./reference.md#troubleshooting).
