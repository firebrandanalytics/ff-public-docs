# Directory Service — Authorization

The Directory Service's permission model is its most important feature. This page explains the **dual-grant** check, how **anchors** give folder-level inheritance, what each role allows, and the behaviors that follow from those rules.

## Who Is Calling

Every `/v1` request (except the OAuth callback) must carry an API key. The service resolves the request to a caller with up to two principals:

| Header | Resolves to | Trust |
|--------|-------------|-------|
| `X-API-Key: <key>` | The **application principal** configured for that key | Trusted — only holders of the key can present it |
| `X-On-Behalf-Of: user=<uuid>` | The **user principal** the application is acting for | A claim — the platform does not sign this header |

`X-On-Behalf-Of` follows the platform grammar `app=<id>; bundle=<id>; user=<id>` (any subset). Only the `user=` field is used. A `user=` value that is not a UUID is rejected with `400 INVALID_INPUT` rather than silently ignored.

> **Always use the `user=` form.** A header containing a bare UUID (no `user=` key) carries no user field, so the request is treated as having **no user asserted** and is authorized on the application alone. That can grant broader access than you intended.

Because any holder of a valid API key could claim to be any user, the user claim alone must never be enough to reach content. Dual-grant is how the service contains that.

## Dual-Grant

Reaching an item requires **both**:

1. **Application gate** — the calling application holds a grant on the **drive root** at or above the required role; and
2. **User permission** — if a user was asserted, that user holds a grant at or above the required role on the **item's anchor**.

```
             request (app A, user U) for item I in drive D, needs role R
                                   │
               ┌───────────────────▼────────────────────┐
               │ Does app A hold ≥ R on D's root item?  │── no ──► deny
               └───────────────────┬────────────────────┘
                                   │ yes
                         ┌─────────▼─────────┐
                         │ User asserted?    │── no ──► allow (app-only)
                         └─────────┬─────────┘
                                   │ yes
               ┌───────────────────▼────────────────────┐
               │ Does U hold ≥ R on I's ACL anchor?     │── no ──► deny
               └───────────────────┬────────────────────┘
                                   │ yes
                                 allow
```

The two sides use different granularity on purpose:

- **The user side is the real permission model** — folder-level, with inheritance.
- **The application side is a blast-radius gate** — drive-level only. An application can never reach a drive it was not granted, no matter whose identity it claims. A leaked API key is therefore confined to the drives its application was admitted to.

### Requests with no user

Background jobs and autonomous agents often have no user context. Such requests are authorized on the application gate alone and can see the whole drive at the application's role. This is not a weakening — dual-grant exists to contain *forged user claims*, and there is no claim to forge — but it means an agent bundle's drive grant carries the full weight. **Grant agent bundles only the drives and roles they need.**

## Anchors and Inheritance

Grants attach to **anchors**. Every item records one anchor (`aclAnchorId`): the nearest item at or above it that carries explicit grants. The drive root is always an anchor.

When you grant on a folder:

1. The grant is recorded on that folder, which becomes an anchor if it was not one.
2. Every item in its subtree that was inheriting from the *same* anchor as the folder is re-pointed to the folder.
3. Descendants that already had their own anchor are left alone.

A user's visibility is decided **only by the item's own anchor**. This has an important consequence:

> **A new anchor narrows inheritance.** Suppose user U holds `reader` on the drive root, and you then grant user V `writer` on `/finance`. `/finance` becomes an anchor, and everything under it now points at `/finance` — so **U can no longer see `/finance`** unless you also grant U on `/finance`. When you add the first grant to a subfolder, re-grant any existing principals who should keep access there.

### Example

```
/                      anchor, grants: app A owner, user Alice owner
├── reports/           anchor, grants: user Bob reader
│   └── q3.pdf         (anchor = reports/)
└── drafts/            (anchor = /)
    └── plan.docx      (anchor = /)
```

| Caller | `/` listing | `reports/q3.pdf` | `drafts/plan.docx` |
|--------|-------------|------------------|---------------------|
| App A, user Alice | Sees `drafts/` only (`reports/` is anchored elsewhere) | Not found | Readable, writable |
| App A, user Bob | Not found (the root is not anchored where Bob has a grant) | Readable | Not found |
| App A, no user | Sees everything | Readable | Readable, writable |
| App B (no drive grant), user Alice | Not found | Not found | Not found |

Alice owns the root, but because `reports/` was given its own anchor, she needs a grant on `reports/` to see into it. Bob can reach `reports/` but not the root, so he starts from `GET /v1/drives/{id}/entry-points`.

## Entry Points

A user granted only on a subfolder cannot list the drive root, so they need somewhere to start. `GET /v1/drives/{id}/entry-points` returns, sorted by path:

- for a request **with a user**: the items where that user holds grants (their "shared with me" roots);
- for a request **without a user**: the drive root.

## Roles

| Role | Rank | Allows |
|------|------|--------|
| `reader` | 1 | See drives, items, listings, content, and grants |
| `writer` | 2 | Everything `reader` allows, plus create folders, upload, promote, rename, trash, and import into a folder |
| `owner` | 3 | Everything `writer` allows, plus add or change grants |

A higher role always satisfies a lower requirement. The same role is required on **both** sides of the dual-grant check.

### Required role per operation

| Operation | Endpoint | Required role |
|-----------|----------|---------------|
| List drives | `GET /v1/drives` | Any application grant on the drive root (user not checked) |
| Get drive | `GET /v1/drives/{id}` | `reader` |
| Entry points | `GET /v1/drives/{id}/entry-points` | `reader` |
| Get item / by path / children / content | `GET /v1/items/...` | `reader` |
| List grants | `GET /v1/items/{id}/permissions` | `reader` |
| Create folder, upload, promote | `POST /v1/folders`, `items:upload`, `items:promote` | `writer` on the parent |
| Rename, trash | `PATCH`, `DELETE /v1/items/{id}` | `writer` |
| Add or change a grant | `PUT /v1/items/{id}/permissions` | `owner` |
| Start an import | `POST /v1/imports` | `writer` on the target folder |
| See an import job | `GET /v1/imports/...` | Job owner **and** `reader` on the target folder, evaluated live |
| Create a drive | `POST /v1/drives` | Any valid API key; the calling application becomes `owner` |

## Granting

`PUT /v1/items/{id}/permissions` with `principalId`, `principalKind` (`user` or `app`), and `role`.

- **Application grants must target a drive root.** An application grant on any other item is rejected with `400` rather than silently ignored — a grant that looks applied but never takes effect is worse than an error. If two folders need different application access, put them in different drives.
- **User grants may target any item**, and make that item an anchor (see above).
- **A principal is either a user or an application on a given item.** Granting a principal under the other kind returns `409 CONFLICT`.
- **Re-granting updates the role**, up or down.
- **Grants cannot currently be removed** through the API. To withdraw access, lower the role or restructure the drive.

### Admitting another application

To let a second application read a drive, the drive owner grants it on the drive root:

```bash
curl -s -X PUT "$DIRECTORY_URL/v1/items/$ROOT_ID/permissions" \
  -H "X-API-Key: $OWNER_APP_KEY" -H 'Content-Type: application/json' \
  -d '{"principalId":"<other-app-principal-uuid>","principalKind":"app","role":"reader"}'
```

Users acting through that second application still need their own user grants; the application grant only opens the gate.

## Not Found, Not Forbidden

The service avoids telling callers that things they cannot reach exist:

- Item endpoints return **`404 NOT_FOUND`** when the caller fails either side of dual-grant — indistinguishable from an item id that does not exist. The error message never echoes the requested id.
- Drive endpoints (`GET /v1/drives/{id}`, `entry-points`) return `403 FORBIDDEN` when the gate fails, and `GET /v1/drives` simply omits drives the application cannot reach.
- Connections and import jobs check **ownership before state**. Another caller's connection or job is `404` whatever its state — never a `409` that would confirm it exists.

## Authorization and Import

Imports do not introduce a second permission system:

- Starting an import requires an **owned** connection (same application and user) and **`writer`** on the target folder through the normal dual-grant check.
- Every item the importer creates is created through the same domain service, inheriting the target folder's anchor like any other item.
- Import jobs remain subject to the drive gate after creation: if a principal's access to the target folder is later revoked, the job — including its source paths and file names — disappears from their view immediately.
- A connection can only read what the consenting person can see in the source system. See [Integrations](./integrations.md).

## Entitlements

Independently of dual-grant, the `/v1` surface can be gated on the `directory.access` entitlement. The check runs **after** API-key authentication, so unauthenticated callers always see `401` and learn nothing about the cluster's licence state. `/health` and `/ready` are never gated. See [Operations](./operations.md#entitlements).
