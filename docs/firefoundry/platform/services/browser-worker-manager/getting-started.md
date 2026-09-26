# Browser Worker Manager — Getting Started

This walkthrough opens a browser session, drives a page with snapshot-and-ref actions, logs in with a stored credential, captures a PDF, and closes the session. It then shows the same flow from TypeScript inside an agent bundle.

> BWM is in **Preview**. Confirm it is available in your environment first — see [Operations — Availability](./operations.md#availability-in-your-environment).

## Prerequisites

- BWM installed in your environment, and its manager URL (typically `http://bwm-manager.<namespace>.svc.cluster.local:3001`)
- For logins: the name of a credential set provisioned for you (see [Credentials and Redaction](./security.md))
- For PDFs and downloads: Context Service enabled for BWM in your environment
- A shell **inside the cluster** — the browser session URL is only reachable in-cluster. For example, open a shell in your agent bundle's pod (`kubectl exec -it <bundle-pod> -- sh`) with `curl` available.

```bash
M=http://bwm-manager.<namespace>.svc.cluster.local:3001
curl -s $M/health
# {"ok":true}
```

## Step 1: Create a Session and Wait for Ready

```bash
SESSION_ID=$(curl -s -X POST $M/sessions \
  -H 'Content-Type: application/json' -d '{}' | jq -r .sessionId)

until [ "$(curl -s $M/sessions/$SESSION_ID | jq -r .status)" = "ready" ]; do sleep 3; done
H=$(curl -s $M/sessions/$SESSION_ID | jq -r .harness_url)
echo $H
# http://10.244.0.23:3000
```

If the status becomes `failed`, see [Operations — Troubleshooting](./operations.md#troubleshooting).

> **Move straight on to Step 2.** A `ready` session that has not received an action within about a minute may be closed as idle.

## Step 2: Navigate

All browser actions go to the session's `harness_url`:

```bash
curl -s -X POST $H/session/navigate \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' | jq
```

```json
{ "ok": true, "title": "Example Domain", "url": "https://example.com/", "botDefense": false }
```

The session is now `active`.

## Step 3: Snapshot the Page and Act by Ref

```bash
curl -s -X POST $H/session/snapshot | jq
```

```json
{
  "ok": true,
  "snapshot_epoch": 1,
  "url": "https://example.com/",
  "elements": [
    { "ref": "ref_1_main_0", "role": "link", "name": "Learn more", "enabled": true }
  ]
}
```

Click an element by its ref:

```bash
curl -s -X POST $H/session/click \
  -H 'Content-Type: application/json' -d '{"ref":"ref_1_main_0"}' | jq
```

The click navigates, which invalidates every ref from the previous snapshot. Reusing one now returns `409`:

```bash
curl -s -X POST $H/session/click \
  -H 'Content-Type: application/json' -d '{"ref":"ref_1_main_0"}'
# {"ok":false,"error":"stale-ref","detail":"epoch mismatch"}
```

Take a new snapshot whenever the page changes. To read the page text:

```bash
curl -s -X POST $H/session/extract -H 'Content-Type: application/json' -d '{}' | jq .text
```

## Step 4: Log In with a Stored Credential (Optional)

Credentials are selected **when you create the session**, by passing the name of a credential set in `credsSecretName`. Suppose your administrator has provisioned a set named `portal-creds` containing the keys `portal-username` and `portal-password`:

```bash
SESSION_ID=$(curl -s -X POST $M/sessions \
  -H 'Content-Type: application/json' \
  -d '{"credsSecretName":"portal-creds"}' | jq -r .sessionId)
# ...wait for ready and read harness_url as in Step 1...
```

Navigate to the login page, snapshot it, and fill fields by ref using `credentialRef` instead of `value`:

```bash
curl -s -X POST $H/session/navigate -H 'Content-Type: application/json' \
  -d '{"url":"https://portal.example.com/login"}' > /dev/null
curl -s -X POST $H/session/snapshot | jq '.elements[] | select(.role=="textbox" or .role=="button")'

curl -s -X POST $H/session/fill -H 'Content-Type: application/json' \
  -d '{"ref":"ref_1_main_2","credentialRef":"portal-username"}'
curl -s -X POST $H/session/fill -H 'Content-Type: application/json' \
  -d '{"ref":"ref_1_main_3","credentialRef":"portal-password"}'
curl -s -X POST $H/session/click -H 'Content-Type: application/json' \
  -d '{"ref":"ref_1_main_4"}'
```

Each fill returns only `{"ok":true}`; the secret never appears in a request or response. For the one-call `login` action, see [Credentials and Redaction](./security.md).

## Step 5: Save a PDF or Capture a Download (Optional)

```bash
curl -s -X POST $H/session/print-to-pdf -H 'Content-Type: application/json' \
  -d '{"name":"statement.pdf","description":"Account statement"}' | jq
```

```json
{ "ok": true, "workingMemoryId": "…", "blobKey": "…", "bytes": 48213, "mimeType": "application/pdf" }
```

To capture a file the site offers for download, name the element that triggers it:

```bash
curl -s -X POST $H/session/download -H 'Content-Type: application/json' \
  -d '{"triggerSelector":"a#download-csv","waitMs":10000,"name":"usage.csv"}' | jq
```

Retrieve either file from [Context Service](../context-service/README.md) with the returned `workingMemoryId`.

## Step 6: Close the Session

```bash
curl -s -X DELETE $M/sessions/$SESSION_ID
# {"ok":true}
```

## From an Agent Bundle (TypeScript)

There is no Agent SDK wrapper for BWM yet; call the HTTP APIs with `fetch`. A minimal helper:

```typescript
// Your bundle's own setting, e.g. http://bwm-manager.<namespace>.svc.cluster.local:3001
const BWM = process.env.BROWSER_MANAGER_URL!;

async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'bwm error'), { status: res.status, body: json });
  return json;
}

export async function withBrowserSession<T>(
  opts: { credsSecretName?: string },
  work: (harnessUrl: string) => Promise<T>,
): Promise<T> {
  const { sessionId } = await post(`${BWM}/sessions`, opts);
  try {
    let harnessUrl: string | null = null;
    for (let i = 0; i < 60 && !harnessUrl; i++) {
      const s = await (await fetch(`${BWM}/sessions/${sessionId}`)).json();
      if (s.status === 'failed' || s.status === 'closed') throw new Error(`session ${s.status}`);
      if (s.status === 'ready' || s.status === 'active') harnessUrl = s.harness_url;
      else await new Promise(r => setTimeout(r, 3000));
    }
    if (!harnessUrl) throw new Error('session did not become ready');
    return await work(harnessUrl); // send the first action promptly
  } finally {
    await fetch(`${BWM}/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
  }
}

// Usage
await withBrowserSession({ credsSecretName: 'portal-creds' }, async (h) => {
  const nav = await post(`${h}/session/navigate`, { url: 'https://portal.example.com/login' });
  if (nav.botDefense) throw new Error(`blocked by ${nav.kind}`);
  const snap = await post(`${h}/session/snapshot`);
  // hand snap.elements to the LLM; map its tool calls to click / fill / extract ...
});
```

In an LLM-driven bot, expose `navigate`, `snapshot`, `click`, `fill`, `extract`, `print-to-pdf`, and `download` as tools that call the corresponding endpoints on `harnessUrl`. Only expose `credentialRef` / `credentialKey` parameters (key names), never raw secret values.

## Next Steps

- [Concepts](./concepts.md) — lifecycle, refs, and agent design patterns
- [Reference](./reference.md) — every endpoint and error code
- [Credentials and Redaction](./security.md) — credential sets and guarantees
- [Operations](./operations.md) — availability, limits, and troubleshooting
