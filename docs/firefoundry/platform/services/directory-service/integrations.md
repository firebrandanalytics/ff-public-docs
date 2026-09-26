# Directory Service — Integrations

The Directory Service can bring documents in from **Microsoft 365** (SharePoint and OneDrive, through Microsoft Graph) and **Box**. Both use the same model: a person connects their own account, browses it through the directory, and starts an import job that copies a file or folder into a directory drive. Everything is **read-only** and **delegated** — the directory only ever sees what that person can see, and never writes back to the source.

## Support Status

| Provider | Provider id | Browse | Import | Status |
|----------|-------------|--------|--------|--------|
| Microsoft Graph (SharePoint, OneDrive) | `msgraph` | Sites, document libraries, folders, items | Files and folder subtrees | Supported |
| Box | `box` | Folders and items | Files and folder subtrees | **Early access** — validated against a controlled Box-compatible test environment, not yet against live customer Box accounts. Validate with your own Box tenant before relying on it in production. |

Not supported in this release: write-back to the source, delta sync or change notifications, app-only (tenant-wide) credentials, shared-link resolution, and search through the directory.

## How It Works

```
 Application (as user U)           Directory Service                 Provider (Graph / Box)
 ───────────────────────           ─────────────────                 ──────────────────────
 POST /v1/connections:start ──►  create pending connection
                            ◄──  authorizeUrl  (single-use state, 10 min)
 person opens authorizeUrl  ─────────────────────────────────────►  sign in + consent
                                 GET /v1/connections/callback  ◄──  redirect with code + state
                                 exchange code, record account,
                                 seal tokens → status "ok"
 GET  /v1/connections/{id}/...   browse metadata  ───────────────►  list / stat (as U)
 POST /v1/imports           ──►  validate, create job (202)
                                 import workers: enumerate, download,
                                 hash, store, register items  ───►  download (as U)
 GET  /v1/imports/{id}      ──►  counts by entry state
```

Rules that hold across the whole surface:

- **A connection belongs to one (application, user) pair.** Every connection and import route requires `X-On-Behalf-Of: user=<uuid>`; without it they return `400 INVALID_INPUT`. Another application, or the same application acting for another user, gets `404`.
- **No caller-supplied tokens.** Browse and import obtain credentials only from the stored connection.
- **Browse returns metadata only.** There is no endpoint that proxies source file content; bytes are fetched only by import jobs, which have a target folder, an authorization check, and a per-entry record.
- **Imports go through dual-grant.** The caller needs `writer` on the target folder, and imported items inherit that folder's permissions. See [Authorization](./authorization.md#authorization-and-import).

If the service is started without connection configuration, all connection and import routes answer `503 CONNECTIONS_NOT_CONFIGURED`; the rest of the API is unaffected.

## Configuring Providers

Connections require a token-sealing key plus at least one provider. See [Operations](./operations.md#delegated-import-configuration) for the full variable list.

### Microsoft Graph

1. Register an application in Microsoft Entra ID with a **web** redirect URI that reaches the directory's callback route, for example `https://<your-directory-host>/v1/connections/callback`.
2. Grant it the **delegated** permissions matching your scopes. The default scope set is `openid profile Files.Read.All offline_access`. Depending on your tenant's policies, SharePoint site discovery (`/sites`) may additionally require a delegated permission such as `Sites.Read.All`; add it to both the app registration and `DIRECTORY_MSGRAPH_SCOPES`.
3. Configure the service:

| Variable | Example |
|----------|---------|
| `DIRECTORY_MSGRAPH_CLIENT_ID` | Application (client) id |
| `DIRECTORY_MSGRAPH_CLIENT_SECRET` | Client secret |
| `DIRECTORY_MSGRAPH_TENANT` | Directory (tenant) id |
| `DIRECTORY_MSGRAPH_AUTHORIZE_URL` | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize` |
| `DIRECTORY_MSGRAPH_TOKEN_URL` | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| `DIRECTORY_MSGRAPH_REDIRECT_URL` | The redirect URI registered in step 1 |

The scopes **must** include `openid` (the consenting account's identity comes from the OIDC subject) and `offline_access` (required for a durable refresh token). Graph is not enabled unless all of the above are present and both scopes are included.

### Box

1. Create a Box application using **user authentication (OAuth 2.0)** and set its redirect URI to the directory's callback route.
2. Give it **read-only** access to all files and folders (`root_readonly`).
3. Configure the service:

| Variable | Value |
|----------|-------|
| `DIRECTORY_BOX_CLIENT_ID` | Client id |
| `DIRECTORY_BOX_CLIENT_SECRET` | Client secret |
| `DIRECTORY_BOX_REDIRECT_URL` | The redirect URI registered in step 1 |

Authorize, token, and API URLs default to Box's public endpoints. `DIRECTORY_BOX_SCOPES` must be exactly `root_readonly`; any other value (for example `root_readwrite`) stops the service from starting when Box credentials are set.

## Step 1: Start a Connection

```bash
H=(-H "X-API-Key: $APP_KEY" -H "X-On-Behalf-Of: user=$ALICE" -H 'Content-Type: application/json')

curl -s -X POST $DIRECTORY_URL/v1/connections:start "${H[@]}" \
  -d '{"provider":"msgraph","displayName":"Contoso SharePoint","expectedSubject":"alice@contoso.example"}'
```

```json
{
  "connectionId": "a3f0c9d2-6b1e-4c7a-9e55-0d8f2b6a1c34",
  "authorizeUrl": "https://login.microsoftonline.com/.../authorize?client_id=...&state=...",
  "expiresAt": "2026-09-20T15:10:00Z"
}
```

| Field | Notes |
|-------|-------|
| `provider` | `msgraph` or `box` (required) |
| `displayName` | Optional label, up to 128 characters |
| `expectedSubject` | Optional **mistake guard**. If the person signs in with a different account, consent is refused with `409 SUBJECT_MISMATCH`. For Graph it is compared with the account's subject or login (UPN, preferred username, or email); for Box with the numeric user id or login. It is a convenience check, not an identity verification. |

## Step 2: The Person Consents

Send the person to `authorizeUrl` in a browser. The URL is valid for **10 minutes** and can be used **once**. After sign-in, the provider redirects to `GET /v1/connections/callback`, which completes the connection and responds with JSON:

```json
{"connectionId":"a3f0c9d2-...","status":"ok","providerLogin":"alice@contoso.example"}
```

If the callback hits a recoverable problem (the provider could not be reached, returned no identity, or returned no refresh token), the connection **stays pending** and the error response includes a fresh `authorizeUrl` to retry with. A replayed or expired `state` returns `400 INVALID_STATE`.

Check the result:

```bash
curl -s $DIRECTORY_URL/v1/connections/a3f0c9d2-6b1e-4c7a-9e55-0d8f2b6a1c34 "${H[@]}"
```

```json
{
  "id": "a3f0c9d2-6b1e-4c7a-9e55-0d8f2b6a1c34",
  "provider": "msgraph",
  "status": "ok",
  "displayName": "Contoso SharePoint",
  "scopes": ["openid", "profile", "Files.Read.All", "offline_access"],
  "providerSubject": "…",
  "providerTenant": "…",
  "providerLogin": "alice@contoso.example",
  "expectedSubject": "alice@contoso.example",
  "createdAt": "2026-09-20T15:00:00Z",
  "updatedAt": "2026-09-20T15:01:12Z"
}
```

No token material is ever returned. Once a connection has recorded an account (`providerSubject`), it cannot be completed again by a different account.

## Step 3: Browse the Source

### Microsoft Graph

```bash
C=$DIRECTORY_URL/v1/connections/a3f0c9d2-6b1e-4c7a-9e55-0d8f2b6a1c34

# 1. SharePoint sites (optional ?search=, default "*")
curl -s "$C/sites?search=finance" "${H[@]}" | jq '.sites[] | {id, displayName}'

# 2. Document libraries in a site
curl -s "$C/sites/<siteId>/drives" "${H[@]}" | jq '.drives[] | {id, name, driveType}'

# 3. Folder listing — itemId may be the literal "root"
curl -s "$C/drives/<driveId>/items/root/children" "${H[@]}"

# 4. One item's metadata
curl -s "$C/drives/<driveId>/items/<itemId>" "${H[@]}"
```

A listing returns normalized items and, when there are more, a `nextToken`. Pass it back unchanged as `?pageToken=`; the service only accepts page links issued by the configured provider.

```json
{
  "items": [
    {
      "ref": {"provider":"msgraph","driveId":"b!x...","itemId":"01ABC..."},
      "name": "Q3",
      "path": "/Reports/Q3",
      "isFolder": true,
      "childCount": 14,
      "etag": "\"{...},1\"",
      "lastModified": "2026-09-01T10:00:00Z",
      "webUrl": "https://contoso.sharepoint.com/..."
    }
  ],
  "nextToken": "https://graph.microsoft.com/v1.0/..."
}
```

Site discovery lists SharePoint sites. There is no "my OneDrive" shortcut in this release; a OneDrive library can be browsed by its drive id.

### Box

Box has no sites or libraries. Use the synthetic drive id **`0`** for every Box request; `root` or `0` addresses the top-level folder:

```bash
curl -s "$C/drives/0/items/root/children" "${H[@]}"
curl -s "$C/drives/0/items/123456789/children" "${H[@]}"          # a folder by id
curl -s "$C/drives/0/items/987654321?kind=file" "${H[@]}"         # one item
```

- Fetching a single non-root Box item requires `?kind=file` or `?kind=folder`, because Box exposes files and folders through different endpoints.
- `nextToken` for Box is an opaque marker; absolute URLs are rejected.
- `/sites` and `/sites/{siteId}/drives` return `400 PROVIDER_UNSUPPORTED` for Box connections.
- Box web links and trashed items are omitted from browse listings.

## Step 4: Start an Import

```bash
curl -s -X POST $DIRECTORY_URL/v1/imports "${H[@]}" -d '{
  "connectionId": "a3f0c9d2-6b1e-4c7a-9e55-0d8f2b6a1c34",
  "source": {"driveId": "b!x...", "itemId": "01ABC..."},
  "targetParentId": "3a9b..."
}'
```

For Box, use `"driveId": "0"` and set `"kind": "file"` or `"folder"` for non-root items.

Before creating anything, the service checks — in this order — that you own the connection, that you hold `writer` on the target folder (which must be a folder), that the connection is `ok`, that the source exists and is visible to the connection, and that the same source is not already imported under a different folder in this drive. Any failure creates no job.

On success it returns `202 Accepted` with the job:

```json
{
  "id": "7e2d4c1b-...",
  "state": "queued",
  "credentialKind": "delegated",
  "connectionId": "a3f0c9d2-...",
  "source": {"driveId": "b!x...", "itemId": "01ABC..."},
  "sourceKind": "folder",
  "targetParentId": "3a9b...",
  "driveId": "5b0c4a8e-...",
  "counts": {"queued":1,"importing":0,"imported":0,"unchanged":0,"failed":0,"unreachable":0,"skipped":0},
  "createdAt": "2026-09-20T15:05:00Z"
}
```

Importing a folder creates a folder of the same name under the target, containing the source subtree. Importing a file creates the file directly under the target.

## Step 5: Follow Progress

```bash
curl -s $DIRECTORY_URL/v1/imports/7e2d4c1b-... "${H[@]}" | jq '{state, counts}'
curl -s "$DIRECTORY_URL/v1/imports/7e2d4c1b-.../entries?state=failed" "${H[@]}" \
  | jq '.entries[] | {externalPath, state, reason, attempts}'
```

Progress is reported as counts per entry state, never as a percentage (the total is unknown until enumeration finishes). Job states, entry states, and reason codes are described in [Concepts](./concepts.md#import-jobs).

To stop a running job:

```bash
curl -s -X POST $DIRECTORY_URL/v1/imports/7e2d4c1b-...:cancel "${H[@]}"
```

Cancellation is final: remaining entries become `skipped` with reason `cancelled`, and a worker cannot publish an item after the cancellation commits. Cancelling a job that has already finished returns `409 CONFLICT`. Items already imported stay in the drive.

## Import Behavior and Limits

| Behavior | Value |
|----------|-------|
| Maximum file size | **256 MiB**. Larger files become `failed` / `too_large`; they are never truncated. |
| Delivery attempts per entry | 4 (1 + 3 retries), waiting 2 s, 8 s, then 30 s |
| Provider `Retry-After` | Honored, capped at 120 s |
| Download timeouts | 60 s to receive response headers; 10 min for the whole body |
| Enumeration page size | 200 children per request |
| Name rules | Source names the directory cannot accept (e.g. containing `/`) become `failed` / `invalid_name` |
| Name collisions | A different item with the same name already in the target folder → `failed` / `name_conflict` |
| Box web links, trashed items | `skipped` / `web_link` or `trashed` |
| Re-import | Same source, same connection, same drive: unchanged ETag → `unchanged`; changed → refreshed in place (`imported`, reason `updated`) |

Each imported item's `provenance` records `provider`, `connectionId`, `externalDriveId`, `externalItemId`, `externalPath`, `etag`, `webUrl`, `lastModified`, `importJobId`, and `importedAt`.

Downloads follow the provider's pre-authenticated download redirects, and the provider bearer token is never forwarded to a different origin.

## When Credentials Stop Working

| Situation | What you see | What to do |
|-----------|--------------|------------|
| The person revoked access, their password or policy changed, or the refresh token expired | Connection `status` becomes `auth_revoked`; browse/import return `AUTH_REVOKED` (`409`; `401` for Box resource calls); running jobs fail with reason `auth_revoked` | Start a new connection and have the person consent again |
| Consent not finished | `409 CONNECTION_NOT_READY` | Complete the consent flow |
| Provider throttling during browse | `429 THROTTLED` with `Retry-After` (at most 120) | Retry after the interval |
| Provider outage or network error | `502 SOURCE_UNREACHABLE`; running jobs pause and resume automatically | Retry later |
| The item is not visible to this account | `404 SOURCE_NOT_FOUND` (distinct from `404 NOT_FOUND`, which means the *connection* is not yours or does not exist) | Check the person's access in the source system |
| Access to the item is denied | `403 SOURCE_FORBIDDEN` | Check the person's access in the source system |

Refresh tokens are rotated by the providers on use. The service serializes refreshes per connection and saves the rotated token before using the new access token. If the service is interrupted in the narrow window between receiving a rotated token and saving it, that connection needs to be re-consented.

## Removing a Connection

```bash
curl -s -X DELETE $DIRECTORY_URL/v1/connections/a3f0c9d2-... "${H[@]}" -w '%{http_code}\n'
# 204
```

The connection is marked `revoked` and its stored tokens are erased. The service does not call the provider's revocation endpoint; to revoke the grant at the provider as well, remove the application from the account's connected apps in Microsoft 365 or Box. Items already imported remain in the drive.

## Related

- [Concepts](./concepts.md#delegated-connections) — connection and job lifecycles
- [Reference](./reference.md#connections) — full endpoint and error reference
- [Operations](./operations.md#delegated-import-configuration) — configuration and scaling import workers
