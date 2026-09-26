# Browser Worker Manager — Operations

How to get BWM for your app, verify it from your bundle, what limits to design around, and how to troubleshoot from the caller's side.

## Availability in Your Environment

BWM is a **Preview** service. It is not part of the `firefoundry-core` Helm chart, so there is no `enabled` toggle to flip; it is installed separately by your environment administrator in environments that opt into the preview. Ask your administrator for:

- **The session API address** (typically `http://bwm-manager.<namespace>.svc.cluster.local:3001`). Put it in your bundle's own configuration.
- **Whether PDFs and downloads are enabled** — this requires BWM to be connected to [Context Service](../context-service/README.md) in your environment.
- **The credential sets** provisioned for your app and the key names in each (see [Credentials and Redaction](./security.md)).
- **The idle timeout** if it has been changed from the default (30 minutes).
- **Network access** — confirm your bundle can reach BWM, and that browser sessions can reach the websites your agents need.

The installation method will change when BWM is packaged into a platform release.

## Verifying Access from a Bundle

From inside your bundle's pod (or from bundle code):

```bash
M=http://bwm-manager.<namespace>.svc.cluster.local:3001
curl -s $M/health                      # {"ok":true}
curl -s -X POST $M/sessions -H 'Content-Type: application/json' -d '{}'
# {"sessionId":"…","status":"spawning"}
```

Then poll `GET $M/sessions/<id>` until `ready`, `navigate` to a known page via its `harness_url`, and `DELETE` the session. This confirms the session API, session startup, access to the session URL, and outbound web access. To check PDF storage, add a `print-to-pdf` call. [Getting Started](./getting-started.md) walks through each step.

## Limits and Behavior to Design Around

| Behavior | Value | Design implication |
|----------|-------|--------------------|
| Session startup | Seconds to a few minutes; `failed` if the browser cannot start, closed if still starting after ~5 minutes | Poll with a timeout; budget startup latency into your task |
| First action after `ready` | Within about 1 minute | Send `navigate` immediately after `ready` |
| Idle timeout | 30 minutes between successful actions (default; may differ per environment) | Keep sessions busy or close them; use `POST /sessions/:id/ping` or a cheap action if pausing |
| Session persistence | None — state is lost on close or failure | Make tasks restartable from a fresh session |
| Session resources | Roughly 0.25–1 CPU and 512 MiB–2 GiB memory per session | Very heavy single-page apps can exhaust memory and end the session; avoid many concurrent sessions per task |
| Concurrent sessions | No per-app cap enforced by BWM; bounded by cluster capacity | Limit concurrency in your app; close sessions promptly |
| `navigate` timeout | 30 s (until DOM content loaded) | Retry or `snapshot` for slow pages |
| `click` timeout | 10 s | Snapshot and check before retrying a click that may have succeeded |
| `formFill` login success wait | 10 s | Choose a `successSelector` that appears promptly |
| `download` wait | 5 s default (`waitMs`) | Raise `waitMs` for slow-generating files |
| `extract` output | 8,000 characters | Extract specific elements for long pages |
| Snapshot scope | Main frame only; six roles | Content in iframes is not visible or clickable by ref |
| Tabs/pop-ups | Not tracked | Avoid flows that open a new window |
| Authentication | None on the session/browser APIs | Call only from in-cluster bundles; see [Credentials and Redaction](./security.md#access-control-in-this-release) |
| Metrics/tracing | None in this release | Log `sessionId` and action outcomes in your bundle |

## Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| Connection refused / DNS failure to the session API | BWM not installed in this environment, wrong address, or network policy | Confirm availability and address with your administrator |
| `POST /sessions` returns 500 | BWM cannot start sessions in this environment | Report to your administrator with the error body |
| Session goes to `failed` | Browser could not start (capacity, image, or network problem) | Retry once with a new session; if it persists, report the `sessionId` to your administrator |
| Session stays `spawning` then becomes `closed` | Startup did not complete within ~5 minutes | Same as above; add a startup timeout to your poll loop |
| Session goes `ready` → `closed` about a minute later | No action was sent after `ready` | Send the first action immediately after `ready` |
| Active session closed unexpectedly | Idle longer than the idle timeout | Send actions or pings more often, or restructure long pauses |
| Actions fail with a connection error, session still shows `active` | The session's browser ended (for example, ran out of memory) | `DELETE` the session and start a new one |
| `409 stale-ref` | Page changed or a newer snapshot was taken | Take a new snapshot and use fresh refs |
| `fill` with `credentialRef` returns `409 … credential revalidation failed` | Field changed, is not an `<input>`, has no explicit `type`, or a password credential targets a non-password field | Re-snapshot and pick the correct field; for inputs without a `type`, use `login` with a `formFill` entry |
| `412 credentials file not mounted` | Session created without `credsSecretName`, or the named set does not exist | Create a new session with the correct set name; confirm the set with your administrator |
| `404 credentialRef/credentialKey not found` | Wrong key name, or wrong entry type for the action | Check the key names in your set; `value` entries are for `fill`, `formFill`/`storageState` for `login` |
| `401 login failure` | Wrong credentials, changed login page, or `successSelector` too slow/incorrect | `extract` the page to see the error; ask your administrator to update the entry |
| `print-to-pdf` / `download` return 500 with a connection or URL error | Context Service not configured for BWM in this environment | Ask your administrator to enable PDF/download storage |
| `download` returns 500 with a timeout | The trigger did not start a browser download within `waitMs` | Increase `waitMs`; confirm the selector triggers a download rather than opening a page |
| `navigate` returns `botDefense: true` | CAPTCHA, challenge page, or MFA prompt | BWM cannot solve these; hand off to a human, or use a `storageState` (cookie) credential |

When reporting a problem to your administrator, include the `sessionId`, the time, and the failing action and response.

## Related

- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Credentials and Redaction](./security.md)
