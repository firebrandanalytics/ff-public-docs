# Directory Service — Concepts

This page explains the mental model behind the Directory Service: what drives, items, anchors, and grants are, how content is referenced rather than owned, and how delegated connections and import jobs fit in.

## The Big Picture

The Directory Service separates two things that most file systems combine:

| Plane | What it holds | Where it lives |
|-------|---------------|----------------|
| **Namespace plane** | Drives, folders, file entries, paths, grants, provenance | PostgreSQL, schema `directory` |
| **Content plane** | The actual bytes | Blob storage (Azure Blob or local disk), or a Context Service working memory |

A file item never contains its bytes. It carries exactly one **content pointer** — a blob key or a working-memory id — and the directory decides *who may follow that pointer*. This is what lets one document be visible from several applications without being copied for each.

## Core Objects

### Drive

A drive is three things at once:

1. **A tenancy boundary** — every item belongs to exactly one drive.
2. **The ACL root** — every drive has a root folder (path `/`) that always carries explicit grants.
3. **The unit an application is granted** — applications are admitted to whole drives, never to individual folders.

| Field | Meaning |
|-------|---------|
| `id` | Drive UUID |
| `orgScope` | Scope string the drive lives in (default `default`). Slugs are unique per scope. |
| `slug` | Short, unique-per-scope name |
| `displayName` | Optional human-readable name |
| `kind` | `shared` (default), `app`, or `user` — a label for how the drive is used; it does not change authorization |
| `rootItemId` | The root folder item |
| `ownerPrincipalId` | The application that created the drive |

When an application creates a drive, the service creates the root folder in the same transaction and grants the calling application `owner` on it. The creating application can therefore use the drive immediately, without a separate bootstrap step.

> If two folders need different *application* access, they belong in different drives. Application access is drive-wide by design — see [Authorization](./authorization.md).

### Item

An item is either a **folder** or a **file**.

| Field | Meaning |
|-------|---------|
| `id`, `driveId`, `parentId` | Identity and position. The drive root has no `parentId`. |
| `kind` | `folder` or `file` |
| `name`, `path` | Name (unique per folder, case-insensitive) and materialized `/`-joined path |
| `aclAnchorId` | The item whose grants govern this one (see Anchors below) |
| `blobKey` / `workingMemoryId` | Content pointer — exactly one is set for a file, neither for a folder |
| `mimeType`, `sizeBytes`, `checksumSha256` | Content metadata (checksum is set for uploaded and imported files) |
| `etag` | Changes on every modification; used with `If-Match` |
| `metadata` | Free-form JSON supplied at promote time |
| `origin` | How the item came to exist: `created`, `promoted`, `imported`, or `derived` |
| `provenance` | For imported items: provider, connection, external ids and path, source ETag, web URL, import job, timestamps |

Names may not be empty, may not contain `/` or `\`, may not be `.` or `..`, and are limited to 255 characters.

### Anchor

Grants do not sit on every item. They sit on **anchors**: items that carry explicit grants. Every item points at exactly one anchor through `aclAnchorId` — the nearest item at or above it that carries grants. The drive root always anchors.

- A new item inherits its parent's anchor.
- Granting on a folder that is not yet an anchor turns it into one, and the part of its subtree that was inheriting from further up is re-pointed to it.
- A user's access to an item is decided by whether they hold a grant on **that item's anchor**.

The consequence is deliberate: a user granted only `/reports` can see `/reports` and what is under it, but **cannot list the drive root** — the same behavior users expect from SharePoint. The `entry-points` endpoint exists so such users can discover where they are allowed to start.

### Grant

A grant is `(item, principal, kind, role)`:

- **principal** — a UUID identifying a user or an application
- **kind** — `user` or `app`
- **role** — `reader` < `writer` < `owner`

User grants may sit on any folder. Application grants are only accepted on a drive root. The full rules are in [Authorization](./authorization.md).

### Caller

Every authenticated request resolves to a caller made of two parts:

- **Application principal** — derived from the `X-API-Key` header. This is the trustworthy half.
- **User principal (optional)** — the `user=` field of the `X-On-Behalf-Of` header. The platform does not sign this header, so it is treated as a *claim* that the application makes on the user's behalf.

Requests without a user (background jobs, autonomous agents) are authorized on the application alone.

## Content: Referenced, Never Owned

There are three ways a file item gets content:

| Operation | Bytes written? | Content pointer | `origin` |
|-----------|----------------|-----------------|----------|
| `POST /v1/items:promote` | No | An existing `blobKey` (must exist in the service's blob store) or a `workingMemoryId` | `promoted` |
| `POST /v1/items:upload` | Yes, once | `directory/<driveId>/<sha256>` | `created` |
| Import job | Yes, once per distinct content | `directory/<driveId>/<sha256>` | `imported` |

Because keys for uploaded and imported content are content-addressed, identical bytes in the same drive share one blob.

**Trashing an item never deletes content.** `DELETE /v1/items/{id}` soft-deletes the item and its subtree in the namespace; the blob stays where it is. The service has no code path that deletes blobs.

> **Blob lifecycle.** Because the directory references content it does not own, any cleanup process that removes blobs or working memories in your environment must not remove content the directory still references — including blobs the directory wrote itself during upload or import. A platform-wide reference count does not exist yet, so plan retention for these blobs accordingly.

Items that reference a working memory are catalog entries only: `GET /v1/items/{id}/content` streams blob-backed items, and returns `400` for a working-memory item. Fetch working-memory content through the [Context Service](../context-service/README.md).

## Delegated Connections

A **connection** is a stored, consented OAuth grant from one person to one external provider (`msgraph` or `box`), owned by one **(application, user)** pair. It is how the directory browses and imports content *as that person*.

```
 pending ──(consent callback succeeds)──► ok ──(provider rejects credential)──► auth_revoked
    │                                      │
    └────────────── DELETE ───────────────►└──────────────── DELETE ─────────────► revoked
```

| Status | Meaning |
|--------|---------|
| `pending` | Created by `connections:start`; waiting for the person to complete consent |
| `ok` | Consent completed; the connection can browse and import |
| `auth_revoked` | The provider rejected the stored credential (revoked, expired, policy change). The person must reconnect. |
| `revoked` | Deleted by its owner; stored token material has been erased |

Key properties:

- **Delegated only.** Browse and import use only the stored credential of an owned connection. No API accepts a caller-supplied token, and there is no fallback to an application-wide credential. An import can never see more than the consenting person can see.
- **Owned, and invisible to others.** A connection is visible only to the same application *and* the same user that created it. Anyone else gets `404`, whatever the connection's state.
- **Tokens never leave the service.** Refresh and access tokens are sealed with AES-256-GCM using `DIRECTORY_TOKEN_KEY` and are never returned by any endpoint.
- **Subject-stable.** Once a connection records the consenting account (`providerSubject`), it cannot be re-bound to a different account.

See [Integrations](./integrations.md) for provider-specific details.

## Import Jobs

An import job copies one source file or folder subtree from a connection into a target folder in a drive.

### Job lifecycle

```
queued ─► enumerating ─► fetching ─► completed
                                 └─► completed_with_errors
   any non-terminal state ───────► failed      (credential revoked)
   any non-terminal state ───────► cancelled   (POST /v1/imports/{id}:cancel)
```

- **enumerating** — the worker walks the source subtree breadth-first, recording each file and folder as an **entry**. Enumeration is checkpointed per page, so a restarted worker resumes rather than starting over.
- **fetching** — each entry is imported: folders become directory folders, files are downloaded, hashed, stored, and registered.
- **settle** — the job's final state is derived from its entry counts: `completed` if nothing failed, was unreachable, or was skipped; otherwise `completed_with_errors`.

A transient error (network, provider 5xx, throttling) pauses a job and leaves it claimable, so a job survives worker restarts. Only a revoked credential fails the whole job.

### Entry states

| State | Meaning |
|-------|---------|
| `queued` | Discovered, waiting to be fetched |
| `importing` | A worker is fetching it |
| `imported` | Written to the drive (reason `updated` if it replaced older content) |
| `unchanged` | Already present with the same source ETag; nothing written |
| `failed` | Gave up; see `reason` |
| `unreachable` | The source item could not be read; see `reason` |
| `skipped` | Deliberately not imported (e.g. a Box web link, a trashed item, or cancellation) |

Stable `reason` tokens: `auth_revoked`, `not_found`, `throttled`, `unreachable`, `too_large`, `name_conflict`, `invalid_name`, `cancelled`, `retries_exhausted`, `updated`, `insufficient_space`, `timeout`, `forbidden`, `web_link`, `trashed`.

### Progress is counts, not a percentage

`GET /v1/imports/{id}` reports a count for every entry state and no percentage. While enumeration is running there is no final total to divide by, so a percentage would move backwards as more work is discovered. Counts are also more actionable: "3 failed" tells you what to look at.

### Re-import

Imported items record their source in `provenance`. Re-importing the same source through the same connection into the same drive compares ETags: unchanged files become `unchanged` entries, changed files are refreshed in place (`imported`, reason `updated`). There is no change feed or continuous sync — a re-import re-enumerates the source. Starting an import whose source item is already imported (through the same connection) under a *different* folder in the same drive is refused with `409 DUPLICATE_SOURCE`.

## How It Interacts With Other Services

| Service | Relationship |
|---------|--------------|
| [Identity Management Service](../identity-service/README.md) | Principal UUIDs in grants are intended to be IMS principals (human users, applications, agent bundles). In the current release the service resolves API keys from its own configuration (`DIRECTORY_API_KEYS`) rather than calling IMS; the header contract matches the platform's. |
| [Context Service](../context-service/README.md) | Items can reference working memories by id (`workingMemoryId`) without copying them. |
| Blob storage | Uploaded and imported bytes are written to the service's own configured container. Promoted `blobKey`s must already exist there. |
| Entitlement agent | Optional. When configured, the `/v1` surface checks the `directory.access` entitlement. |
| Microsoft Graph / Box | Read-only, through delegated connections. |

## Current Limitations

- **Move is not implemented** — items can be renamed but not moved to another folder.
- **No grant removal endpoint** — grants can be added and their role changed (including lowered), but not deleted through the API.
- **Trash has no purge, restore, or retention policy.**
- **No delta sync, events, or write-back** to the external source.
- **Principal resolution is configuration-based** — see the IMS row above.
