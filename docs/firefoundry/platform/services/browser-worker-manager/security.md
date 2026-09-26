# Browser Worker Manager — Credentials and Redaction

Agents that log into websites need credentials, but an LLM should never see, store, or echo a password. This page explains how to give a browser session access to site credentials, how your agent uses them without seeing them, and what is kept out of the output your agent receives.

## Design Principle: Name the Secret, Never Send It

Your agent refers to a credential only by its **key name** — `credentialRef` for `fill`, `credentialKey` for `login`. BWM looks up the value in the session's credential set and types it into the page itself. The secret value never appears in:

- the request your agent sends,
- the response it gets back,
- BWM's logs, including on error paths.

This means credential values never enter your LLM's context, prompts, tool arguments, or conversation history. Keep it that way: do not add a tool parameter that accepts a raw password.

## Providing Credentials to a Session

Credentials are grouped into a **credential set** — a named bundle of entries, one per key. There is not yet an API, Console, or CLI path for managing credential sets; **your environment administrator provisions them** and tells you the set name and the key names inside it.

To use a set, pass its name when creating the session:

```bash
curl -s -X POST $M/sessions -H 'Content-Type: application/json' \
  -d '{"credsSecretName":"portal-creds"}'
```

- The set is attached for the life of that session only and is read-only.
- The set must exist **before** you create the session. If it does not, the session still starts, but every credential action returns `412 credentials file not mounted`.
- Always pass `credsSecretName` explicitly when you need credentials.
- Sessions without credentials need no set at all.

Good practice when requesting credential sets:

- **One set per site (or per task)**, containing only the entries that site needs. Any agent that can drive a session with that set can use every key in it.
- **Least-privilege accounts** — use a dedicated, read-only portal account where the site supports one.
- **Ask for rotation and removal** when an account is no longer needed. BWM does not create, rotate, or delete credential sets.

## Credential Entry Types

Each key in a set is one of three types. Share this with your administrator when requesting a set.

### `value` — for `fill` with `credentialRef`

A single secret the agent can type into a field it has chosen.

```json
{
  "portal-username": { "mode": "value", "value": "<username>", "field": "text" },
  "portal-password": { "mode": "value", "value": "<password>", "field": "password" }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `value` | Yes | The secret to type |
| `field` | No | `"password"` or `"text"`. With `"password"`, BWM only types it into an `<input type="password">`. Mark every password this way. |

### `formFill` — for `login` (scripted form login)

A complete, pre-configured login for a site with a stable login form.

```json
{
  "portal": {
    "mode": "formFill",
    "loginUrl": "https://portal.example.com/login",
    "usernameSelector": "#username",
    "passwordSelector": "#password",
    "submitSelector": "button[type=submit]",
    "successSelector": "#account-dashboard",
    "username": "<username>",
    "password": "<password>"
  }
}
```

`login` navigates to `loginUrl`, fills username and password, clicks submit, and waits up to 10 s for `successSelector`. Success returns `{"ok":true,"mode":"formFill","url":…}`; if the success marker does not appear, it returns `401`.

### `storageState` — for `login` (cookie restore)

Restores an existing authenticated session from cookies.

```json
{
  "portal-cookies": {
    "mode": "storageState",
    "storageState": { "cookies": [ { "name": "session", "value": "<cookie>", "domain": "portal.example.com", "path": "/" } ] }
  }
}
```

Only cookies are applied (not local storage), and nothing is written back after the session. This is one way to handle sites that require MFA at login: a human completes the login elsewhere and the resulting cookies are provisioned, for as long as the site honors them.

A `value` entry cannot be used with `login`, and `formFill`/`storageState` entries cannot be used with `fill`; both return `404`.

## Credential Fill Safeguards

A credential fill is not a blind write. For `fill` with `credentialRef`:

1. **Ref required.** `credentialRef` must be paired with a `ref` from the current snapshot; CSS selectors are rejected (`400 credentialRef requires ref`). This ensures the field being filled is the one the agent actually inspected.
2. **Same element.** The ref is bound to the exact element from the snapshot. A page that swaps in a look-alike field does not satisfy it.
3. **Current snapshot.** Refs from an older snapshot, or from before a navigation, are rejected with `409 stale-ref`.
4. **Re-checked immediately before typing.** The target must still be editable, an `<input>`, of the same `type` as in the snapshot, and — for a `field: "password"` credential — a password input. Otherwise nothing is typed and the call returns `409 stale-ref` with `detail: "credential revalidation failed"`.

> **Limitation:** credential fill needs the target `<input>` to declare an explicit `type` attribute. For login forms whose inputs omit it, use a `formFill` entry with `login` instead.

## Redaction: What the Agent Does Not See

BWM remembers every secret it has typed in the session — each `value` resolved for a credential fill (even if the fill was then aborted) and each `formFill` password. Before any page-derived text is returned to your agent, or written to logs, every occurrence of those secrets is replaced with `[REDACTED]`:

| Action | Redacted fields |
|--------|-----------------|
| `navigate` | `title`, `url` |
| `snapshot` | `url`, each element's `name` |
| `extract` | `url`, `text` |
| `click` | `url` |
| `login` (`formFill`) | post-login `url` |
| `download` | `suggestedFilename` |

In addition:

- **Snapshots never include field values**, so what is typed into a field cannot be read back through a snapshot.
- **Fill and login errors use fixed messages** and never include the underlying browser error, which could contain the typed text.

### What redaction does not cover

Redaction is a safety net, not a security boundary. It does **not**:

- redact the **username** of a `formFill` login, or text your agent typed with a literal `value`,
- redact cookies restored via `storageState`,
- catch transformed secrets (encoded, split, or partially masked),
- apply to PDFs or downloaded files — these are stored as-is in Context Service, so treat them as potentially sensitive,
- carry over between sessions.

Rely primarily on the structural protections: key-name-only APIs, ref-bound and re-checked fills, and value-free snapshots.

## Access Control in This Release

The session and browser APIs have **no authentication** in this release. Anything that can reach a session's `harness_url` can drive that browser — including filling its credentials into a page of its choosing. In practice:

- Only call BWM from your agent bundles inside the cluster; never expose session URLs to end users or external systems.
- Don't log or return `harness_url` to untrusted callers.
- Scope credential sets narrowly (see above), since the credential set is effectively available to whoever can reach the session.
- Your environment administrator is responsible for restricting network access to BWM.

## Related

- [Concepts — Perception: Snapshots and Refs](./concepts.md#perception-snapshots-and-refs)
- [Reference — POST /session/fill](./reference.md#post-sessionfill)
- [Reference — POST /session/login](./reference.md#post-sessionlogin)
- [Operations](./operations.md)
