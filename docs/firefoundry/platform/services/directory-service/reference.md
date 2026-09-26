# Directory Service — Reference

Reference for the Directory Service REST API and error codes. There is no client library yet; call the REST API directly.

## Conventions

- **Base URL**: the directory URL for your environment (see [Operations](./operations.md#availability-in-your-environment)).
- **Content type**: JSON request and response bodies, except `items:upload` (raw body) and `items/{id}/content` (raw bytes). JSON request bodies are limited to 1 MiB.
- **IDs**: drives, items, grants, connections, and import jobs are UUIDs. Import entries use integer ids.
- **Timestamps**: RFC 3339.
- **Authentication**: every `/v1` route except the OAuth callback requires `X-API-Key`.

### Request headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes (all `/v1` routes except `/v1/connections/callback`) | Your application's API key |
| `X-On-Behalf-Of` | Catalog: optional. Connections and imports: required | `user=<uuid>` (full grammar `app=<id>; bundle=<id>; user=<id>`). Only `user=` is read. A non-UUID `user=` value returns `400`. |
| `If-Match` | Optional on `PATCH /v1/items/{id}` | ETag from a previous read; mismatch returns `412` |
| `Content-Type` | On `items:upload` | Stored as the item's MIME type (default `application/octet-stream`) |

### Error envelope

```json
{"code": "NOT_FOUND", "message": "not found"}
```

## Endpoint Summary

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness (unauthenticated) |
| `GET` | `/ready` | Readiness (unauthenticated) |
| `POST` | `/v1/drives` | Create a drive; the calling application becomes owner |
| `GET` | `/v1/drives` | List drives the calling application can reach |
| `GET` | `/v1/drives/{id}` | Get a drive |
| `GET` | `/v1/drives/{id}/entry-points` | Where this caller can start browsing |
| `POST` | `/v1/folders` | Create a folder |
| `POST` | `/v1/items:promote` | Register an existing blob or working memory |
| `POST` | `/v1/items:upload` | Upload content |
| `GET` | `/v1/items:by-path` | Resolve an item by path |
| `GET` | `/v1/items/{id}` | Get an item |
| `GET` | `/v1/items/{id}/children` | List a folder's children |
| `GET` | `/v1/items/{id}/content` | Stream a file's content |
| `PATCH` | `/v1/items/{id}` | Rename |
| `DELETE` | `/v1/items/{id}` | Trash an item and its subtree |
| `GET` | `/v1/items/{id}/permissions` | List grants on an item |
| `PUT` | `/v1/items/{id}/permissions` | Add or update a grant |
| `POST` | `/v1/connections:start` | Begin OAuth consent |
| `GET` | `/v1/connections/callback` | OAuth redirect target (unauthenticated) |
| `GET` | `/v1/connections` | List this caller's connections |
| `GET` | `/v1/connections/{id}` | Get a connection |
| `DELETE` | `/v1/connections/{id}` | Revoke a connection and erase its tokens |
| `GET` | `/v1/connections/{id}/sites` | Browse SharePoint sites (Graph only) |
| `GET` | `/v1/connections/{id}/sites/{siteId}/drives` | Browse a site's document libraries (Graph only) |
| `GET` | `/v1/connections/{id}/drives/{driveId}/items/{itemId}/children` | Browse a source folder |
| `GET` | `/v1/connections/{id}/drives/{driveId}/items/{itemId}` | Get one source item's metadata |
| `POST` | `/v1/imports` | Start an import job |
| `GET` | `/v1/imports` | List this caller's import jobs |
| `GET` | `/v1/imports/{id}` | Get a job with counts by state |
| `GET` | `/v1/imports/{id}/entries` | List a job's entries |
| `POST` | `/v1/imports/{id}:cancel` | Cancel a job |

## Health

### `GET /health`

Always `200` while the process is serving:

```json
{"status": "healthy", "version": "<build>"}
```

### `GET /ready`

`200 {"ready": true}` when the service can serve requests; otherwise `503 {"ready": false, "error": "..."}`.

## Drives

### Drive object

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Drive id |
| `orgScope` | string | Scope; slugs are unique per scope |
| `slug` | string | Unique short name |
| `displayName` | string | Optional |
| `kind` | string | `shared`, `app`, or `user` |
| `rootItemId` | uuid | Root folder item |
| `ownerPrincipalId` | uuid | Creating application |
| `createdAt` | timestamp | |

### `POST /v1/drives`

| Body field | Required | Default | Notes |
|------------|----------|---------|-------|
| `slug` | Yes | | Non-blank |
| `orgScope` | No | `default` | |
| `displayName` | No | | |
| `kind` | No | `shared` | `shared`, `app`, or `user` |

**`201`** — the drive. **`409 CONFLICT`** if the slug exists in the scope.

### `GET /v1/drives?orgScope=<scope>`

Drives in `orgScope` (default `default`) on whose root the calling application holds any grant, ordered by slug. **`200`** — `{"drives": [Drive, ...]}`.

### `GET /v1/drives/{id}`

Requires `reader`. **`200`** — the drive. **`403 FORBIDDEN`** if the dual-grant check fails; **`404`** if the drive does not exist.

### `GET /v1/drives/{id}/entry-points`

Requires `reader`. **`200`** — `{"entryPoints": [Item, ...]}`, sorted by path: the items on which the asserted user holds grants, or the drive root when no user is asserted.

## Items

### Item object

| Field | Type | Description |
|-------|------|-------------|
| `id`, `driveId` | uuid | |
| `orgScope` | string | Copied from the drive |
| `parentId` | uuid | Absent on the drive root |
| `kind` | string | `folder` or `file` |
| `name` | string | Unique per folder (case-insensitive) among live items |
| `path` | string | Full path, e.g. `/reports/q3.pdf`; the root is `/` |
| `aclAnchorId` | uuid | The item whose grants govern this one (see [Inheritance](./authorization.md#inheritance)) |
| `blobKey` | string | Blob content pointer (files) |
| `workingMemoryId` | uuid | Working-memory content pointer (files) |
| `mimeType`, `sizeBytes`, `checksumSha256` | | Content metadata |
| `etag` | string | Changes on every modification |
| `metadata` | object | Caller-supplied (promote) |
| `origin` | string | `created`, `promoted`, `imported`, `derived` |
| `provenance` | object | Source details for imported items |
| `createdByPrincipalId` | uuid | The asserted user, else the application |
| `createdAt`, `updatedAt` | timestamp | |

**Name rules**: non-blank, no `/` or `\`, not `.` or `..`, at most 255 characters. Violations return `400 INVALID_INPUT`. A live sibling with the same name (case-insensitive) returns `409 CONFLICT`.

### `POST /v1/folders`

Requires `writer` on the parent. Body: `{"parentId": "<uuid>", "name": "<name>"}`. **`201`** — the folder.

### `POST /v1/items:promote`

Requires `writer` on the parent. Registers existing content without copying it.

| Body field | Required | Notes |
|------------|----------|-------|
| `parentId` | Yes | Folder uuid |
| `name` | Yes | |
| `blobKey` | One of | Must already exist in the directory's blob store, else `400` |
| `workingMemoryId` | One of | A working-memory uuid. The directory does not check that it exists — pass a valid id. |
| `mimeType` | No | |
| `sizeBytes` | No | |
| `metadata` | No | JSON object |

Exactly one of `blobKey` and `workingMemoryId` is required. **`201`** — the item, `origin: "promoted"`.

### `POST /v1/items:upload`

Requires `writer` on the parent. Query: `parentId` (uuid, required), `name` (required). Body: the raw file bytes. `Content-Type` becomes the item's MIME type.

**`201`** — the item (`origin: "created"`, `checksumSha256` and `sizeBytes` set).

> **Size limit: 256 MiB.** Larger request bodies are not rejected, but only the first 256 MiB is stored. Keep uploads at or below 256 MiB and compare the returned `sizeBytes` with what you sent. For large documents already in storage, use `items:promote`; for documents in Microsoft 365 or Box, use an import.

### `GET /v1/items:by-path?driveId=<uuid>&path=<path>`

Requires `reader`. **`200`** — the item. Paths are drive-relative, e.g. `/reports/q3.pdf`.

### `GET /v1/items/{id}`

Requires `reader`. **`200`** — the item, with an `ETag` response header.

### `GET /v1/items/{id}/children`

Requires `reader` on the folder. Returns only children the caller can see.

| Query | Default | Notes |
|-------|---------|-------|
| `limit` | `200` | 1–500; out-of-range values fall back to 200 |
| `after` | | Keyset cursor: the `nextAfter` value from the previous page |

**`200`**:

```json
{"items": [Item, ...], "nextAfter": "<name of last item>"}
```

Results are ordered folders first, then by name. `nextAfter` is present whenever the page is non-empty; an empty `items` array means you have reached the end.

> **Paging tip.** In folders with many subfolders, a page boundary that falls among the subfolders can cause some files to be missed on the next page. Request a `limit` large enough to cover all subfolders in one page (up to 500).

### `GET /v1/items/{id}/content`

Requires `reader`. Streams a blob-backed file with `Content-Type` (the item's MIME type), `ETag`, and `Content-Disposition: inline; filename="<name>"`. **`400`** for a folder or for an item that references a working memory.

### `PATCH /v1/items/{id}`

Requires `writer`. Body: `{"name": "<new name>"}`. Optional `If-Match` header (quotes are optional). Renaming a folder rewrites its subtree's paths. **`200`** — the item, with a new `ETag`. **`412 PRECONDITION_FAILED`** on ETag mismatch; **`409`** on name collision. Moving to another folder is not supported.

### `DELETE /v1/items/{id}`

Requires `writer`. Soft-deletes the item and its subtree; content is not deleted. **`204`**. **`400`** for a drive root.

## Permissions

### Grant object

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | |
| `driveId`, `itemId` | uuid | `itemId` is the item the grant is attached to |
| `principalId` | uuid | |
| `principalKind` | string | `user` or `app` |
| `role` | string | `reader`, `writer`, `owner` |
| `createdAt` | timestamp | |

### `GET /v1/items/{id}/permissions`

Requires `reader`. **`200`** — `{"grants": [Grant, ...]}`: the grants attached directly to this item (not inherited ones).

### `PUT /v1/items/{id}/permissions`

Requires `owner`. Body:

```json
{"principalId": "<uuid>", "principalKind": "user", "role": "reader"}
```

**`200`** — the grant. Re-granting the same principal updates its role. Errors: `400` for an unknown role or kind, or an `app` grant on a non-root item; `409` if the principal already holds a grant on the item under the other kind. See [Authorization](./authorization.md#granting).

There is no endpoint to remove a grant.

## Connections

All connection routes require `X-On-Behalf-Of: user=<uuid>` and only ever show connections owned by the same application **and** user. When connections are not configured they return `503 CONNECTIONS_NOT_CONFIGURED`.

### Connection object

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | |
| `provider` | string | `msgraph` or `box` |
| `status` | string | `pending`, `ok`, `auth_revoked`, `revoked` |
| `displayName` | string | |
| `scopes` | string[] | Granted scopes |
| `providerSubject` | string | Stable account id at the provider |
| `providerTenant` | string | Tenant id (Graph) or enterprise id (Box) |
| `providerLogin` | string | Display login (UPN/email); informational |
| `expectedSubject` | string | The caller's mistake-guard value, if set |
| `lastError` | string | Why the connection became `auth_revoked` |
| `createdAt`, `updatedAt` | timestamp | |

### `POST /v1/connections:start`

Body: `{"provider": "msgraph" | "box", "displayName"?: string (≤128), "expectedSubject"?: string}`.

**`201`** — `{"connectionId", "authorizeUrl", "expiresAt"}`. The URL embeds a single-use state valid for 10 minutes. **`503`** if the requested provider is not configured.

### `GET /v1/connections/callback?code=...&state=...`

The OAuth redirect target the provider sends the person's browser to; no API key. Your app does not call it directly. Each `state` can be used once.

| Status | Code | Meaning |
|--------|------|---------|
| `200` | | `{"connectionId", "status": "ok", "providerLogin"?}` |
| `400` | `INVALID_STATE` | Missing, unknown, expired, or already-used state |
| `400` | `INVALID_INPUT` | Missing `code` |
| `409` | `SUBJECT_MISMATCH` | A different account consented than expected or than previously recorded |
| `502` | `SOURCE_UNREACHABLE` | Token exchange failed or no refresh token returned — retryable |
| `502` | `SOURCE_IDENTITY_UNAVAILABLE` | The provider returned no account identity — retryable |
| `503` | `CONNECTIONS_NOT_CONFIGURED` | Provider not configured in this environment |

Retryable responses keep the connection `pending` and include `connectionId` and a fresh `authorizeUrl`.

### `GET /v1/connections?status=<status>`

**`200`** — `{"connections": [Connection, ...]}`. `status` optionally filters by `pending`, `ok`, `auth_revoked`, or `revoked`.

### `GET /v1/connections/{id}`

**`200`** — the connection. Never contains token material.

### `DELETE /v1/connections/{id}`

Sets `status` to `revoked` and erases the stored credential. **`204`**. Does not revoke consent at the provider.

### Browse routes

Require an owned connection with `status: ok`; otherwise `409 CONNECTION_NOT_READY` (pending) or `409 AUTH_REVOKED`.

| Route | Query | Response |
|-------|-------|----------|
| `GET /v1/connections/{id}/sites` | `search` (default `*`) | `{"sites": [{"id","name","displayName","webUrl"}]}` |
| `GET /v1/connections/{id}/sites/{siteId}/drives` | | `{"drives": [{"id","name","driveType","webUrl"}]}` |
| `GET /v1/connections/{id}/drives/{driveId}/items/{itemId}/children` | `pageToken` | `{"items": [SourceItem], "nextToken"?}` |
| `GET /v1/connections/{id}/drives/{driveId}/items/{itemId}` | `kind` (`file`/`folder`; required for non-root Box items) | `SourceItem` |

`itemId` may be `root`. For Box, `driveId` must be `0`. `sites` routes return `400 PROVIDER_UNSUPPORTED` for Box.

**SourceItem**: `ref {provider, driveId, itemId, kind?}`, `name`, `path`, `isFolder`, `size`, `mimeType`, `etag`, `contentHash` (Box SHA-1), `lastModified`, `webUrl`, `childCount`.

## Imports

All import routes require `X-On-Behalf-Of: user=<uuid>`. A job is visible only to its owning application and user **and** only while they hold `reader` on the target folder; otherwise `404`.

### Job object

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | |
| `state` | string | `queued`, `enumerating`, `fetching`, `completed`, `completed_with_errors`, `failed`, `cancelled` |
| `credentialKind` | string | Always `delegated` |
| `connectionId` | uuid | |
| `source` | object | `{driveId, itemId}` |
| `sourceKind` | string | `file` or `folder` |
| `targetParentId`, `driveId` | uuid | |
| `counts` | object | A count for every entry state (always all seven keys) |
| `reason` | string | Terminal reason, e.g. `auth_revoked`, `cancelled` |
| `createdAt`, `startedAt`, `finishedAt` | timestamp | |

### `POST /v1/imports`

```json
{
  "connectionId": "<uuid>",
  "source": {"driveId": "<provider drive id>", "itemId": "<provider item id>", "kind": "file|folder"},
  "targetParentId": "<folder item uuid>"
}
```

`source.kind` is optional for Graph and required for non-root Box items. **`202`** — the job. Errors, in evaluation order: `404` (connection not owned), `404` (target not reachable with `writer`), `400` (target is not a folder), `409 CONNECTION_NOT_READY` / `409 AUTH_REVOKED`, source errors (see below), `409 DUPLICATE_SOURCE`.

### `GET /v1/imports?state=<state>&connectionId=<uuid>`

**`200`** — `{"jobs": [Job, ...]}`. A `connectionId` you do not own returns `404`. Jobs whose target folder you can no longer read are omitted.

### `GET /v1/imports/{id}`

**`200`** — the job.

### `GET /v1/imports/{id}/entries?state=<state>&after=<id>&limit=<n>`

`limit` 1–500 (default 200); `after` is the previous page's `nextAfter`. **`200`**:

```json
{"entries": [Entry, ...], "nextAfter": "<last entry id>"}
```

**Entry**: `id` (integer), `externalRef {driveId, itemId}`, `externalPath`, `name`, `kind`, `state`, `reason`, `attempts`, `itemId` (the directory item, once written), `etag`, `sizeBytes`, `updatedAt`.

Entry states: `queued`, `importing`, `imported`, `unchanged`, `failed`, `unreachable`, `skipped`. Reason tokens are listed in [Concepts](./concepts.md#entry-states).

### `POST /v1/imports/{id}:cancel`

**`202`** — the job, now `cancelled`. **`409 CONFLICT`** if it had already finished.

## Error Codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `INVALID_INPUT` | Malformed body, bad UUID, invalid name/role/kind, missing required user, invalid source reference or page token |
| 400 | `INVALID_STATE` | OAuth callback state unknown, expired, or reused |
| 400 | `PROVIDER_UNSUPPORTED` | Route not supported by the connection's provider |
| 401 | `UNAUTHENTICATED` | Missing or unrecognized `X-API-Key` |
| 401 | `AUTH_REVOKED` | Box rejected the connection's credential on a resource call |
| 403 | `FORBIDDEN` | Drive-level dual-grant failure on drive routes |
| 403 | `SOURCE_FORBIDDEN` | The provider denied access to the source item |
| 404 | `NOT_FOUND` | Unknown or unreachable item, drive, connection, or job (never distinguishes the two) |
| 404 | `SOURCE_NOT_FOUND` | Source item missing or invisible to the connection's account |
| 409 | `CONFLICT` | Duplicate slug or name, principal-kind conflict, job already finished |
| 409 | `CONNECTION_NOT_READY` | Connection still `pending` |
| 409 | `AUTH_REVOKED` | Connection `auth_revoked` or `revoked`, or Graph rejected the credential |
| 409 | `SUBJECT_MISMATCH` | Consent completed by an unexpected account |
| 409 | `DUPLICATE_SOURCE` | Source already imported under another folder in the drive |
| 412 | `PRECONDITION_FAILED` | `If-Match` did not match |
| 429 | `THROTTLED` | Provider throttling during browse; `Retry-After` header (≤ 120 s) |
| 500 | `INTERNAL` | Unexpected error |
| 502 | `SOURCE_UNREACHABLE` | Provider or token endpoint unreachable — retryable |
| 502 | `SOURCE_IDENTITY_UNAVAILABLE` | Provider returned no consenting identity |
| 503 | `CONNECTIONS_NOT_CONFIGURED` | Microsoft 365 / Box connections, or the requested provider, not configured in this environment |
