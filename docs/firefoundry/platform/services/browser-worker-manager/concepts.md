# Browser Worker Manager — Concepts

This page explains when an agent should use a browser session, how a session behaves from the caller's side, how an agent perceives and acts on a page, and how to design agents around BWM.

## When to Use a Browser Session

Use BWM when the data or action your agent needs is only reachable through a website's UI:

- **Good fit** — logging into a supplier or utility portal to download statements, filling a government or partner web form, reading data from an internal app with no API, capturing a page as a PDF for audit.
- **Poor fit** — anything with a usable API (call the API instead; it is faster and more reliable), plain public page reads where a [web search](../web-search/README.md) or a simple HTTP fetch suffices, and sites protected by CAPTCHA or interactive MFA (BWM detects these but cannot get past them).

A browser session is comparatively heavy: it takes time to start, holds resources while open, and is only as reliable as the target site's markup. Open one per task, do the task, and close it.

## Who Does the Reasoning

BWM contains only a browser. **Your agent runs the reasoning loop** and sends one action at a time; BWM executes exactly what it is told and returns a result. This differs from the [Virtual Worker Manager](../virtual-workers/concepts.md), where the pod contains an autonomous agent that you send a prompt to.

The typical pattern is to expose each browser action (`navigate`, `snapshot`, `click`, `fill`, `extract`, `login`, `print-to-pdf`, `download`) as a tool to an LLM, and let it loop until the task is done.

## Sessions

A **session** is one isolated browser, for one task:

- **One browser tab.** Cookies, local storage, and the current URL persist for the life of the session. Pop-ups and new tabs are not tracked; every action acts on the single page.
- **One optional credential set**, chosen when you create the session (see [Credentials and Redaction](./security.md)).
- **Nothing persists after close.** When a session closes, its browser state is gone; a new session starts from a clean browser.

### Session lifecycle

```
POST /sessions ──▶ spawning ──(browser up)──▶ ready ──(first action)──▶ active
                      │                          │                        │
                      ▼                          │   DELETE /sessions/:id │
                   failed                        │   or idle timeout      │
                                                 ▼                        ▼
                                              closed ◀────────────────────┘
```

| Status | What it means for you |
|--------|-----------------------|
| `spawning` | The browser is starting. Keep polling. |
| `ready` | The browser is up and `harness_url` is set. Send your first action **now**. |
| `active` | At least one action has succeeded. Keep sending actions. |
| `failed` | The browser could not be started. Create a new session. |
| `closed` | The session was closed by you or by the idle timeout. Create a new session if you need to continue. |

### Create, wait, use, close

1. **Create** — `POST /sessions` returns immediately with `{"sessionId", "status": "spawning"}`.
2. **Wait for ready** — poll `GET /sessions/:id` every few seconds until `status` is `ready` (or `failed`). A session that cannot start becomes `failed` (usually within a few minutes); one still `spawning` after about 5 minutes is closed automatically.
3. **Use** — read `harness_url` from the session and send browser actions to it.
4. **Close** — `DELETE /sessions/:id` when the task is finished, including on error paths.

### Keeping a session alive

Sessions are closed automatically when they appear idle. Design for these rules:

- **Send your first action within about a minute of `ready`.** A session that has never received an action is treated as idle and can be closed as soon as the next cleanup pass runs (by default, up to 60 seconds after it becomes ready). A `navigate` is the natural first action.
- **Every successful action counts as activity.** After that, a session stays open as long as there is less than the idle timeout (30 minutes by default) between successful actions.
- **Failed actions do not count.** A string of errors does not keep a session alive.
- **Pausing longer?** If your agent must wait (for example, on a human decision) and might exceed the idle timeout, send a lightweight action such as `extract`, or call `POST /sessions/:id/ping` on the manager, to reset the timer. Otherwise, close the session and open a new one later.

## Perception: Snapshots and Refs

Agents that must invent CSS selectors from page prose tend to guess wrong. BWM gives the agent a structured view instead.

### Snapshot

`POST /session/snapshot` returns every interactive element on the page with these roles, in this order:

`button`, `link`, `textbox`, `combobox`, `checkbox`, `menuitem`

Each element comes with a **ref** and a small, fixed set of attributes:

```json
{ "ref": "ref_3_main_4", "role": "textbox", "name": "Password", "enabled": true, "required": true, "type": "password" }
```

| Field | Notes |
|-------|-------|
| `ref` | Opaque token identifying this element in this snapshot |
| `role` | One of the six roles above |
| `name` | Accessible name (label, `aria-label`, link text), redacted |
| `enabled` | `false` if the element is disabled |
| `checked` | Checkboxes only |
| `required` | Present (`true`) when the field is required |
| `type` | `<input>` type, when the element is an input |

A snapshot **never** includes a form field's current value, so it cannot leak what is already typed into a field, including a password. Duplicate names are fine — the ref, not the name, identifies the element.

Only the main frame is covered; content inside iframes does not appear.

### Stale refs

Each snapshot replaces the previous set of refs, and any navigation invalidates them. A ref is only valid until the next snapshot or page change:

- A malformed ref → `400 malformed ref`
- A ref from an older snapshot, or whose element has been removed → `409 stale-ref`

Refs are bound to the exact element captured in the snapshot. If a page swaps an element for a look-alike, the old ref will not silently target the new one.

The practical loop for an agent is:

```
snapshot ──▶ pick ref ──▶ click / fill / extract ──▶ (page changed?) ──▶ snapshot again
```

On any `409 stale-ref`, take a fresh snapshot and retry with a new ref.

### Selectors remain available

`click` and `fill` also accept a plain CSS `selector` as an escape hatch (useful for deterministic, hand-written flows). If both are supplied, `ref` wins. Filling a **credential** always requires a `ref`. `download` currently takes a CSS selector only.

### Extract

`POST /session/extract` returns the page's visible text, or the text of one element when given a `ref`. Output is redacted and truncated to 8,000 characters, so for long pages extract specific elements rather than the whole page.

## Logging In

Two ways to get a session logged in, both using a credential set that you select when creating the session:

- **`login` with a `credentialKey`** — one call. Either restores cookies (`storageState`) or runs a pre-configured form login and waits for a success marker (`formFill`). Best for well-known sites with stable login forms.
- **`fill` with a `credentialRef`** — agent-driven. The agent snapshots the login form, then fills the username and password fields by ref; BWM types the secret. Best when the login form varies or the agent must navigate to it.

In both cases the agent sends only a **key name**; the secret value never crosses the API. See [Credentials and Redaction](./security.md).

## Bot-Defense Detection

After each `navigate`, BWM checks whether the page is something an automated agent should not try to push through:

| `kind` | Signal |
|--------|--------|
| `cloudflare-challenge` | A Cloudflare challenge or CAPTCHA host |
| `cloudflare-title` | Title such as "Just a moment", "DDoS-Guard", or "Checking your browser" |
| `captcha-widget` | A reCAPTCHA/hCaptcha widget on the page |
| `mfa-input` | A one-time-code input |

The response carries `botDefense: true` and the `kind`. BWM does not solve CAPTCHAs or MFA. Instruct your agent to stop and escalate (for example, to a human task) when it sees `botDefense: true`.

## Downloads and PDFs

Files are not returned inline. BWM stores them in [Context Service](../context-service/README.md) working memory and returns a reference:

- **`print-to-pdf`** renders the current page as an A4 PDF (`application/pdf`).
- **`download`** clicks a trigger element, waits for the browser download, and stores the file (`application/octet-stream`).

Both return `workingMemoryId`, `blobKey`, and `bytes`; `download` also returns the browser's `suggestedFilename`. Fetch the file afterwards through Context Service using the `workingMemoryId`, or pass that ID to the next step of your workflow.

## Designing Agents Around BWM

### Example: portal-scraping agent

An agent that collects monthly statements from a utility portal:

1. **Create** a session with the portal's credential set; poll until `ready`.
2. **Log in** — `login` with the portal's `credentialKey`, or `navigate` to the login page, `snapshot`, and `fill` username/password by `credentialRef`, then `click` submit.
3. **Check** — if any `navigate` returns `botDefense: true`, stop and escalate.
4. **Find the statement** — `snapshot`, pick the "Statements" link by ref, `click`, `snapshot` again.
5. **Capture** — `download` the statement file (or `print-to-pdf` the statement page). Record the returned `workingMemoryId`.
6. **Close** the session in a `finally` block.
7. **Process** the stored file downstream, for example with [Document Processing](../doc-proc-service/README.md), using the `workingMemoryId`.

### Design guidelines

- **One session per task, always closed.** Put `DELETE /sessions/:id` in cleanup code; do not rely on the idle timeout for routine cleanup.
- **Snapshot after every page change.** Treat `409 stale-ref` as "look again", not as a failure.
- **Give the LLM snapshots, not HTML.** The snapshot plus targeted `extract` calls is usually enough context and far smaller than raw page text.
- **Never put secrets in prompts or tool arguments.** Use `credentialRef` / `credentialKey`; see [Credentials and Redaction](./security.md).
- **Cap the loop.** Bound the number of actions per task so a confusing page does not burn tokens indefinitely.
- **Hand off bot defenses.** Treat `botDefense: true` as a terminal condition for automation.
- **Don't auto-retry side-effecting actions blindly.** A `click` that timed out may still have submitted a form; snapshot and check before retrying.
- **Expect session loss.** If an action fails because the session is gone (connection error, or status `closed`), start a new session; state does not carry over.

## What BWM Does Not Do Yet

These are **not available** in the current release:

- **Persistent profiles and resume** — every session starts clean, and closing a session discards its state.
- **Saved login state** — `storageState` credentials restore cookies only (not local storage), and nothing is written back after a session.
- **Ownership and access control** — no per-user or per-tenant ownership of sessions or credentials, and no authentication on the session or browser APIs.
- **Arbitrary JavaScript evaluation** — there is no `evaluate` action.
- **Iframes and multiple tabs** — snapshots cover the main frame only, and actions act on a single page.
- **Agent SDK wrapper** — call the HTTP APIs directly from your bundle.

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Credentials and Redaction](./security.md)
- [Virtual Worker Manager — Concepts](../virtual-workers/concepts.md)
