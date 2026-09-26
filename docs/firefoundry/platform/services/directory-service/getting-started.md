# Directory Service — Getting Started

This walkthrough creates a drive, gives a user access to it, uploads and shares a file, and lets a second user find it through entry points. Every step uses `curl` against the REST API.

## Prerequisites

- A running Directory Service with its database migrations applied (see [Operations](./operations.md#deployment))
- The service URL. Inside the cluster this is `http://<directory-service>.<namespace>.svc.cluster.local:8090`; from a workstation, port-forward the service or run it locally on port `8090`
- An API key configured in the service's `DIRECTORY_API_KEYS` variable. Each entry maps a key to an **application principal UUID** (`name:key:principal-uuid`)
- User principal UUIDs for the people you want to grant. In a FireFoundry environment these are the users' identity principal ids
- `curl` and `jq`

Set some shell variables for the rest of the guide:

```bash
export DIRECTORY_URL=http://localhost:8090
export APP_KEY='<your-api-key>'                       # from DIRECTORY_API_KEYS
export ALICE=11111111-1111-4111-8111-111111111111     # a user principal UUID
export BOB=22222222-2222-4222-8222-222222222222       # another user principal UUID
```

## Step 1: Check the Service

`/health` and `/ready` need no API key.

```bash
curl -s $DIRECTORY_URL/health
curl -s $DIRECTORY_URL/ready
```

```json
{"status":"healthy","version":"unknown"}
{"ready":true}
```

`version` reports the `BUILD_COMMIT` environment variable when it is set. `/ready` returns `503` with `{"ready":false,"error":"..."}` when PostgreSQL is unreachable.

## Step 2: Create a Drive

Drive creation is done by an application. The calling application becomes the drive's `owner`:

```bash
curl -s -X POST $DIRECTORY_URL/v1/drives \
  -H "X-API-Key: $APP_KEY" -H 'Content-Type: application/json' \
  -d '{"slug":"deal-docs","displayName":"Deal Documents"}' | tee drive.json
```

```json
{
  "id": "5b0c4a8e-3f51-4a3e-9d0e-6a2f1c7e9b10",
  "orgScope": "default",
  "slug": "deal-docs",
  "displayName": "Deal Documents",
  "kind": "shared",
  "rootItemId": "0e6d0b7a-8f3c-4b8e-a1b2-2c3d4e5f6a7b",
  "ownerPrincipalId": "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
  "createdAt": "2026-09-20T14:02:11.482Z"
}
```

```bash
export DRIVE_ID=$(jq -r .id drive.json)
export ROOT_ID=$(jq -r .rootItemId drive.json)
```

`orgScope` defaults to `default` and `kind` to `shared`. Slugs must be unique within an `orgScope`; a duplicate returns `409 CONFLICT`.

## Step 3: Grant a User on the Drive Root

At this point only the application holds a grant. Requests that assert a user will be refused until that user has a grant too. Calling **without** `X-On-Behalf-Of` authorizes on the application alone, which is how the owner application bootstraps access:

```bash
curl -s -X PUT $DIRECTORY_URL/v1/items/$ROOT_ID/permissions \
  -H "X-API-Key: $APP_KEY" -H 'Content-Type: application/json' \
  -d "{\"principalId\":\"$ALICE\",\"principalKind\":\"user\",\"role\":\"owner\"}"
```

```json
{
  "id": "c7a1...",
  "driveId": "5b0c4a8e-3f51-4a3e-9d0e-6a2f1c7e9b10",
  "itemId": "0e6d0b7a-8f3c-4b8e-a1b2-2c3d4e5f6a7b",
  "principalId": "11111111-1111-4111-8111-111111111111",
  "principalKind": "user",
  "role": "owner",
  "createdAt": "2026-09-20T14:02:30.101Z"
}
```

From now on, requests made on Alice's behalf carry `X-On-Behalf-Of: user=<uuid>`:

```bash
alice() { curl -s -H "X-API-Key: $APP_KEY" -H "X-On-Behalf-Of: user=$ALICE" "$@"; }
bob()   { curl -s -H "X-API-Key: $APP_KEY" -H "X-On-Behalf-Of: user=$BOB" "$@"; }
```

> Always include the `user=` prefix. A bare UUID in `X-On-Behalf-Of` is not recognized as a user, and the request is then authorized as the application alone. See [Authorization](./authorization.md#who-is-calling).

## Step 4: Create Folders

```bash
alice -X POST $DIRECTORY_URL/v1/folders -H 'Content-Type: application/json' \
  -d "{\"parentId\":\"$ROOT_ID\",\"name\":\"reports\"}" | tee reports.json
export REPORTS_ID=$(jq -r .id reports.json)

alice -X POST $DIRECTORY_URL/v1/folders -H 'Content-Type: application/json' \
  -d "{\"parentId\":\"$ROOT_ID\",\"name\":\"drafts\"}"
```

```json
{
  "id": "3a9b...",
  "orgScope": "default",
  "driveId": "5b0c4a8e-3f51-4a3e-9d0e-6a2f1c7e9b10",
  "parentId": "0e6d0b7a-8f3c-4b8e-a1b2-2c3d4e5f6a7b",
  "kind": "folder",
  "name": "reports",
  "path": "/reports",
  "aclAnchorId": "0e6d0b7a-8f3c-4b8e-a1b2-2c3d4e5f6a7b",
  "etag": "4f2d...",
  "origin": "created",
  "createdByPrincipalId": "11111111-1111-4111-8111-111111111111",
  "createdAt": "2026-09-20T14:03:02.550Z",
  "updatedAt": "2026-09-20T14:03:02.550Z"
}
```

Note `aclAnchorId`: the new folder inherits the root's anchor. `createdByPrincipalId` records the user when one is asserted.

## Step 5: Upload a File

Uploads take the **raw request body** as content; the parent and name go in the query string, and `Content-Type` becomes the item's MIME type:

```bash
alice -X POST "$DIRECTORY_URL/v1/items:upload?parentId=$REPORTS_ID&name=q3-summary.pdf" \
  -H 'Content-Type: application/pdf' --data-binary @q3-summary.pdf | tee file.json
export FILE_ID=$(jq -r .id file.json)
```

```json
{
  "id": "e41c...",
  "driveId": "5b0c4a8e-3f51-4a3e-9d0e-6a2f1c7e9b10",
  "parentId": "3a9b...",
  "kind": "file",
  "name": "q3-summary.pdf",
  "path": "/reports/q3-summary.pdf",
  "aclAnchorId": "0e6d0b7a-8f3c-4b8e-a1b2-2c3d4e5f6a7b",
  "blobKey": "directory/5b0c4a8e-3f51-4a3e-9d0e-6a2f1c7e9b10/9c1e...",
  "mimeType": "application/pdf",
  "sizeBytes": 482113,
  "checksumSha256": "9c1e...",
  "etag": "b7d0...",
  "origin": "created",
  ...
}
```

The blob key is content-addressed (`directory/<driveId>/<sha256>`). Keep uploads under 256 MiB — see [Reference](./reference.md#post-v1itemsupload).

### Alternative: register existing content

If the bytes already exist — a blob in the service's storage container or a Context Service working memory — register them instead of uploading. Nothing is copied:

```bash
alice -X POST $DIRECTORY_URL/v1/items:promote -H 'Content-Type: application/json' -d '{
  "parentId": "'$REPORTS_ID'",
  "name": "credit-memo.docx",
  "workingMemoryId": "6d5c4b3a-2918-4f7e-8d6c-5b4a39281706",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "metadata": {"source": "credit-review"}
}'
```

Exactly one of `blobKey` or `workingMemoryId` is required.

## Step 6: Browse and Read

```bash
# List a folder (folders first, then by name)
alice "$DIRECTORY_URL/v1/items/$REPORTS_ID/children?limit=50" | jq '.items[] | {name, kind}'

# Resolve by path
alice "$DIRECTORY_URL/v1/items:by-path?driveId=$DRIVE_ID&path=/reports/q3-summary.pdf" | jq .id

# Download content
alice "$DIRECTORY_URL/v1/items/$FILE_ID/content" -o q3-copy.pdf
```

The children response includes `nextAfter` when items were returned; pass it back as `?after=` to fetch the next page.

## Step 7: Share a Folder With Another User

Visibility is decided by an item's **own anchor**. The first grant on `/reports` turns it into an anchor, and from then on only principals granted on `/reports` can see into it — Alice's grant on the root no longer covers it. So give Alice a grant on `/reports` **first**, while she can still reach it through the root:

```bash
alice -X PUT $DIRECTORY_URL/v1/items/$REPORTS_ID/permissions -H 'Content-Type: application/json' \
  -d "{\"principalId\":\"$ALICE\",\"principalKind\":\"user\",\"role\":\"owner\"}"
```

Now, as the owner of the `/reports` anchor, Alice gives Bob `reader` there:

```bash
alice -X PUT $DIRECTORY_URL/v1/items/$REPORTS_ID/permissions -H 'Content-Type: application/json' \
  -d "{\"principalId\":\"$BOB\",\"principalKind\":\"user\",\"role\":\"reader\"}"

alice $DIRECTORY_URL/v1/items/$REPORTS_ID/permissions | jq '.grants[] | {principalId, role}'
```

If you ever lock a user out of a subfolder this way, the owner application can repair it by making the grant call **without** `X-On-Behalf-Of`. See [Authorization](./authorization.md#anchors-and-inheritance).

## Step 8: Let Bob Find His Starting Point

Bob cannot list the drive root — he holds no grant there — so he asks for his entry points:

```bash
bob $DIRECTORY_URL/v1/drives/$DRIVE_ID/entry-points | jq '.entryPoints[] | {id, path}'
```

```json
{ "id": "3a9b...", "path": "/reports" }
```

From there he can list children and read content as usual. Asking for the root returns `404`:

```bash
bob "$DIRECTORY_URL/v1/items/$ROOT_ID/children"
# {"code":"NOT_FOUND","message":"not found"}
```

## Step 9: Rename With Optimistic Concurrency

```bash
ETAG=$(alice -D - -o /dev/null $DIRECTORY_URL/v1/items/$FILE_ID | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')

alice -X PATCH $DIRECTORY_URL/v1/items/$FILE_ID -H "If-Match: $ETAG" \
  -H 'Content-Type: application/json' -d '{"name":"q3-summary-final.pdf"}'
```

If someone else modified the item since you read it, the ETag no longer matches and the service returns `412 PRECONDITION_FAILED`. `If-Match` is optional; without it the rename is unconditional.

## Step 10: Trash an Item

```bash
alice -X DELETE $DIRECTORY_URL/v1/items/$FILE_ID -w '%{http_code}\n'
# 204
```

Trashing removes the item (and, for a folder, its subtree) from the namespace and frees its name. The content blob is **not** deleted. The drive root cannot be trashed.

## Next Steps

- **[Authorization](./authorization.md)** — the dual-grant model in depth
- **[Integrations](./integrations.md)** — connect Microsoft 365 or Box and import documents
- **[Reference](./reference.md)** — all endpoints, fields, and error codes
- **[Operations](./operations.md)** — configuration and deployment
