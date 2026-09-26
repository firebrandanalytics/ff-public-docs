# Directory Service — Concepts

This page explains the model your application works with — drives, items, grants, content by reference, connections, and imports — and how to design an app around it.

## The Big Picture

The Directory Service separates **where a document appears and who may see it** from **where its bytes live**:

| Directory holds | Content lives in |
|-----------------|------------------|
| Drives, folders, file entries, paths, grants, provenance | Blob storage (for uploaded and imported files) or a Context Service working memory |

A file item carries exactly one **content pointer** — a `blobKey` or a `workingMemoryId` — and the directory decides *who may follow that pointer*. That is what lets one document appear to several applications and users without a copy per consumer.

## Core Objects

### Drive

A drive is:

1. **A container** — every item belongs to exactly one drive.
2. **The top of the permission tree** — every drive has a root folder (path `/`).
3. **The unit an application is admitted to** — applications are granted whole drives, never individual folders.

| Field | Meaning |
|-------|---------|
| `id` | Drive UUID |
| `orgScope` | Scope the drive lives in (default `default`). Slugs are unique per scope. |
| `slug` | Short, unique-per-scope name |
| `displayName` | Optional human-readable name |
| `kind` | `shared` (default), `app`, or `user` — a label for how you use the drive; it does not change authorization |
| `rootItemId` | The root folder |
| `ownerPrincipalId` | The application that created the drive |

The application that creates a drive automatically becomes its `owner` and can use it immediately.

> If two folders need different *application* access, put them in different drives. Application access is drive-wide — see [Authorization](./authorization.md).

### Item

An item is a **folder** or a **file**.

| Field | Meaning |
|-------|---------|
| `id`, `driveId`, `parentId` | Identity and position. The drive root has no `parentId`. |
| `kind` | `folder` or `file` |
| `name`, `path` | Name (unique per folder, case-insensitive) and full path, e.g. `/reports/q3.pdf` |
| `aclAnchorId` | The folder whose grants govern this item (see [Inheritance](#grants-and-inheritance)) |
| `blobKey` / `workingMemoryId` | Content pointer — exactly one is set for a file, neither for a folder |
| `mimeType`, `sizeBytes`, `checksumSha256` | Content metadata (checksum is set for uploaded and imported files) |
| `etag` | Changes on every modification; use with `If-Match` |
| `metadata` | Free-form JSON you supply when promoting |
| `origin` | `created` (uploaded or created folder), `promoted`, `imported`, or `derived` |
| `provenance` | For imported items: provider, connection, source ids and path, source ETag, web URL, import job, timestamps |

Names may not be empty, contain `/` or `\`, or be `.` or `..`, and are limited to 255 characters.

### Grants and inheritance

A grant is `(item, principal, kind, role)`:

- **principal** — a UUID identifying a user or an application
- **kind** — `user` or `app`
- **role** — `reader` < `writer` < `owner`

User grants may go on any item — usually a folder or the drive root — and cover everything beneath it. Application grants go on the drive root only.

Each item is governed by exactly one folder's grants — the nearest folder at or above it that has grants of its own (its `aclAnchorId`). This has one consequence every app must design for:

> **The first grant on a subfolder gives it its own permission list.** From then on, access to that subfolder is decided by its grants only — grants on the drive root no longer reach into it. A user granted only on `/reports` can see `/reports` but not the drive root; a user granted only on the root can no longer see into `/reports` unless you grant them there too.

This mirrors how SharePoint sharing behaves. `GET /v1/drives/{id}/entry-points` tells a user where they can start browsing. The full rules, with a worked example, are in [Authorization](./authorization.md#inheritance).

### Caller

Every request identifies:

- **your application** — from the `X-API-Key` header, and
- **optionally, the user you are acting for** — from `X-On-Behalf-Of: user=<uuid>`.

Requests without a user (background jobs, autonomous agents) are authorized on the application's drive grant alone. See [Authorization](./authorization.md#acting-on-behalf-of-a-user).

## Content: Referenced, Never Owned

| How a file gets content | Bytes copied? | Content pointer | `origin` |
|-------------------------|---------------|-----------------|----------|
| `POST /v1/items:promote` | No | An existing `blobKey` (must already exist in the directory's blob store) or a `workingMemoryId` | `promoted` |
| `POST /v1/items:upload` | Yes, once | A blob the directory writes | `created` |
| Import job | Yes, once per distinct file | A blob the directory writes | `imported` |

- **Trashing never deletes content.** `DELETE /v1/items/{id}` removes the item (and a folder's subtree) from the namespace; the underlying blob or working memory is untouched.
- **You own the lifecycle of what you promote.** If your app deletes a working memory or blob it promoted, the directory item will point at missing content. Trash the item first, or keep the content for as long as the item should be visible.
- **Working-memory items are catalog entries.** `GET /v1/items/{id}/content` streams blob-backed files; for a working-memory item it returns `400`, and your app fetches the content from the [Context Service](../context-service/README.md) using `workingMemoryId` — after the directory has confirmed the user can see the item.

## Delegated Connections

A **connection** is a person's consented link to their Microsoft 365 (`msgraph`) or Box (`box`) account, owned by one **(application, user)** pair. Browsing and importing always happen *as that person*.

```
 pending ──(person completes consent)──► ok ──(provider rejects credential)──► auth_revoked
    │                                     │
    └──────────── DELETE ────────────────►└───────────── DELETE ─────────────► revoked
```

| Status | Meaning |
|--------|---------|
| `pending` | Created by `connections:start`; waiting for the person to consent |
| `ok` | Ready to browse and import |
| `auth_revoked` | The provider rejected the credential (revoked, expired, policy change). The person must reconnect. |
| `revoked` | Deleted by its owner |

- **Delegated only.** There is no tenant-wide credential and no way to pass a token in. An import can never see more than the consenting person can see.
- **Private to the (application, user) pair.** Anyone else gets `404`.
- **Tokens stay in the service.** Provider tokens are stored encrypted and are never returned by any endpoint.
- **Bound to one account.** Once a person has consented, the connection cannot be re-bound to a different provider account.

See [Integrations](./integrations.md) for the full flow.

## Import Jobs

An import job copies one source file or folder subtree from a connection into a folder in a drive.

```
queued ─► enumerating ─► fetching ─► completed
                                 └─► completed_with_errors
   any non-terminal state ───────► failed      (credential revoked)
   any non-terminal state ───────► cancelled   (POST /v1/imports/{id}:cancel)
```

- **enumerating** — the source subtree is walked and each file and folder becomes an **entry**.
- **fetching** — folders are created and files downloaded and registered.
- The job ends `completed` if every entry succeeded or was unchanged, otherwise `completed_with_errors`.

Transient problems (network, provider outages, throttling) are retried automatically and a job resumes after interruptions. Only a revoked credential fails the whole job.

### Entry states

| State | Meaning |
|-------|---------|
| `queued` | Discovered, waiting to be fetched |
| `importing` | Being fetched |
| `imported` | Written to the drive (reason `updated` if it replaced older content) |
| `unchanged` | Already present with the same source ETag; nothing written |
| `failed` | Gave up; see `reason` |
| `unreachable` | The source item could not be read; see `reason` |
| `skipped` | Deliberately not imported (Box web link, trashed item, or cancellation) |

Reason tokens: `auth_revoked`, `not_found`, `throttled`, `unreachable`, `too_large`, `name_conflict`, `invalid_name`, `cancelled`, `retries_exhausted`, `updated`, `insufficient_space`, `timeout`, `forbidden`, `web_link`, `trashed`.

### Progress is counts, not a percentage

`GET /v1/imports/{id}` returns a count for every entry state. The total is not known until enumeration finishes, so show counts ("120 imported, 3 failed") rather than a progress bar that could move backwards.

### Re-import

Re-importing the same source, through the same connection, into the same drive compares source ETags: unchanged files become `unchanged`, changed files are refreshed in place (`imported`, reason `updated`). There is no continuous sync — to pick up changes, run the import again. Importing a source that is already imported under a *different* folder of the same drive is refused with `409 DUPLICATE_SOURCE`.

## Designing Your App

### Pattern: document assistant over a user's files

A user connects Microsoft 365, picks a folder, and asks questions over it.

1. On first use, create (or look up) a drive for the user or team — e.g. slug `assistant-<team>`, `kind: "user"` or `"shared"` — and grant the user `owner` on the root (application-only call).
2. Offer "Connect Microsoft 365": `POST /v1/connections:start` as the user, open `authorizeUrl` in their browser, then poll `GET /v1/connections/{id}` until `status` is `ok`.
3. Let the user browse their source with the connection browse routes and pick a folder; start `POST /v1/imports` into a folder in their drive.
4. Show progress from job counts; when the job finishes, list the imported items and hand them to your document-processing or knowledge pipeline.
5. For "refresh", re-run the same import — only changed files are re-downloaded.
6. Handle `auth_revoked` by prompting the user to reconnect.

### Pattern: publishing agent output to a team

An agent bundle produces reports as working memories and publishes them for people to find.

- The bundle calls **without** a user (app-only) and `promote`s each working memory into a drive folder such as `/reports/2026-Q3`, with `metadata` describing the run.
- Grant the team's users `reader` on `/reports`. Users browsing through your UI call **with** `X-On-Behalf-Of` and see only what they are granted.
- Remember the inheritance rule: if you later share one subfolder with an extra user, re-grant the existing readers on that subfolder too.

### Pattern: sharing between applications

A second application (or agent bundle) needs to read documents the first one manages.

- The owning application grants the second application `reader` on the drive root.
- Users acting through the second application still need their own user grants; the application grant only opens the drive.
- If the second application should see only part of the data, put that part in a separate drive.

### Design guidance

- **Drive boundaries follow application access**, folder boundaries follow user access.
- **Always send `X-On-Behalf-Of: user=<uuid>`** for anything a user triggers, so their permissions apply; reserve app-only calls for setup and background work.
- **Grant agent bundles only the drives and roles they need** — without a user, a bundle sees the whole drive at its role.
- **Plan grants before sharing subfolders** — the first grant on a subfolder narrows who can see it.
- **Grants cannot be removed yet** — lower a role to `reader`, or move sensitive content into a separate drive, when access needs to change.

## How It Relates to Other Services

| Service | Relationship |
|---------|--------------|
| [Identity Management Service](../identity-service/README.md) | User and application principal UUIDs used in grants and in `X-On-Behalf-Of` |
| [Context Service](../context-service/README.md) | Items can reference working memories by id without copying them |
| Microsoft 365 / Box | Read-only, through a user's delegated connection |

## Current Limitations

- Items can be renamed but not **moved** to another folder.
- Grants can be added and their role changed (including lowered) but not **removed**.
- Trash has no **restore** or **purge**.
- No **search**, **change notifications**, **continuous sync**, or **write-back** to Microsoft 365 or Box.
