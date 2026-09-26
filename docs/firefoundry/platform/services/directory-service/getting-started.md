# Directory Service — Getting Started

This walkthrough creates a drive, gives a user access to it, uploads and shares a file, and lets a second user find it through entry points. Every step uses `curl` against the REST API; in an agent bundle or app backend you make the same HTTP calls with your HTTP client of choice.

## Prerequisites

- The Directory Service available in your environment, and its URL (see [Operations](./operations.md#availability-in-your-environment))
- An **API key for your application**, issued by your environment administrator. The key identifies your application's principal in the directory.
- User principal UUIDs for the people you want to grant — in a FireFoundry environment, their identity principal ids
- `curl` and `jq`

```bash
export DIRECTORY_URL=http://localhost:8090                # or your environment's directory URL
export APP_KEY='<your-api-key>'
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
{"status":"healthy","version":"<build>"}
{"ready":true}
```

`/ready` returns `503` with `{"ready":false,...}` when the service cannot serve requests yet.

## Step 2: Create a Drive

A drive is created by your application (no user asserted). Your application becomes the drive's `owner`:

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

> Always include the `user=` prefix. A bare UUID in `X-On-Behalf-Of` is not recognized as a user, and the request is then authorized as the application alone. See [Authorization](./authorization.md#acting-on-behalf-of-a-user).

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

Note `aclAnchorId`: the new folder inherits the root's permissions. `createdByPrincipalId` records the user when one is asserted.

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
  "blobKey": "…",
  "mimeType": "application/pdf",
  "sizeBytes": 482113,
  "checksumSha256": "9c1e...",
  "etag": "b7d0...",
  "origin": "created",
  ...
}
```

Keep uploads at or below 256 MiB — see [Reference](./reference.md#post-v1itemsupload). For large files already in storage, promote them instead.

### Alternative: register existing content

If the content already exists — typically a Context Service working memory your agent bundle produced — register it instead of uploading. Nothing is copied:

```bash
alice -X POST $DIRECTORY_URL/v1/items:promote -H 'Content-Type: application/json' -d '{
  "parentId": "'$REPORTS_ID'",
  "name": "credit-memo.docx",
  "workingMemoryId": "6d5c4b3a-2918-4f7e-8d6c-5b4a39281706",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "metadata": {"source": "credit-review"}
}'
```

Exactly one of `blobKey` or `workingMemoryId` is required. For a working-memory item, your app reads the content from the [Context Service](../context-service/README.md) after the directory confirms the user can see the item.

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

Visibility is decided by the grants on an item's governing folder. The first grant on `/reports` gives it its own permission list, and from then on only principals granted on `/reports` can see into it — Alice's grant on the root no longer covers it. So give Alice a grant on `/reports` **first**, while she can still reach it through the root:

```bash
alice -X PUT $DIRECTORY_URL/v1/items/$REPORTS_ID/permissions -H 'Content-Type: application/json' \
  -d "{\"principalId\":\"$ALICE\",\"principalKind\":\"user\",\"role\":\"owner\"}"
```

Now, as an owner of `/reports`, Alice gives Bob `reader` there:

```bash
alice -X PUT $DIRECTORY_URL/v1/items/$REPORTS_ID/permissions -H 'Content-Type: application/json' \
  -d "{\"principalId\":\"$BOB\",\"principalKind\":\"user\",\"role\":\"reader\"}"

alice $DIRECTORY_URL/v1/items/$REPORTS_ID/permissions | jq '.grants[] | {principalId, role}'
```

If you ever lock a user out of a subfolder this way, the owner application can repair it by making the grant call **without** `X-On-Behalf-Of`. See [Authorization](./authorization.md#inheritance).

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

Trashing removes the item (and, for a folder, its subtree) from the directory and frees its name. The underlying content is **not** deleted, and trash cannot currently be restored. The drive root cannot be trashed.

## Next Steps

- **[Authorization](./authorization.md)** — the dual-grant model in depth
- **[Integrations](./integrations.md)** — connect Microsoft 365 or Box and import documents
- **[Reference](./reference.md)** — all endpoints, fields, and error codes
- **[Concepts](./concepts.md#designing-your-app)** — app design patterns
- **[Operations](./operations.md)** — availability, configuration, and troubleshooting
