# Browser Worker Manager — Reference

Complete reference for the BWM manager API, the per-session harness API, error codes, environment variables, and database schema.

BWM exposes two HTTP APIs, both JSON over REST:

| API | Served by | Port | Base URL |
|-----|-----------|------|----------|
| **Manager API** | `ff-services-bwm` (Deployment + Service `bwm-manager`) | 3001 | `http://bwm-manager.<namespace>.svc.cluster.local:3001` |
| **Harness API** | `ff-bwm-harness` (one pod per session) | 3000 | The session's `harness_url` (pod IP), e.g. `http://10.244.0.23:3000` |

Neither API requires authentication headers in this release. Send `Content-Type: application/json` on requests with a body.

---

## Manager API

### POST /sessions

Create a browser session. Returns immediately; the pod starts in the background.

**Request Body** (optional):
```json
{
  "credsSecretName": "string (optional)"
}
```

| Field | Description |
|-------|-------------|
| `credsSecretName` | Name of a Kubernetes Secret in the BWM namespace to mount at `/secrets` in the harness pod. Defaults to `bwm-creds-<first 8 chars of sessionId>`. The mount is optional — if the Secret does not exist, the session starts without credentials. |

**Response** (201):
```json
{ "sessionId": "uuid", "status": "spawning" }
```

### GET /sessions

List up to 100 sessions owned by this manager instance (`manager_id` = the manager's `MANAGER_ID`), newest first.

**Query Parameters**:

| Parameter | Description |
|-----------|-------------|
| `status` | Optional filter: `spawning`, `ready`, `active`, `failed`, `closed` |

**Response** (200): array of [session rows](#session-object).

### GET /sessions/:id

Get one session by ID (any manager instance).

**Response** (200): a [session row](#session-object). **404** `{"error":"not found"}` if the ID is unknown.

### DELETE /sessions/:id

Tear down a session: `POST /shutdown` to the harness (5 s timeout), delete the Kubernetes Job (background propagation), then mark the session `closed`.

**Response** (200):
```json
{ "ok": true }
```

**404** `{"error":"not found"}` if the ID is unknown. Calling it on an already-closed session succeeds.

### POST /sessions/:id/ping

Keep-alive called by the harness after each successful verb. Sets `last_active_at = now()` and moves `ready` → `active`. Consumers do not normally call this.

**Response** (200): `{ "ok": true }`

### GET /health

Liveness check. **Response** (200): `{ "ok": true }`

### Session Object

Rows are returned as stored in `bwm_sessions`:

```json
{
  "id": "uuid",
  "manager_id": "string",
  "status": "spawning | ready | active | failed | closed",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "closed_at": "ISO-8601 | null",
  "harness_url": "http://<pod-ip>:3000 | null",
  "last_active_at": "ISO-8601 | null"
}
```

`harness_url` is populated once the harness answers its health check (readiness gate 2). Only send verbs once `status` is `ready` or `active`.

---

## Harness API

All verbs act on the session's single browser page. Every successful verb (except `/health`, `/ready`, `/shutdown`) pings the manager to refresh `last_active_at`. Error responses have the shape `{"ok": false, "error": "…", "detail"?: "…"}`.

### GET /health

Process liveness. **Response** (200): `{ "ok": true }`

### GET /ready

Launches Chromium if it is not already running. **Response** (200) `{ "ok": true }`, or **503** `{ "ok": false, "error": "…" }` if the browser cannot start.

### POST /session/navigate

Load a URL (waits for `domcontentloaded`, 30 s timeout).

**Request Body**:
```json
{ "url": "string (required)" }
```

**Response** (200):
```json
{
  "ok": true,
  "title": "string (redacted)",
  "url": "string (final URL, redacted)",
  "botDefense": false,
  "kind": "cloudflare-challenge | cloudflare-title | captcha-widget | mfa-input (only when botDefense is true)"
}
```

**Errors**: 400 `url required`; 500 navigation failure.

### POST /session/snapshot

Capture interactive elements (roles `button`, `link`, `textbox`, `combobox`, `checkbox`, `menuitem`) in the main frame. Increments the snapshot epoch and replaces the ref table. No request body.

**Response** (200):
```json
{
  "ok": true,
  "snapshot_epoch": 3,
  "url": "string (redacted)",
  "elements": [
    {
      "ref": "ref_3_main_0",
      "role": "textbox",
      "name": "string (accessible name, redacted)",
      "enabled": true,
      "checked": false,
      "required": true,
      "type": "password"
    }
  ]
}
```

`checked` appears only for checkboxes, `required` only when the attribute is present, `type` only for `<input>` elements. Element values are never returned.

### POST /session/extract

Return visible text from the page or from one element.

**Request Body** (optional):
```json
{ "ref": "string (optional)" }
```

**Response** (200):
```json
{ "ok": true, "url": "string (redacted)", "text": "string (redacted, max 8000 chars)" }
```

**Errors**: 400 `malformed ref`; 409 `stale-ref`; 500.

### POST /session/click

Click an element (10 s timeout).

**Request Body**:
```json
{ "ref": "string", "selector": "string" }
```

One of `ref` or `selector` is required; `ref` takes precedence.

**Response** (200):
```json
{ "ok": true, "url": "string (URL after click, redacted)" }
```

**Errors**: 400 `selector or ref required` / `malformed ref`; 409 `stale-ref`; 500.

### POST /session/fill

Type into a form field, either a literal `value` or a secret looked up by `credentialRef`.

**Request Body**:
```json
{
  "ref": "string",
  "selector": "string",
  "value": "string",
  "credentialRef": "string"
}
```

| Rule | Error if violated |
|------|-------------------|
| One of `ref` or `selector` is required (`ref` wins) | 400 `selector or ref required` |
| Exactly one of `value` or `credentialRef` | 400 `value and credentialRef are mutually exclusive` / `value or credentialRef required` |
| `credentialRef` requires `ref` (selectors are not allowed for secrets) | 400 `credentialRef requires ref` |

**Response** (200): `{ "ok": true }`

**Errors**:

| Status | `error` | When |
|--------|---------|------|
| 400 | `malformed ref` | `ref` is not a valid token |
| 404 | `credentialRef not found: <key>` | Key missing from `credentials.json`, or entry is not `mode: "value"` |
| 409 | `stale-ref` | Ref from an old epoch; element gone; or `detail: "credential revalidation failed"` when the element is no longer attached/editable, is not an `<input>`, its `type` differs from the snapshot, or a `field: "password"` credential targets a non-password input |
| 412 | `credentials file not mounted` | No `/secrets/credentials.json` in the pod |
| 500 | `failed to read credentials` / `fill request failed` | Unreadable credentials file / selector fill failed |

Fill errors never echo the typed value.

### POST /session/login

One-call login using a named entry from `credentials.json`.

**Request Body**:
```json
{ "credentialKey": "string (required)" }
```

**Response** (200):
```json
{ "ok": true, "mode": "storageState" }
```
or
```json
{ "ok": true, "mode": "formFill", "url": "string (post-login URL, redacted)" }
```

**Errors**:

| Status | `error` | When |
|--------|---------|------|
| 400 | `credentialKey required` | Missing field |
| 401 | `login failure: success selector not found` | `formFill` submitted but `successSelector` did not appear within 10 s |
| 404 | `credentialKey not found: <key>` | Key missing, or entry is a `mode: "value"` fill credential |
| 412 | `credentials file not mounted` | No credentials file in the pod |
| 500 | `failed to read credentials` / `formFill action failed before login could complete` | File unreadable / navigation, fill, or click failed |

See [Credentials and Redaction](./security.md#credential-file-format) for entry formats.

### POST /session/print-to-pdf

Render the current page as an A4 PDF and store it in Context Service working memory.

**Request Body** (optional):
```json
{ "name": "string (default: page.pdf)", "description": "string (default: empty)" }
```

**Response** (200):
```json
{ "ok": true, "workingMemoryId": "string", "blobKey": "string", "bytes": 48213, "mimeType": "application/pdf" }
```

**Errors**: 500 (including `context-service <status>: …` when the upload fails).

### POST /session/download

Click a trigger element, capture the resulting browser download, and store it in Context Service working memory as `application/octet-stream`.

**Request Body**:
```json
{
  "triggerSelector": "string (required, CSS selector)",
  "waitMs": 5000,
  "name": "string (default: download)",
  "description": "string (default: empty)"
}
```

`waitMs` is how long to wait for the download to start. The click itself has a 10 s timeout. `triggerSelector` is a CSS selector; refs are not accepted here.

**Response** (200):
```json
{ "ok": true, "workingMemoryId": "string", "blobKey": "string", "bytes": 10240, "suggestedFilename": "string (redacted)" }
```

**Errors**: 400 `triggerSelector required`; 500 (no download within `waitMs`, stream unavailable, or upload failure).

### POST /shutdown

Respond `{ "ok": true }`, clear the in-memory set of injected secrets, close the browser, and exit the process. The pod completes and its Job is garbage-collected after 300 s. Normally called by the manager.

### Not available

There is no `POST /session/evaluate` (arbitrary JavaScript) endpoint; requests to it return `404`.

---

## Error Code Summary

| Status | Meaning |
|--------|---------|
| 400 | Missing or invalid request fields, malformed ref |
| 401 | `formFill` login did not reach its success selector |
| 404 | Unknown session (manager) / credential key not found (harness) |
| 409 | `stale-ref` — take a new snapshot and retry |
| 412 | Credentials file not mounted in the session pod |
| 500 | Browser, Kubernetes, database, or Context Service failure (manager returns `{"error": "..."}`) |
| 503 | Harness `/ready`: browser failed to launch |

---

## Environment Variables

### Manager (`ff-services-bwm`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `PG_CONNECTION_STRING` | — (required) | PostgreSQL connection string |
| `BWM_NAMESPACE` | `bwm` | Namespace where session Jobs are created (and pods are looked up) |
| `BWM_IMAGE` | `bwm-harness:dev` | Harness container image for session Jobs |
| `BWM_MANAGER_URL` | `http://bwm-manager:3001` | Manager URL passed to harness pods as `MANAGER_URL` for keep-alive pings |
| `MANAGER_ID` | Pod hostname | Identity used to scope session listing and reaping |
| `INACTIVITY_TIMEOUT_MS` | `1800000` (30 min) | Idle time after which a `ready`/`active` session is reaped |
| `SPAWN_TIMEOUT_MS` | `300000` (5 min) | Time after which a `pending`/`spawning` session is reaped |
| `REAPER_INTERVAL_MS` | `60000` (1 min) | Reaper sweep interval |
| `CONTEXT_SERVICE_ADDRESS` | — | Forwarded to harness pods (only if set) |
| `CONTEXT_SERVICE_API_KEY` | — | Forwarded to harness pods (only if set) |
| `FF_ENVIRONMENT` | — | Forwarded to harness pods (only if set) |

The manager also needs in-cluster Kubernetes credentials (a ServiceAccount) or a kubeconfig.

### Harness (`ff-bwm-harness`)

Set by the manager on every session Job:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `SESSION_ID` | `unknown` | Session ID, used in log lines and pings |
| `MANAGER_URL` | — | Manager base URL for `POST /sessions/:id/ping`; pings are skipped if unset |
| `SECRETS_PATH` | `/secrets` | Directory containing `credentials.json` |
| `CONTEXT_SERVICE_ADDRESS` | `http://localhost:50051` | Context Service base URL **including scheme**; used for `print-to-pdf` and `download` |
| `CONTEXT_SERVICE_API_KEY` | — | Sent as `x-api-key` to Context Service |
| `FF_ENVIRONMENT` | `default` | Sent as `x-ff-environment` to Context Service |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` (image) | Chromium binary Playwright launches |

---

## Session Job Specification

Jobs are built by the manager at runtime (`k8s/browser-job.yaml` is a reference copy only):

| Setting | Value |
|---------|-------|
| Name | `bwm-<first 8 chars of sessionId>-<timestamp base36>` |
| Labels | `app.kubernetes.io/name: bwm-harness`, `bwm.firefoundry.io/session-id: <sessionId>` |
| `backoffLimit` / `restartPolicy` | `0` / `Never` |
| `ttlSecondsAfterFinished` | `300` |
| `automountServiceAccountToken` | `false` |
| Resources | requests `250m` CPU / `512Mi`; limits `1000m` CPU / `2Gi` |
| Readiness probe | `GET /ready` on 3000, every 5 s, up to 24 failures |
| Volume | Secret `credsSecretName` at `/secrets`, read-only, `optional: true` |

---

## Database Schema

Created automatically at manager startup.

**`bwm_sessions`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Session UUID |
| `manager_id` | TEXT | Owning manager instance |
| `status` | TEXT | See [Concepts — Session Lifecycle](./concepts.md#session-lifecycle) |
| `created_at`, `updated_at` | TIMESTAMPTZ | |
| `closed_at` | TIMESTAMPTZ | Set on close |
| `harness_url` | TEXT | `http://<pod-ip>:3000` |
| `last_active_at` | TIMESTAMPTZ | Last successful verb |

**`bwm_jobs`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `session_id` | TEXT FK → `bwm_sessions.id` (cascade delete) | |
| `k8s_job_name` | TEXT | |
| `status` | TEXT | `pending`, `scheduled`, `harness_ready`, `browser_ready`, `failed` |
| `scheduled_at`, `harness_ready_at`, `browser_ready_at` | TIMESTAMPTZ | Readiness gate timestamps |
| `failed_at`, `failure_reason` | TIMESTAMPTZ, TEXT | Set when a gate fails |
| `created_at` | TIMESTAMPTZ | |

Indexes: `(manager_id, status)` and `(last_active_at) WHERE status = 'active'` on sessions; `(session_id)` on jobs.
