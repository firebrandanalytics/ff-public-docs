# Browser Worker Manager — Operations

Guide for deploying, configuring, securing, monitoring, and troubleshooting BWM.

> **Preview service.** BWM is not included in the `firefoundry-core` Helm chart and has no standalone chart yet. It is deployed from the Kubernetes manifests in the repository's `k8s/` directory. Expect the deployment method to change when BWM is packaged.

## Deployment

### What gets deployed

| Resource | Source | Notes |
|----------|--------|-------|
| Namespace `bwm` | `k8s/rbac.yaml` | Default namespace for the manager and all session Jobs |
| ServiceAccount + Role + RoleBinding `bwm-manager` | `k8s/rbac.yaml` | Jobs: create/get/list/watch/delete. Pods: get/list/watch. Namespace-scoped. |
| Deployment `bwm-manager` (1 replica) | `k8s/manager-deployment.yaml` | Image placeholders `{{BWM_MANAGER_IMAGE}}`, `{{BWM_HARNESS_IMAGE}}` |
| Service `bwm-manager` (port 3001) | `k8s/manager-deployment.yaml` | ClusterIP |
| Session Jobs | Created by the manager at runtime | `k8s/browser-job.yaml` is a reference copy, not applied |

### Prerequisites

- **PostgreSQL** reachable from the namespace, and a Secret `bwm-postgres` with key `connection-string`. The manager `CrashLoopBackOff`s without it.
- **Schema permissions.** The manager runs `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` at every startup and exits if that fails. On PostgreSQL 15+ and some managed PostgreSQL offerings, the application role may need an explicit `GRANT ALL ON SCHEMA public TO <app_role>;` from an admin.
- **Images** for the manager (`apps/ff-services-bwm/Dockerfile`) and harness (`packages/ff-bwm-harness/Dockerfile`) pushed to a registry your cluster can pull from.
- **Context Service** (optional) if you need `print-to-pdf` or `download`.

### Deploying into a different namespace

The manifests hard-code `namespace: bwm`. To run BWM elsewhere (for example alongside other FireFoundry services), render the manifests with the target namespace **and** set `BWM_NAMESPACE` to match — the manager creates Jobs and looks up pods only in `BWM_NAMESPACE`, and its Role grants rights only in its own namespace. Keep `BWM_MANAGER_URL` resolvable from the harness pods (the default `http://bwm-manager:3001` works when both are in the same namespace).

### Steps

```bash
kubectl apply -f k8s/rbac.yaml

kubectl -n bwm create secret generic bwm-postgres \
  --from-literal=connection-string='postgres://<user>:<password>@<host>:5432/<db>'

sed -e 's|{{BWM_MANAGER_IMAGE}}|<registry>/bwm-manager:<tag>|' \
    -e 's|{{BWM_HARNESS_IMAGE}}|<registry>/bwm-harness:<tag>|' \
    k8s/manager-deployment.yaml | kubectl apply -f -
```

Then add any optional environment variables (below) with `kubectl set env` or by editing the manifest. For a full local walkthrough, see [Getting Started](./getting-started.md).

## Configuration

Key manager settings (full list in [Reference — Environment Variables](./reference.md#environment-variables)):

| Variable | Default | Tune when |
|----------|---------|-----------|
| `BWM_IMAGE` | `bwm-harness:dev` | Always set to your published harness image |
| `BWM_NAMESPACE` | `bwm` | Running outside the `bwm` namespace |
| `INACTIVITY_TIMEOUT_MS` | 30 min | Agents pause longer between verbs (e.g. waiting on human input) |
| `SPAWN_TIMEOUT_MS` | 5 min | Slow image pulls on cold nodes |
| `REAPER_INTERVAL_MS` | 1 min | You need faster cleanup, or a longer grace period for new `ready` sessions |
| `MANAGER_ID` | Pod name (via the Downward API in the manifest) | See [Scaling](#scaling) |
| `CONTEXT_SERVICE_ADDRESS` | — | Enabling PDFs/downloads. Must include `http://`, e.g. `http://<context-service>.<namespace>.svc.cluster.local:50051` |
| `CONTEXT_SERVICE_API_KEY` | — | Your Context Service requires an API key (source it from a Secret) |
| `FF_ENVIRONMENT` | — | Context Service is multi-environment |

The readiness gate timeouts (60 s / 30 s / 60 s), harness resource requests/limits, Job TTL (300 s), and harness port (3000) are fixed in code in this release.

### Harness resource sizing

Each session pod requests `250m` CPU / `512Mi` and is limited to `1` CPU / `2Gi`. Heavy single-page apps can approach the memory limit; an OOM-killed harness is not restarted (`backoffLimit: 0`). Plan node capacity as roughly *concurrent sessions × 512Mi* requested memory.

## Health Checks

| Endpoint | Component | Used by |
|----------|-----------|---------|
| `GET /health` (3001) | Manager | Deployment liveness probe (every 30 s) |
| `GET /health` (3000) | Harness | Readiness gate 2 |
| `GET /ready` (3000) | Harness | Pod readiness probe (every 5 s, 24 failures ≈ 2 min) and readiness gate 3; launches Chromium on first call |

The manager has no readiness probe; it starts listening only after its schema migration succeeds.

## Scaling

BWM's manager is designed to run as a **single replica** in this release:

- Each manager instance lists (`GET /sessions`) and reaps only sessions whose `manager_id` matches its own `MANAGER_ID`. The readiness watcher for a session runs in-process in the instance that created it.
- The manifest sets `MANAGER_ID` to the pod name. When the manager pod is replaced (redeploy, eviction, crash), the new pod has a new ID and **will not reap sessions created by the old pod**, and any in-flight readiness watchers are lost (those sessions stay `spawning`). Their harness Jobs have no active deadline, so they keep running until shut down.

Recommendations:

- For a single-replica deployment, set `MANAGER_ID` to a **fixed value** (e.g. `bwm-manager`) so a restarted manager takes over reaping of existing sessions.
- After a manager restart, check for orphaned harness Jobs (see [Troubleshooting](#troubleshooting)).
- `GET /sessions/:id` and `DELETE /sessions/:id` work for any session regardless of which instance created it.

Browser capacity scales horizontally by Jobs: each session is an independent pod scheduled by Kubernetes. There is no built-in cap on concurrent sessions; use a namespace `ResourceQuota` to bound it.

## Security

See [Credentials and Redaction](./security.md) for the credential model. Operational hardening:

- **No API authentication.** Neither the manager nor the harness authenticates callers. Keep both cluster-internal and add NetworkPolicies that allow only your agent bundles to reach the manager (3001) and harness pods (3000), and allow harness pods to reach the manager for pings.
- **Egress.** Harness pods need outbound HTTPS to the target websites and access to Context Service. Consider an egress policy restricting harness pods to the sites your agents are meant to use.
- **Chromium sandbox.** The harness launches Chromium with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`, which is standard for unprivileged containers. Isolation between sessions comes from running each session in its own pod.
- **No Kubernetes token in session pods.** Harness pods set `automountServiceAccountToken: false`.
- **Credential Secrets.** Create per-session or per-site Secrets with the least credentials needed, restrict Secret access in the namespace via RBAC, and delete per-session Secrets when sessions close.
- **Manager permissions.** The manager's Role is namespace-scoped and limited to Jobs and Pods.

## Monitoring

### Logs

- **Manager** — session creation errors (`[POST /sessions]`), readiness progress (`[watchSession] <id> ready` / `failed: <reason>`), teardown (`[teardown] deleted k8s job …`), reaper activity (`[reaper] reaping N sessions`, `[reaper] closed <id>`), and startup (`bwm-manager listening on :3001`, reaper settings).
- **Harness** — every line is prefixed `[session=<id>]`; verbs such as navigate, login, print-to-pdf, and download log their outcome. Page-derived values in logs are redacted.

```bash
kubectl -n bwm logs deploy/bwm-manager -f
kubectl -n bwm logs -l bwm.firefoundry.io/session-id=<sessionId>
```

### Useful queries

```sql
-- Sessions by status
SELECT status, count(*) FROM bwm_sessions GROUP BY status;

-- Recent spawn failures and why
SELECT s.id, j.k8s_job_name, j.failure_reason, j.failed_at
FROM bwm_jobs j JOIN bwm_sessions s ON s.id = j.session_id
WHERE j.status = 'failed' ORDER BY j.failed_at DESC LIMIT 20;

-- Spawn latency per gate
SELECT session_id,
       scheduled_at - created_at      AS to_scheduled,
       harness_ready_at - scheduled_at AS to_harness,
       browser_ready_at - harness_ready_at AS to_browser
FROM bwm_jobs WHERE status = 'browser_ready' ORDER BY created_at DESC LIMIT 20;
```

### Cluster view

```bash
# All session Jobs and pods
kubectl -n bwm get jobs,pods -l app.kubernetes.io/name=bwm-harness
```

There are no Prometheus metrics or OpenTelemetry traces in this release.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Manager exits at startup with `migration failed` | Database unreachable, bad `PG_CONNECTION_STRING`, or no `CREATE` permission on schema `public` | Check the `bwm-postgres` Secret; grant schema privileges to the app role |
| Manager `CrashLoopBackOff`, Secret not found | `bwm-postgres` Secret missing | Create it with key `connection-string` |
| `POST /sessions` returns 500 with a Kubernetes error | Manager cannot create Jobs (RBAC, wrong `BWM_NAMESPACE`, no in-cluster credentials) | Verify the Role/RoleBinding and that `BWM_NAMESPACE` is the manager's namespace |
| Session `failed`, `failure_reason` mentions `gate1:pod-scheduled` | Pod not scheduled in 60 s: image pull failure, insufficient resources, quota | `kubectl -n bwm describe pod -l bwm.firefoundry.io/session-id=<id>`; check `BWM_IMAGE` and node capacity |
| `failure_reason` mentions `gate2:harness-listening` | Pod running but harness not answering on 3000, or manager cannot reach pod IPs (NetworkPolicy) | Check harness logs; allow manager → pod traffic on 3000 |
| `failure_reason` mentions `gate3:browser-ready` | Chromium failed to launch (resources, missing libraries in a custom image) | `curl <harness_url>/ready` shows the launch error; check memory limits |
| Session goes `ready` → `closed` about a minute later | No verb was sent after `ready`; reaper treats never-used sessions as idle | Send the first verb immediately after `ready` |
| Active session closed unexpectedly | Idle longer than `INACTIVITY_TIMEOUT_MS`, or harness pings are not reaching the manager | Raise the timeout; verify harness pods can resolve `BWM_MANAGER_URL` |
| Session shows `active` but harness is unreachable | Harness pod crashed or was OOM-killed (not restarted); status is only updated by the reaper | Delete the session and create a new one; review pod events for `OOMKilled` |
| Harness verbs return `409 stale-ref` | Page changed or navigated since the snapshot | Take a new snapshot and use fresh refs |
| `fill` with `credentialRef` returns `409 … credential revalidation failed` | Element changed, is not an `<input>`, type mismatch, password credential on non-password field, or input has no explicit `type` attribute | Re-snapshot; check the credential's `field`; see [Credentials and Redaction](./security.md#credential-fill-safeguards) |
| `412 credentials file not mounted` | Secret did not exist when the pod started, or wrong `credsSecretName` | Create the Secret with a `credentials.json` key before `POST /sessions` |
| `print-to-pdf` / `download` return 500 with a fetch or URL error | `CONTEXT_SERVICE_ADDRESS` not set on the manager, or missing `http://` scheme | Set it on the manager (it is forwarded to new sessions only) |
| `download` returns 500 with a timeout | The trigger did not start a browser download within `waitMs` | Increase `waitMs`; confirm the selector triggers a download rather than opening a page |
| `navigate` returns `botDefense: true` | CAPTCHA, challenge page, or MFA prompt | BWM does not solve these; hand off to a human or use a pre-authenticated cookie credential |
| Harness Jobs left running after a manager restart | New manager `MANAGER_ID` does not own the old sessions | `kubectl -n bwm delete jobs -l app.kubernetes.io/name=bwm-harness` (after confirming they are unused); set a fixed `MANAGER_ID` |

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Credentials and Redaction](./security.md)
- [Virtual Worker Manager](../virtual-workers/README.md)
