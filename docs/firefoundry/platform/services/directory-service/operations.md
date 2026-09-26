# Directory Service — Operations

What an app team needs to use the Directory Service in an environment: checking availability, the configuration you supply, verifying access from your app, limits to design around, and troubleshooting.

## Availability in Your Environment

The Directory Service is in **Preview** and is **not yet part of the standard FireFoundry Helm charts**, so it is not enabled by a chart toggle. Whether it is available in a given environment, and at what URL, is decided by your environment administrator. Ask them for:

- the **directory URL** reachable from your agent bundles and app backend (in-cluster, typically `http://<directory-service>.<namespace>.svc.cluster.local:8090`);
- an **API key for each application or agent bundle** that will call the directory, and the application principal UUID each key represents (you need the principal UUID to admit one application to another's drive);
- whether **Microsoft 365** and/or **Box** connections are enabled.

## Configuration Your App Supplies

### Application identity

Each application or agent bundle that calls the directory needs its own API key, issued by your environment administrator and mapped to that application's principal. Use separate keys per application so drive grants can keep them apart. Treat the key as a server-side secret — whoever holds it can act as your application and assert any user.

### User principals

Grants and `X-On-Behalf-Of` use user principal UUIDs. Use your users' FireFoundry identity principal ids (see [Identity Management Service](../identity-service/README.md)) so grants stay meaningful across applications.

### Microsoft 365 and Box app registration

Delegated import needs an OAuth application registered with the provider. Your organization registers it and hands the details to your environment administrator, who configures them on the directory. Until this is done, connection and import routes answer `503 CONNECTIONS_NOT_CONFIGURED`; the rest of the directory works normally.

**Microsoft 365 (Microsoft Entra ID)**

1. Register an application in Microsoft Entra ID with a **Web** redirect URI pointing at the directory's callback route, e.g. `https://<your-directory-host>/v1/connections/callback`. This URL must be reachable from users' browsers.
2. Grant it **delegated** permissions: `openid`, `profile`, `offline_access`, and `Files.Read.All`. If users will discover SharePoint sites, your tenant may also require `Sites.Read.All`. An admin may need to grant tenant-wide consent, depending on your tenant's policies.
3. Provide the application (client) id, a client secret, the tenant id, the redirect URI, and any additional scopes to your environment administrator.

**Box** (early access)

1. Create a Box application using **user authentication (OAuth 2.0)** with its redirect URI set to the directory's callback route.
2. Give it **read-only** access to all files and folders (`root_readonly`) — the directory only accepts read-only Box access.
3. Provide the client id, client secret, and redirect URI to your environment administrator.

## Verifying From Your App

1. **Reachability** — `GET /health` and `GET /ready` need no API key and should return `200` from your bundle's network.
2. **API key** — `GET /v1/drives` with your `X-API-Key` should return `200` (an empty list is fine). `401 UNAUTHENTICATED` means the key is not recognized.
3. **Drive access** — create a test drive, grant a test user, and read it back as that user (see [Getting Started](./getting-started.md)).
4. **Connections** (if needed) — `POST /v1/connections:start` as a test user should return an `authorizeUrl`; `503 CONNECTIONS_NOT_CONFIGURED` means the provider is not configured.

## Limits and Behavior to Design Around

| Area | Behavior |
|------|----------|
| Upload size | 256 MiB per `items:upload`. Larger bodies are not rejected, but only the first 256 MiB is stored — check `sizeBytes`. |
| Import file size | 256 MiB per file; larger files end `failed` / `too_large` |
| JSON request bodies | 1 MiB |
| Listings | Up to 500 items per page (default 200) |
| Names | 255 characters; no `/` or `\`; not `.` or `..`; unique per folder, case-insensitive |
| Consent URL | Valid for 10 minutes, single use |
| Browse throttling | `429 THROTTLED` with `Retry-After` (at most 120 s) |
| Not yet available | Move, grant removal, trash restore/purge, search, change notifications, continuous sync, write-back |

## Security Notes for App Builders

- **Keep API keys server-side.** Never ship a directory API key to a browser or mobile client; call the directory from your backend or agent bundle.
- **Only assert users you have authenticated**, and always as `X-On-Behalf-Of: user=<uuid>`.
- **Keep application grants narrow.** An application's drive grant bounds what a leaked key could reach, and app-only requests see the whole drive.
- **Provider tokens never reach your app.** Deleting a connection erases its stored credential.
- **Content is never deleted by the directory.** If your app deletes content it promoted, trash the directory item too.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Connection refused / timeout | Wrong URL, or the service is not available in this environment | Confirm the directory URL with your environment administrator |
| `401 UNAUTHENTICATED` | Missing or unrecognized `X-API-Key` | Check the key your app is using |
| `403 FORBIDDEN` on a drive | Your application has no grant on the drive root, or the user has no grant in the drive | Have the drive owner grant your application on the root; grant the user on a folder |
| `404` for an item that exists | The caller fails dual-grant, or the user's grants are on a different folder | Check grants with `GET /v1/items/{id}/permissions`; see [Authorization](./authorization.md#inheritance) |
| User lost access to a subfolder after sharing it | The first grant on a subfolder gives it its own permission list | Grant the user on that subfolder too (app-only if needed) |
| Requests behave as the application, ignoring the user | `X-On-Behalf-Of` sent as a bare UUID | Send `user=<uuid>` |
| `400` on a connection or import route | No `X-On-Behalf-Of: user=` header | Connections and imports always need a user |
| `400` from `GET /v1/items/{id}/content` | The item is a folder or references a working memory | Fetch working-memory content from the Context Service |
| `503 CONNECTIONS_NOT_CONFIGURED` | Microsoft 365 / Box not configured in this environment | See [app registration](#microsoft-365-and-box-app-registration) |
| Consent fails with `502 SOURCE_IDENTITY_UNAVAILABLE` or `502 SOURCE_UNREACHABLE` | Provider registration is missing `openid` or `offline_access`, or the client secret is wrong or expired | Check the app registration; the error response includes a fresh `authorizeUrl` to retry |
| `409 SUBJECT_MISMATCH` | The person signed in with a different account than `expectedSubject` | Sign in with the expected account |
| `409 AUTH_REVOKED` | Provider rejected the stored credential | Delete the connection and reconnect |
| `409 DUPLICATE_SOURCE` | That source is already imported under another folder of the drive | Re-import into the original folder |
| Import entries `failed` / `name_conflict` | A different item with that name exists in the target folder | Rename or trash it, then re-import |
| Import entries `failed` / `too_large` | Source file over 256 MiB | Not supported in this release |
| Import jobs stay `queued` for a long time | Imports are not running in this environment | Contact your environment administrator |
| `412 PRECONDITION_FAILED` on rename | Item changed since you read it | Re-read the item and retry with the new ETag |
