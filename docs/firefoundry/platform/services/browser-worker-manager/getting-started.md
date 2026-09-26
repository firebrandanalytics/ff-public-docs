# Browser Worker Manager — Getting Started

This walkthrough deploys BWM onto a local Kubernetes cluster, opens a browser session, drives a page with snapshot-and-ref actions, logs in with a mounted credential, captures a PDF, and tears the session down.

> BWM is in **Preview** and has no Helm chart yet. These steps use the raw manifests in the repository's `k8s/` directory.

## Prerequisites

- A local Kubernetes cluster (the examples use minikube; see [Minikube Bootstrap](../../../local-development/minikube-bootstrap.md)) and `kubectl`
- Docker, to build the two images
- A checkout of the [ff-browser-workers](https://github.com/firebrandanalytics/ff-browser-workers) repository (private)
- A PostgreSQL database the manager can reach (Step 2 creates a throwaway one)
- Optional, for PDFs and downloads: a running [Context Service](../context-service/README.md)
- `curl` and `jq`

All commands below run from the repository root.

## Step 1: Build the Images

Build the manager and harness images directly into minikube's Docker daemon so the cluster can use them without a registry:

```bash
eval $(minikube docker-env)

docker build -t bwm-manager:dev apps/ff-services-bwm
docker build -t bwm-harness:dev packages/ff-bwm-harness
```

The harness image installs Alpine's `chromium` package and points Playwright at it; no browser download happens at build time.

## Step 2: Create the Namespace, RBAC, and Database Secret

`k8s/rbac.yaml` creates the `bwm` namespace, the `bwm-manager` ServiceAccount, and a Role that lets the manager create/get/list/watch/delete Jobs and get/list/watch Pods.

```bash
kubectl apply -f k8s/rbac.yaml
```

For a local trial, run a throwaway PostgreSQL in the same namespace:

```bash
kubectl -n bwm run bwm-postgres --image=postgres:16-alpine \
  --env=POSTGRES_DB=bwm --env=POSTGRES_USER=bwm --env=POSTGRES_PASSWORD=<dev-password> \
  --port=5432
kubectl -n bwm expose pod bwm-postgres --port=5432
```

The manager reads its connection string from a Secret named `bwm-postgres`, key `connection-string`:

```bash
kubectl -n bwm create secret generic bwm-postgres \
  --from-literal=connection-string='postgres://bwm:<dev-password>@bwm-postgres:5432/bwm'
```

You do not need to create tables — the manager applies its schema (`CREATE TABLE IF NOT EXISTS …`) every time it starts.

## Step 3: Deploy the Manager

`k8s/manager-deployment.yaml` contains `{{BWM_MANAGER_IMAGE}}` and `{{BWM_HARNESS_IMAGE}}` placeholders. Substitute the local images, and switch the manager's pull policy to `IfNotPresent` so Kubernetes does not try to pull a locally built image:

```bash
sed -e 's|{{BWM_MANAGER_IMAGE}}|bwm-manager:dev|' \
    -e 's|{{BWM_HARNESS_IMAGE}}|bwm-harness:dev|' \
    -e 's|imagePullPolicy: Always|imagePullPolicy: IfNotPresent|' \
    k8s/manager-deployment.yaml | kubectl apply -f -

kubectl -n bwm rollout status deploy/bwm-manager
```

If you want `print-to-pdf` and `download` to work, tell the manager where Context Service is. It forwards these to every harness pod it spawns:

```bash
kubectl -n bwm set env deploy/bwm-manager \
  CONTEXT_SERVICE_ADDRESS=http://<context-service>.<namespace>.svc.cluster.local:50051 \
  FF_ENVIRONMENT=<environment-name>
```

`CONTEXT_SERVICE_ADDRESS` must include the `http://` scheme. Add `CONTEXT_SERVICE_API_KEY` from a Secret if your Context Service requires one.

Port-forward the manager and check its health:

```bash
kubectl -n bwm port-forward svc/bwm-manager 3001:3001 &
curl -s http://localhost:3001/health
# {"ok":true}
```

## Step 4: Create a Session

```bash
SESSION_ID=$(curl -s -X POST http://localhost:3001/sessions \
  -H 'Content-Type: application/json' -d '{}' | jq -r .sessionId)
echo $SESSION_ID
```

The response is immediate — `{"sessionId":"…","status":"spawning"}` — while the manager starts the Job in the background. Poll until the session is `ready`:

```bash
until [ "$(curl -s http://localhost:3001/sessions/$SESSION_ID | jq -r .status)" = "ready" ]; do
  sleep 3
done
curl -s http://localhost:3001/sessions/$SESSION_ID | jq
```

```json
{
  "id": "5f0c…",
  "manager_id": "bwm-manager-7d9c…",
  "status": "ready",
  "harness_url": "http://10.244.0.23:3000",
  "last_active_at": null,
  "closed_at": null,
  "created_at": "…",
  "updated_at": "…"
}
```

If the status becomes `failed`, see [Operations — Troubleshooting](./operations.md#troubleshooting).

> **Move straight on to Step 5.** A `ready` session that has never received a verb is treated as idle by the reaper and is closed on its next sweep (every 60 s by default).

## Step 5: Reach the Harness and Navigate

In-cluster consumers call `harness_url` directly. From your workstation, port-forward to the session's pod instead:

```bash
POD=$(kubectl -n bwm get pod -l bwm.firefoundry.io/session-id=$SESSION_ID -o name)
kubectl -n bwm port-forward $POD 3000:3000 &
H=http://localhost:3000

curl -s -X POST $H/session/navigate \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' | jq
```

```json
{ "ok": true, "title": "Example Domain", "url": "https://example.com/", "botDefense": false }
```

The session is now `active`, and `last_active_at` updates after every successful verb.

## Step 6: Snapshot the Page and Act by Ref

Ask the harness what is on the page:

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

The click navigates, which invalidates every ref from epoch 1. Reusing it now returns `409`:

```bash
curl -s -X POST $H/session/click \
  -H 'Content-Type: application/json' -d '{"ref":"ref_1_main_0"}'
# {"ok":false,"error":"stale-ref","detail":"epoch mismatch"}
```

Take a new snapshot whenever the page changes, then read the page text:

```bash
curl -s -X POST $H/session/extract -H 'Content-Type: application/json' -d '{}' | jq .text
```

## Step 7: Log In with a Mounted Credential (Optional)

Credentials are delivered as a Kubernetes Secret containing a `credentials.json` key, which is mounted read-only into the session pod at `/secrets`. Create the file (placeholder values shown):

```json
{
  "portal-username": { "mode": "value", "value": "<username>", "field": "text" },
  "portal-password": { "mode": "value", "value": "<password>", "field": "password" }
}
```

Create the Secret **before** creating the session, and pass its name in `credsSecretName`:

```bash
kubectl -n bwm create secret generic bwm-creds-demo --from-file=credentials.json=./credentials.json

SESSION_ID=$(curl -s -X POST http://localhost:3001/sessions \
  -H 'Content-Type: application/json' \
  -d '{"credsSecretName":"bwm-creds-demo"}' | jq -r .sessionId)
```

After the session is ready and you have port-forwarded to its pod (Steps 4–5), navigate to the login page, snapshot it, and fill fields by ref — using `credentialRef` instead of `value`:

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

The harness re-checks each target element before typing (still attached, editable, an `<input>` of the snapshotted type, and `type=password` for a password credential) and returns only `{"ok":true}`. The secret value never appears in a request or response. For the one-call `login` verb and the full file format, see [Credentials and Redaction](./security.md).

## Step 8: Save the Page as a PDF (Optional)

Requires Context Service to be configured (Step 3):

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

## Step 9: Tear Down

```bash
curl -s -X DELETE http://localhost:3001/sessions/$SESSION_ID
# {"ok":true}
```

The manager asks the harness to shut down, deletes the Job, and marks the session `closed`. Delete any per-session credentials Secret you created:

```bash
kubectl -n bwm delete secret bwm-creds-demo
```

## Using the TypeScript Harness Client

The repository includes `@bwm/harness-client`, a small wrapper around the harness verbs (a workspace package, not published to a registry):

```typescript
import { createBwmHarnessClient } from '@bwm/harness-client';

const harness = createBwmHarnessClient({ baseUrl: session.harness_url });
await harness.waitUntilReady();
const nav = await harness.navigate('https://example.com');
const page = await harness.extract();
const pdf = await harness.printToPdf('page.pdf');
```

In this release the client covers `navigate`, `extract`, `click(selector)`, `fill(selector, value)`, `login`, `printToPdf`, `download`, and `shutdown`. It does **not** yet expose `snapshot`, `ref`, or `credentialRef`; call those endpoints directly. Note that the client retries failed requests (3 attempts by default), including non-idempotent verbs such as `click`.

## Next Steps

- [Concepts](./concepts.md) — lifecycle, readiness gates, epochs and refs
- [Reference](./reference.md) — every endpoint and error code
- [Credentials and Redaction](./security.md) — credential file format and guarantees
- [Operations](./operations.md) — configuration, limits, and troubleshooting
