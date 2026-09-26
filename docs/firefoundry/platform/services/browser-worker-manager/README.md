# Browser Worker Manager (BWM)

> **Status: Preview.** BWM is under active development and is not yet part of a platform release. It is not included in the `firefoundry-core` Helm chart, so it is only available in environments where it has been installed separately. APIs and behavior described here may change.

## Overview

The Browser Worker Manager (BWM) gives your agents a **persistent, headless browser session** they can drive one step at a time: navigate to a page, look at what is on it, click, fill in forms, log in with a stored credential, save the page as a PDF, or capture a file download. Cookies, login state, and the current page survive across the many separate calls an agent makes during its reasoning loop, so multi-page flows work naturally.

## Purpose and Role in Platform

Many business tasks live behind websites that have no API: utility portals, supplier dashboards, government forms, internal line-of-business apps. An LLM-driven agent can operate those sites if it has a browser it can control step by step and a safe way to authenticate. BWM provides:

- **A long-lived browser per task** — one isolated browser per session, kept alive between calls so "log in, search, open a result, download a statement" is one session
- **Structured perception** — a `snapshot` that turns a page into a numbered list of interactive elements the agent addresses by reference instead of guessing CSS selectors
- **Credential isolation** — the agent names a stored credential; it never sees or sends the secret value
- **Artifact capture** — PDFs and downloaded files are stored in [Context Service](../context-service/README.md) working memory and returned as references, not raw bytes
- **Automatic cleanup** — sessions that go idle are closed for you

BWM does no reasoning of its own. Your agent (typically an LLM with the browser actions exposed as tools) decides what to do next; BWM executes exactly one action per call and reports back.

## Key Features

- **Session lifecycle API** — create a session, poll until it is ready, and close it when done
- **Per-session isolation** — each session gets its own browser; nothing is shared between sessions
- **Browser actions** — `navigate`, `snapshot`, `extract`, `click`, `fill`, `login`, `print-to-pdf`, `download`
- **Ref-based actions** — `click`, `fill`, and `extract` accept an element `ref` from the latest snapshot; stale refs are rejected with `409` rather than acting on the wrong element
- **Server-side secret fill** — `fill` with `credentialRef` and `login` with `credentialKey` type secrets for the agent, after re-checking the target field
- **Redaction** — injected secret values are scrubbed from page text, titles, and URLs returned to the agent
- **Bot-defense signal** — `navigate` reports when it lands on a CAPTCHA, challenge page, or one-time-code prompt so the agent can stop instead of looping

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│            Your Agent Bundle / Bot (LLM loop)            │
└───────┬──────────────────────────────────┬───────────────┘
        │ 1. Session API                   │ 2. Browser actions
        │    create / get / close          │    (sent to the session's
        ▼                                  │     harness_url)
┌──────────────────────────┐               ▼
│  Browser Worker Manager  │──starts──▶┌─────────────────────────┐
│  (session lifecycle)     │           │  Browser session         │
└──────────────────────────┘           │  headless Chromium       │──▶ target websites
                                       │  + mounted credentials   │
                                       └────────────┬────────────┘
                                                    │ PDFs / downloads
                                           ┌────────▼────────┐
                                           │ Context Service │
                                           │ working memory  │
                                           └─────────────────┘
```

1. Your bundle calls `POST /sessions` on the manager and polls `GET /sessions/:id` until the session is `ready`.
2. It reads the session's `harness_url` and sends browser actions **directly to that URL**, one per call.
3. PDFs and downloads land in Context Service; the response gives you a `workingMemoryId`.
4. When the task is done, the bundle calls `DELETE /sessions/:id`. Idle sessions are also closed automatically.

## Documentation

- **[Concepts](./concepts.md)** — When to use a browser session, lifecycle, snapshots and refs, and designing agents around BWM
- **[Getting Started](./getting-started.md)** — Open a session, drive a page, log in, capture a PDF, and close the session
- **[Reference](./reference.md)** — Session API and browser actions, request/response shapes, error codes
- **[Credentials and Redaction](./security.md)** — Providing site credentials safely and what is kept out of agent-visible output
- **[Operations](./operations.md)** — Availability, verifying access from a bundle, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Preview — not yet packaged in a platform Helm chart
- **Not yet available**: persistent/resumable browser profiles, saved login state across sessions, per-user ownership of sessions or credentials, authentication on the session and browser APIs, iframes and multiple tabs, and an Agent SDK wrapper. See [Concepts — What BWM does not do yet](./concepts.md#what-bwm-does-not-do-yet).

## Repository

Source code: [ff-browser-workers](https://github.com/firebrandanalytics/ff-browser-workers) (private)

## Related

- [Platform Services Overview](../README.md)
- [Virtual Worker Manager](../virtual-workers/README.md) — isolated sessions for autonomous CLI coding agents
- [Context Service](../context-service/README.md) — where PDFs and downloads are stored
- [Platform Architecture](../../architecture.md)
