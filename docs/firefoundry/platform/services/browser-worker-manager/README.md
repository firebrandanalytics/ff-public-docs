# Browser Worker Manager (BWM)

> **Status: Preview.** BWM is under active development and has not yet been promoted to a platform release. It is not part of the `firefoundry-core` Helm chart; it is deployed from raw Kubernetes manifests. APIs and behavior described here may change.

## Overview

The Browser Worker Manager (BWM) gives agents a **persistent, headless browser session** they can drive one step at a time: navigate to a page, look at what is on it, click, fill in forms, log in, save the page as a PDF, or capture a file download. Each session runs in its own short-lived Kubernetes Job with a dedicated Chromium instance, so cookies, login state, and the current page survive across many separate calls from an agent's reasoning loop.

BWM is named in parallel with the [Virtual Worker Manager (VWM)](../virtual-workers/README.md) and reuses the same shape — a manager service that spawns one isolated pod per session and talks to an in-pod **harness** over HTTP. Where VWM wraps a CLI coding agent, BWM wraps a browser.

## Purpose and Role in Platform

Many business tasks live behind websites that have no API: utility portals, supplier dashboards, government forms, internal line-of-business apps. An LLM-driven agent can operate those sites if it has a browser it can control step by step and a safe way to authenticate. BWM provides:

- **A long-lived browser per task** — one browser context per session, kept alive between verbs so multi-page flows (log in, search, open a result, download a statement) work naturally
- **Structured perception** — an accessibility-tree `snapshot` that turns a page into a numbered list of interactive elements the agent can address by reference instead of guessing CSS selectors
- **Credential isolation** — secrets are mounted into the session pod and substituted server-side; the agent names a credential, it never sees or sends the value
- **Artifact capture** — PDFs and downloaded files are stored in [Context Service](../context-service/README.md) working memory and returned as references, not raw bytes
- **Automatic cleanup** — an in-process reaper closes sessions that never became ready or have gone idle

## Key Features

- **Session lifecycle API** — create, list, inspect, and tear down browser sessions via a small REST API on the manager
- **Per-session isolation** — each session is its own Kubernetes Job and pod; no browser state is shared between sessions
- **Three-gate readiness handshake** — the manager tracks pod scheduled → harness listening → browser launched before marking a session `ready`
- **Browser verbs** — `navigate`, `snapshot`, `extract`, `click`, `fill`, `login`, `print-to-pdf`, `download`
- **Ref-based actions** — `click`, `fill`, and `extract` accept an element `ref` from the latest snapshot; stale refs are rejected with `409` rather than acting on the wrong element
- **Server-side secret fill** — `fill` with `credentialRef` and `login` with `credentialKey` inject secrets from a mounted Kubernetes Secret, after re-validating the target element
- **Redaction of injected secrets** — known injected secret values are scrubbed from page-derived response fields and logs
- **Bot-defense signal** — `navigate` reports when it lands on a CAPTCHA, challenge page, or one-time-code prompt so the agent can stop instead of looping
- **Idle and spawn timeouts** — configurable inactivity and spawn deadlines enforced by the reaper

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                 Consumers (Agent Bundles, Bots)                  │
└───────────────┬───────────────────────────────┬──────────────────┘
                │ 1. Session API (REST :3001)   │ 3. Browser verbs
                │    create / get / delete      │    (REST :3000, direct
                ▼                               │     to harness_url)
┌──────────────────────────────────┐            │
│   BWM Manager (ff-services-bwm)  │            │
│  ┌──────────────┐ ┌────────────┐ │            │
│  │ Session API  │ │  Spawn     │ │            │
│  │              │ │  Watcher   │ │            │
│  └──────────────┘ └────────────┘ │            │
│  ┌──────────────┐ ┌────────────┐ │            │
│  │   Reaper     │ │ Ping (idle │ │◀─── ping ──┤
│  │              │ │  tracking) │ │            │
│  └──────────────┘ └────────────┘ │            │
└──────┬─────────────────┬─────────┘            │
       │                 │ 2. create Job        │
┌──────▼──────┐   ┌──────▼─────────────────────▼──────────┐
│ PostgreSQL  │   │  Harness Pod (one K8s Job per session)│
│ bwm_sessions│   │  ┌─────────────────────────────────┐  │
│ bwm_jobs    │   │  │ ff-bwm-harness (Express)        │  │
└─────────────┘   │  │  ref-table · redaction · verbs  │  │
                  │  ├─────────────────────────────────┤  │
                  │  │ Playwright + headless Chromium  │  │
                  │  │ (one context, one page)         │  │
                  │  ├─────────────────────────────────┤  │
                  │  │ /secrets/credentials.json (RO)  │  │
                  │  └─────────────────────────────────┘  │
                  └──────────────────┬────────────────────┘
                                     │ PDFs / downloads
                             ┌───────▼────────┐
                             │ Context Service│
                             │ working memory │
                             └────────────────┘
```

1. A consumer calls `POST /sessions` on the manager. The manager records the session in PostgreSQL and creates a Kubernetes Job running the harness image.
2. A background watcher waits for the pod to be scheduled, for the harness HTTP server to answer, and for Chromium to launch, then stores the pod's `harness_url` and marks the session `ready`.
3. The consumer reads `harness_url` from `GET /sessions/:id` and sends browser verbs **directly to the harness**. After each successful verb the harness pings the manager so the session stays alive.
4. `DELETE /sessions/:id` (or the reaper) asks the harness to shut down and removes the Job.

### Components

| Component | Location in repository | Purpose |
|-----------|------------------------|---------|
| **ff-services-bwm** (`@bwm/manager`) | `apps/ff-services-bwm/` | Manager REST API, Job spawning, readiness watcher, reaper |
| **ff-bwm-harness** (`@bwm/harness`) | `packages/ff-bwm-harness/` | In-pod Express server wrapping Playwright/Chromium; all browser verbs |
| **ff-bwm-harness-client** (`@bwm/harness-client`) | `packages/ff-bwm-harness-client/` | Minimal TypeScript client for the harness verbs |
| Schema | `db/migrations/001_initial.sql` | `bwm_sessions` and `bwm_jobs` tables |
| Manifests | `k8s/` | Namespace, RBAC, manager Deployment/Service, reference Job template |

### BWM vs. VWM at a glance

| | Virtual Worker Manager | Browser Worker Manager |
|---|---|---|
| What runs in the pod | A CLI coding agent (Claude Code, Codex, …) | Headless Chromium driven by Playwright |
| Who does the reasoning | The CLI agent inside the pod | The **calling** agent/bot; the pod only executes verbs |
| Unit of work | Prompt → multi-step autonomous run | One browser verb per call |
| Workspace | Git repos on a persistent volume | In-memory browser context (not persisted) |
| Consumer talks to | VWM only (VWM proxies to the harness) | Manager for lifecycle, **harness directly** for verbs |
| Idle behavior | Suspend and transparently resume | Close (no resume in this release) |
| Deployment | Helm chart (`virtual-worker-manager`) | Raw Kubernetes manifests (no Helm chart yet) |

## Documentation

- **[Concepts](./concepts.md)** — Sessions, the harness/worker model, lifecycle and readiness gates, snapshots and refs, downloads
- **[Getting Started](./getting-started.md)** — Deploy BWM on a local cluster, open a session, and drive a page end to end
- **[Reference](./reference.md)** — Manager and harness endpoints, request/response shapes, error codes, environment variables, schema
- **[Credentials and Redaction](./security.md)** — How secrets are mounted, filled, and kept out of responses and logs
- **[Operations](./operations.md)** — Deployment, configuration, scaling limits, security hardening, monitoring, troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0 (manager, harness, and harness client)
- **Maturity**: Preview — not yet merged to the repository's main branch or packaged in a platform Helm chart
- **Runtime**: Node.js 20, Playwright with Alpine `chromium`, PostgreSQL
- **Not yet implemented**: persistent/resumable browser profiles, saved login state across sessions, per-user ownership/ACLs, an admin console, and authentication on the manager and harness APIs. See [Concepts — What BWM does not do yet](./concepts.md#what-bwm-does-not-do-yet).

## Repository

Source code: [ff-browser-workers](https://github.com/firebrandanalytics/ff-browser-workers) (private)

## Related

- [Platform Services Overview](../README.md)
- [Virtual Worker Manager](../virtual-workers/README.md) — the sibling service BWM is modeled on
- [Context Service](../context-service/README.md) — where PDFs and downloads are stored
- [Platform Architecture](../../architecture.md)
