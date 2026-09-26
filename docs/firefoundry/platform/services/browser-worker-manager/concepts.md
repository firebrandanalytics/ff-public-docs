# Browser Worker Manager — Concepts

This page explains the mental model behind BWM: what a browser session is, how the manager and the harness divide the work, how a session moves through its lifecycle, and how an agent perceives and acts on a page.

## The Harness/Worker Model

BWM follows the same two-tier pattern as the [Virtual Worker Manager](../virtual-workers/concepts.md):

- The **manager** (`ff-services-bwm`) is a long-running service. It owns the session registry in PostgreSQL, creates one Kubernetes Job per session, watches it come up, and cleans it up.
- The **harness** (`ff-bwm-harness`) is a small HTTP server that runs inside each session pod. It launches headless Chromium through Playwright and exposes a fixed set of **verbs** (`navigate`, `snapshot`, `click`, …).

The important difference from VWM is **where the intelligence lives**:

- In VWM the pod contains an autonomous coding agent. The consumer sends a prompt and the agent inside the pod decides what to do.
- In BWM the pod contains only a browser. The **calling agent or bot** runs the reasoning loop — typically an LLM with the harness verbs exposed as tools — and sends one verb at a time. The harness executes exactly what it is told and reports back.

A second difference is the **traffic path**. VWM proxies every request through the manager. BWM's manager only handles the session lifecycle; once a session is `ready`, the consumer reads the pod's `harness_url` from the manager and calls the harness **directly**. The harness in turn pings the manager after each successful verb so the manager knows the session is in use.

```
Agent / Bot ──(lifecycle)──▶ Manager ──(creates Job)──▶ Harness pod
     │                          ▲                          │
     └────────(verbs)───────────┼─────────────────────────▶│
                                └──────(ping on success)───┘
```

## Sessions

A **session** is one browser, in one pod, for one task. Concretely:

- **One Kubernetes Job** (`restartPolicy: Never`, `backoffLimit: 0`) labeled `bwm.firefoundry.io/session-id=<sessionId>`
- **One Playwright browser context with one page.** Cookies, local storage, and the current URL persist for the life of the pod. Pop-ups and new tabs are not tracked; every verb acts on the single page.
- **One optional credentials Secret**, mounted read-only at `/secrets`
- **One row** in `bwm_sessions` (plus a row in `bwm_jobs` for the Job)

Sessions are not persisted beyond the pod. When a session closes, its browser state is gone; a new session starts from a clean browser.

### Session Lifecycle

```
POST /sessions ──▶ spawning
                      │  Gate 1: Job has an active pod        (≤ 60 s)
                      │  Gate 2: harness GET /health = 200    (≤ 30 s)
                      │  Gate 3: harness GET /ready  = 200    (≤ 60 s)
                      │         (Chromium launched)
          gate fails  │
        ┌─────────────┤
        ▼             ▼
     failed         ready ──(first successful verb)──▶ active
                      │                                  │
                      │    DELETE /sessions/:id          │
                      │    or reaper (idle / spawn       │
                      │    timeout)                      │
                      ▼                                  ▼
                   closed ◀──────────────────────────────┘
```

| Status | Meaning |
|--------|---------|
| `spawning` | Session row created and Job submitted; readiness gates in progress |
| `ready` | Harness is up and Chromium is launched; `harness_url` is populated |
| `active` | At least one verb has succeeded (set by the harness ping) |
| `failed` | A readiness gate timed out or the Job failed; `bwm_jobs.failure_reason` holds the reason |
| `closed` | Torn down by `DELETE` or by the reaper; `closed_at` is set |

The schema also reserves `pending` and `teardown`, but the current code never assigns them.

### The readiness gates

The manager does not return a usable session synchronously. `POST /sessions` returns `201 {"sessionId", "status": "spawning"}` immediately and a background watcher advances the session through three gates, recording each on the `bwm_jobs` row:

| Gate | Check | Timeout | `bwm_jobs.status` on success |
|------|-------|---------|------------------------------|
| 1 — pod scheduled | Kubernetes Job reports an active pod | 60 s | `scheduled` (`scheduled_at`) |
| 2 — harness listening | Running pod has an IP and `GET /health` returns 200 | 30 s | `harness_ready` (`harness_ready_at`) |
| 3 — browser ready | `GET /ready` returns 200 (Chromium launched) | 60 s | `browser_ready` (`browser_ready_at`) |

If any gate times out, or the Job reports a failed pod, the session becomes `failed` and the reason is written to `bwm_jobs.failure_reason`. Consumers should poll `GET /sessions/:id` until `status` is `ready` or `failed`.

### Keep-alive and the reaper

The harness calls `POST /sessions/:id/ping` on the manager after every **successful** verb. The ping sets `last_active_at` and moves a `ready` session to `active`.

A reaper runs inside the manager every `REAPER_INTERVAL_MS` (default 60 s) and closes:

- Sessions still `pending`/`spawning` longer than `SPAWN_TIMEOUT_MS` (default 5 min)
- Sessions `ready`/`active` whose `last_active_at` is older than `INACTIVITY_TIMEOUT_MS` (default 30 min) **or has never been set**

> **Send your first verb promptly.** Because a freshly `ready` session has no `last_active_at` until its first successful verb, the reaper treats it as idle. A session that sits in `ready` without any verb will be closed on the next reaper sweep — within `REAPER_INTERVAL_MS` of becoming ready. Issue a `navigate` (or any verb) as soon as the session is ready.

For each reaped session the reaper calls the harness `POST /shutdown` (which closes the browser and exits the pod) and marks the row `closed`. The completed Job is then removed by Kubernetes after `ttlSecondsAfterFinished` (300 s).

Each manager replica only lists and reaps sessions it created, identified by `MANAGER_ID`. See [Operations — Scaling](./operations.md#scaling) for what that implies.

### Teardown

`DELETE /sessions/:id` performs a graceful teardown in order:

1. `POST /shutdown` to the harness (5 s timeout; ignored if the pod is already gone). The harness clears its redaction set, closes the browser context, and exits.
2. Delete the Kubernetes Job with background propagation (best effort; the Job's TTL is the backstop).
3. Mark the session `closed` and set `closed_at`.

## Perception: Snapshots and Refs

Agents that must invent CSS selectors from page prose tend to guess wrong. BWM gives the agent a structured view instead.

### Snapshot

`POST /session/snapshot` walks the page's accessibility tree and returns every element in these roles, in this order:

`button`, `link`, `textbox`, `combobox`, `checkbox`, `menuitem`

Each element comes back with a **ref** and a small, fixed set of attributes:

```json
{ "ref": "ref_3_main_4", "role": "textbox", "name": "Password", "enabled": true, "required": true, "type": "password" }
```

| Field | Notes |
|-------|-------|
| `ref` | Token `ref_<epoch>_<frame>_<index>`. The frame segment is always `main` in this release (only the main frame is snapshotted). |
| `role` | One of the six roles above |
| `name` | Accessible name (label, `aria-label`, link text), redacted |
| `enabled` | `false` if the element is disabled |
| `checked` | Checkboxes only |
| `required` | Present (`true`) when the element has a `required` attribute |
| `type` | `<input>` type, when the element is an input |

A snapshot **never** includes a form control's current value. This is deliberate: it means a snapshot cannot leak what is already typed into a field, including a password.

Duplicate names are fine — the ref's index, not the name, identifies the element.

### Epochs and stale refs

Every snapshot increments a **snapshot epoch** and replaces the harness's in-memory ref table. The table is also wiped whenever any frame on the page navigates or detaches. A ref is only valid in the epoch that produced it:

- A malformed ref → `400 malformed ref`
- A ref from an older epoch, or not in the current table → `409 stale-ref`
- A ref whose element has since been removed or cannot be acted on → `409 stale-ref`

Refs are bound to the actual DOM node captured at snapshot time (a Playwright element handle), not re-resolved by selector or name. If a page swaps an element for a look-alike, the old ref will not silently target the new one.

The practical loop for an agent is:

```
snapshot ──▶ pick ref ──▶ click / fill / extract ──▶ (page changed?) ──▶ snapshot again
```

On any `409 stale-ref`, take a fresh snapshot and retry with a new ref.

### Selectors remain available

`click` and `fill` still accept a plain CSS `selector` as an escape hatch. If both `ref` and `selector` are supplied, `ref` wins. Filling a **credential** requires a `ref` (see [Credentials and Redaction](./security.md)).

### Extract

`POST /session/extract` returns the page's visible text (`document.body.innerText`), or the text of a single element when given a `ref`. Output is redacted and truncated to 8,000 characters.

## Authentication Flows

BWM supports two ways to get a session logged in, both driven from a credentials file mounted into the pod:

- **`login` with a `credentialKey`** — a one-call login. The entry either restores cookies (`storageState` mode) or performs a scripted form login with fixed selectors (`formFill` mode) and waits for a success selector.
- **`fill` with a `credentialRef`** — agent-driven login. The agent snapshots the login form, then fills the username and password fields by ref; the harness substitutes the secret server-side.

In both cases the agent sends only a **key name**; the secret value never crosses the API. Details, file format, and guarantees are in [Credentials and Redaction](./security.md).

## Bot-Defense Detection

After each `navigate`, the harness checks the page for signs that an automated agent should stop and hand off to a human:

| `kind` | Signal |
|--------|--------|
| `cloudflare-challenge` | URL matches a Cloudflare challenge or a `captcha.*.com` host |
| `cloudflare-title` | Title contains "just a moment", "ddos-guard", or "checking your browser" |
| `captcha-widget` | Page contains a reCAPTCHA/hCaptcha widget or `[data-sitekey]` |
| `mfa-input` | Page contains a one-time-code input |

The response carries `botDefense: true` and the `kind`. BWM does not attempt to solve CAPTCHAs or MFA challenges.

## Downloads and PDFs

Binary artifacts are not returned inline. The harness uploads them to [Context Service](../context-service/README.md) working memory and returns a reference:

- **`print-to-pdf`** renders the current page as an A4 PDF and stores it with content type `application/pdf`.
- **`download`** clicks a trigger element, waits for the browser's download event (default 5 s), reads the file, and stores it with content type `application/octet-stream`.

Both return `workingMemoryId`, `blobKey`, and `bytes`; `download` also returns the browser's `suggestedFilename` (redacted). Retrieve the file afterwards through Context Service using the `workingMemoryId`.

The manager forwards `CONTEXT_SERVICE_ADDRESS`, `CONTEXT_SERVICE_API_KEY`, and `FF_ENVIRONMENT` to every harness pod for this purpose; without them, PDF and download calls fail.

## How BWM Interacts with Other Services

| Service | Interaction |
|---------|-------------|
| **Kubernetes API** | Manager creates, reads, and deletes Jobs and reads Pods in its namespace |
| **PostgreSQL** | Manager stores `bwm_sessions` and `bwm_jobs`; it creates the tables on startup |
| **Context Service** | Harness stores PDFs and downloads in working memory via the `InsertWMRecord` RPC |
| **Agent bundles / bots** | Consumers call the manager for lifecycle and the harness for verbs; typically each verb is exposed to an LLM as a tool |

## What BWM Does Not Do Yet

The following are part of the longer-term design but are **not implemented** in the current release:

- **Persistent profiles and resume** — saving a session's browser state and resuming it later. Today every session starts clean, and closing a session discards its state.
- **Saved login state** — `storageState` credentials restore cookies only; `origins` (local storage) in the file are ignored, and nothing is written back.
- **Ownership and access control** — there is no per-user or per-tenant ownership of sessions or credentials, and no authentication on the manager or harness APIs.
- **Arbitrary JavaScript evaluation** — there is no `evaluate` verb.
- **Admin console** — sessions are inspected via the REST API or the database.
- **Iframes and multiple tabs** — snapshots cover the main frame only, and verbs act on a single page.

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Credentials and Redaction](./security.md)
- [Virtual Worker Manager — Concepts](../virtual-workers/concepts.md)
