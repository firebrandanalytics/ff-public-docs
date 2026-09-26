# Browser Worker Manager — Reference

Reference for the BWM session API, the per-session browser API, and error codes.

BWM exposes two HTTP APIs, both JSON over REST and reachable only from inside the cluster:

| API | Use it for | Base URL |
|-----|------------|----------|
| **Session API** (manager) | Create, inspect, keep alive, and close sessions | `http://bwm-manager.<namespace>.svc.cluster.local:3001` (ask your administrator for the exact address) |
| **Browser API** (harness) | Browser actions for one session | The session's `harness_url`, e.g. `http://10.244.0.23:3000` |

Neither API requires authentication headers in this release. Send `Content-Type: application/json` on requests with a body.

---

## Session API

### POST /sessions

Create a browser session. Returns immediately; the browser starts in the background. Poll [`GET /sessions/:id`](#get-sessionsid) until `status` is `ready`.

**Request Body** (optional):
```json
{
  "credsSecretName": "string (optional)"
}
```

| Field | Description |
|-------|-------------|
| `credsSecretName` | Name of the credential set to make available to this session (see [Credentials and Redaction](./security.md)). Optional. If the named set does not exist, the session still starts, and credential actions return `412`. |

**Response** (201):
```json
{ "sessionId": "uuid", "status": "spawning" }
```

### GET /sessions

List up to 100 recent sessions, newest first. Sessions from before a manager restart may not appear; use `GET /sessions/:id` for a known session.

**Query Parameters**:

| Parameter | Description |
|-----------|-------------|
| `status` | Optional filter: `spawning`, `ready`, `active`, `failed`, `closed` |

**Response** (200): array of [session rows](#session-object).

### GET /sessions/:id

Get one session by ID.

**Response** (200): a [session row](#session-object). **404** `{"error":"not found"}` if the ID is unknown.

### DELETE /sessions/:id

Close a session. The browser is shut down and its state discarded.

**Response** (200):
```json
{ "ok": true }
```

**404** `{"error":"not found"}` if the ID is unknown. Calling it on an already-closed session succeeds.

### POST /sessions/:id/ping

Keep-alive. Every successful browser action already does this for you; call it yourself only if your agent must pause longer than the idle timeout without sending actions. Moves a `ready` session to `active` and resets the idle timer.

**Response** (200): `{ "ok": true }`

### GET /health

Liveness check. **Response** (200): `{ "ok": true }`

### Session Object

Returned by `GET /sessions` and `GET /sessions/:id`:

```json
{
  "id": "uuid",
  "manager_id": "string",
  "status": "spawning | ready | active | failed | closed",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "closed_at": "ISO-8601 | null",
  "harness_url": "string | null",
  "last_active_at": "ISO-8601 | null"
}
```

| Field | Notes |
|-------|-------|
| `status` | See [Concepts — Session lifecycle](./concepts.md#session-lifecycle) |
| `harness_url` | Where to send browser actions. May appear shortly before `ready`; only send actions once `status` is `ready` or `active`. |
| `last_active_at` | Time of the last successful action (`null` until the first one) |
| `manager_id` | Internal; ignore |

---

## Browser API

All actions act on the session's single browser page. Every successful action (except `/health` and `/ready`) counts as session activity. Error responses have the shape `{"ok": false, "error": "…", "detail"?: "…"}`.

### GET /health

Liveness of the session's browser service. **Response** (200): `{ "ok": true }`

### GET /ready

Browser readiness. **Response** (200) `{ "ok": true }`, or **503** `{ "ok": false, "error": "…" }` if the browser cannot start. You normally rely on the session `status` instead.

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

Capture interactive elements (roles `button`, `link`, `textbox`, `combobox`, `checkbox`, `menuitem`) in the main frame. Invalidates refs from any earlier snapshot. No request body.

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

`snapshot_epoch` increases with every snapshot; refs are only valid for the latest one. `checked` appears only for checkboxes, `required` only when the field is required, `type` only for `<input>` elements. Field values are never returned.

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
| 404 | `credentialRef not found: <key>` | Key not in the session's credential set, or not a `value` entry |
| 409 | `stale-ref` | Ref from an old snapshot or element gone; or `detail: "credential revalidation failed"` when the target is no longer editable, is not an `<input>`, its `type` changed since the snapshot, or a password credential targets a non-password input |
| 412 | `credentials file not mounted` | The session was created without a (valid) credential set |
| 500 | `failed to read credentials` / `fill request failed` | Credential set unreadable / selector fill failed |

Fill errors never echo the typed value.

### POST /session/login

One-call login using a named `formFill` or `storageState` entry from the session's credential set.

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
| 404 | `credentialKey not found: <key>` | Key not in the credential set, or it is a `value` (fill) entry |
| 412 | `credentials file not mounted` | The session was created without a (valid) credential set |
| 500 | `failed to read credentials` / `formFill action failed before login could complete` | Credential set unreadable / navigation, fill, or click failed |

See [Credentials and Redaction](./security.md#credential-entry-types) for entry types.

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

**Errors**: 500 (including `context-service <status>: …` when the upload fails, or a connection error when Context Service is not configured for BWM).

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

### Not available

There is no `POST /session/evaluate` (arbitrary JavaScript) endpoint; requests to it return `404`.

---

## Error Code Summary

| Status | Meaning |
|--------|---------|
| 400 | Missing or invalid request fields, malformed ref |
| 401 | `formFill` login did not reach its success selector |
| 404 | Unknown session (session API) / credential key not found (browser API) |
| 409 | `stale-ref` — take a new snapshot and retry |
| 412 | Session has no credential set |
| 500 | Browser, site, or Context Service failure; on the session API, an internal error (`{"error": "..."}`) |
| 503 | `GET /ready`: browser failed to start |

## Related

- [Concepts](./concepts.md)
- [Getting Started](./getting-started.md)
- [Credentials and Redaction](./security.md)
