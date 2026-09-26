# Directory Service — Authorization

Permissions are the main reason to use the Directory Service. This page covers how your application acts on behalf of a user, the **dual-grant** check, how **inheritance** decides what each user sees, what each role allows, and how to grant access.

## Acting on Behalf of a User

Every `/v1` request (except the OAuth callback) carries your application's API key, and may name the user you are acting for:

| Header | Identifies | Notes |
|--------|------------|-------|
| `X-API-Key: <key>` | **Your application** | Issued for your application by your environment administrator |
| `X-On-Behalf-Of: user=<uuid>` | **The user** your application is acting for | Optional for catalog routes; required for connections and imports |

`X-On-Behalf-Of` follows the platform grammar `app=<id>; bundle=<id>; user=<id>` (any subset); the directory reads the `user=` field. A `user=` value that is not a UUID is rejected with `400 INVALID_INPUT`.

> **Always use the `user=` form.** A bare UUID (no `user=` key) is not recognized as a user, so the request is authorized as your application alone — which usually sees more than the user should.

The user claim is asserted by your application, not signed by the platform. That is why the directory also requires your application to hold a grant on the drive: whatever user an application claims, it can never reach a drive it was not admitted to. Keep your API key server-side and only assert users your app has authenticated.

## Dual-Grant

Reaching an item requires **both**:

1. **Application gate** — your application holds a grant on the **drive root** at or above the required role; and
2. **User permission** — if a user was asserted, that user holds a grant at or above the required role on the folder that governs the item.

```
        request (app A, user U) for item I in drive D, needs role R
                                   │
               ┌───────────────────▼────────────────────┐
               │ Does app A hold ≥ R on D's root?       │── no ──► deny
               └───────────────────┬────────────────────┘
                                   │ yes
                         ┌─────────▼─────────┐
                         │ User asserted?    │── no ──► allow (app-only)
                         └─────────┬─────────┘
                                   │ yes
               ┌───────────────────▼────────────────────┐
               │ Does U hold ≥ R where I's grants live? │── no ──► deny
               └───────────────────┬────────────────────┘
                                   │ yes
                                 allow
```

- **User permissions** are folder-level, with inheritance — this is your app's real permission model.
- **Application permissions** are drive-level only — a boundary on what your app can ever reach.

### Requests with no user

Background jobs and autonomous agents often have no user. Such requests are authorized on the application grant alone and see the whole drive at the application's role. **Grant agent bundles only the drives and roles they need.**

## Inheritance

Grants attach to specific items; everything underneath inherits from the nearest item above it that has grants of its own. Each item's `aclAnchorId` names that governing item. The drive root always has grants.

When you grant on a folder:

1. The folder gets its own permission list (if it did not have one).
2. Items beneath it that were inheriting from further up now inherit from this folder.
3. Subfolders that already had their own grants keep them.

A user's access to an item is decided **only** by the grants on its governing folder. So:

> **Adding the first grant to a subfolder narrows who can see it.** Suppose user U has `reader` on the drive root, and you then grant user V `writer` on `/finance`. Everything under `/finance` is now governed by `/finance` — so **U can no longer see `/finance`** unless you also grant U there. When you first share a subfolder, grant it to everyone who should keep access, starting with yourself (the acting user), before granting others.

### Example

```
/                      grants: app A owner, user Alice owner
├── reports/           grants: user Bob reader
│   └── q3.pdf         (governed by reports/)
└── drafts/            (governed by /)
    └── plan.docx      (governed by /)
```

| Caller | Listing `/` | `reports/q3.pdf` | `drafts/plan.docx` |
|--------|-------------|------------------|---------------------|
| App A, user Alice | Sees `drafts/` only | Not found | Read and write |
| App A, user Bob | Not found | Read | Not found |
| App A, no user | Sees everything | Read | Read and write |
| App B (no drive grant), user Alice | Not found | Not found | Not found |

Alice owns the root, but `reports/` has its own grants, so she needs a grant there to see into it. Bob can reach `reports/` but not the root, so your UI should start him from his entry points.

If a user gets locked out of a subfolder this way, your application can repair it by granting them there **without** `X-On-Behalf-Of` (app-only, as drive owner).

## Entry Points

A user granted only on a subfolder cannot list the drive root. `GET /v1/drives/{id}/entry-points` returns, sorted by path:

- **with a user**: the items where that user holds grants — their "shared with me" starting points;
- **without a user**: the drive root.

Use it to build the top level of a file browser for each user.

## Roles

| Role | Allows |
|------|--------|
| `reader` | See drives, items, listings, content, and grants |
| `writer` | Everything `reader` allows, plus create folders, upload, promote, rename, trash, and import into a folder |
| `owner` | Everything `writer` allows, plus add or change grants |

A higher role satisfies a lower requirement. The same role is required on **both** sides of dual-grant — for example, uploading as a user needs `writer` for both your application and the user.

### Required role per operation

| Operation | Endpoint | Required role |
|-----------|----------|---------------|
| Create a drive | `POST /v1/drives` | Any valid API key; your application becomes `owner` |
| List drives | `GET /v1/drives` | Any application grant on the drive root (user not checked) |
| Get drive, entry points | `GET /v1/drives/{id}`, `.../entry-points` | `reader` |
| Get item / by path / children / content | `GET /v1/items/...` | `reader` |
| List grants | `GET /v1/items/{id}/permissions` | `reader` |
| Create folder, upload, promote | `POST /v1/folders`, `items:upload`, `items:promote` | `writer` on the parent |
| Rename, trash | `PATCH`, `DELETE /v1/items/{id}` | `writer` |
| Add or change a grant | `PUT /v1/items/{id}/permissions` | `owner` |
| Start an import | `POST /v1/imports` | `writer` on the target folder |
| See an import job | `GET /v1/imports/...` | Job owner **and** `reader` on the target folder |

## Granting

`PUT /v1/items/{id}/permissions` with `principalId`, `principalKind` (`user` or `app`), and `role`.

- **User grants may target any item** and give it its own permission list (see [Inheritance](#inheritance)).
- **Application grants must target the drive root**; anywhere else returns `400`. If two folders need different application access, use different drives.
- **A principal is either a user or an application** on a given item; granting it under the other kind returns `409 CONFLICT`.
- **Re-granting changes the role**, up or down.
- **Grants cannot be removed** in this release. To withdraw access, lower the role or move content to a separate drive.

### Admitting another application

To let a second application read a drive, the owning application grants it on the drive root:

```bash
curl -s -X PUT "$DIRECTORY_URL/v1/items/$ROOT_ID/permissions" \
  -H "X-API-Key: $OWNER_APP_KEY" -H 'Content-Type: application/json' \
  -d '{"principalId":"<other-app-principal-uuid>","principalKind":"app","role":"reader"}'
```

Users acting through the second application still need their own user grants.

## Not Found, Not Forbidden

The directory does not reveal things a caller cannot reach:

- Item endpoints return **`404 NOT_FOUND`** when either side of dual-grant fails — the same response as a non-existent id.
- Drive endpoints (`GET /v1/drives/{id}`, `entry-points`) return `403 FORBIDDEN` when the check fails; `GET /v1/drives` simply omits drives your application cannot reach.
- Another user's connection or import job is `404`, whatever its state.

Treat `404` as "not visible to this caller" in your UI.

## Authorization and Import

Imports use the same permission model:

- Starting an import needs a connection owned by the same application and user, plus **`writer`** on the target folder.
- Imported items inherit the target folder's permissions like any other item.
- If the user later loses access to the target folder, the import job disappears from their view too.
- A connection only reads what the consenting person can see in Microsoft 365 or Box. See [Integrations](./integrations.md).
