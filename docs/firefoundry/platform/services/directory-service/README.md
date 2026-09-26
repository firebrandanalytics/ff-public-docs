# Directory Service

## Overview

The Directory Service gives your application a **permissioned document namespace**: documents organized into **drives**, **folders**, and **items**, with folder-level access control for your users. It does not own the documents themselves — a file item points at content that lives elsewhere (a blob, or a [Context Service](../context-service/README.md) working memory) — so the same document can be shared with several applications and users without being copied.

The service can also bring in documents a person already has in **Microsoft 365** (SharePoint and OneDrive) or **Box**: the person connects their own account, browses it through your app, and imports a file or folder into a drive. Access is delegated and read-only — the import only ever sees what that person can see.

The API is JSON over REST.

## Purpose and Role in Platform

Agent bundles produce documents as working memories, and working memories are local to the application that created them. The Directory Service is where an application puts documents that people should be able to **browse, find, share, and hand to other applications**:

- **Share by reference** — register an existing blob or working memory as a directory item (`items:promote`). Nothing is copied; another application sees the same content once it is granted access.
- **Folder-level permissions** — grant users `reader`, `writer`, or `owner` on a folder; everything beneath inherits.
- **Act on behalf of a user** — your application calls with its own API key and names the user it is acting for; the directory applies that user's permissions.
- **Application boundary** — an application can only reach drives it has been granted, whichever user it claims to act for.
- **Bring in external content** — import from a user's Microsoft 365 or Box account into a drive, where it gets directory permissions like any other item.

Typical uses: a document assistant that answers questions over a user's files, a deal room shared between several agent bundles, or a place where an agent publishes generated reports for a team to review.

## Key Features

- **Drives, folders, files** — hierarchical namespace with path lookup, paged listings, rename with `If-Match` optimistic concurrency, and trash
- **Dual-grant authorization** — every request needs both an application grant on the drive and (when acting for a user) a user grant on the folder
- **Inheritance with entry points** — grants on a folder cover its subtree; `entry-points` tells a user where they can start browsing when they cannot see the drive root
- **No existence leaks** — items a caller cannot reach answer `404`, never `403`
- **Content by reference** — promote existing blobs or working memories; trashing an item never deletes the content
- **Upload** — store new files directly through the directory
- **Delegated connections** — per-user OAuth consent to Microsoft 365 or Box; provider tokens are never returned to your app
- **Background import** — import a file or folder subtree with per-file status and progress counts; re-importing refreshes changed files and skips unchanged ones

## Architecture Overview

```
 ┌──────────────────────────────┐          ┌──────────────────────────┐
 │ Your app / agent bundle      │          │ User's browser           │
 │ X-API-Key                    │          │ (one-time OAuth consent) │
 │ X-On-Behalf-Of: user=<uuid>  │          └────────────┬─────────────┘
 └──────────────┬───────────────┘                       │
                │ REST                                  │ redirect
 ┌──────────────▼───────────────────────────────────────▼──────────────┐
 │                         Directory Service                           │
 │  drives · folders · items · grants     connections · import jobs    │
 └──────┬─────────────────────────┬─────────────────────────┬──────────┘
        │ content pointers        │ content pointers        │ delegated, read-only
 ┌──────▼──────────┐   ┌──────────▼──────────┐   ┌──────────▼──────────────┐
 │ Blob storage    │   │ Context Service     │   │ Microsoft 365 (Graph)   │
 │ (uploads,       │   │ (working memories)  │   │ Box                     │
 │  imports)       │   │                     │   │                         │
 └─────────────────┘   └─────────────────────┘   └─────────────────────────┘
```

Your application talks only to the Directory Service. The directory decides who may see an item; the bytes are streamed from blob storage (`GET /v1/items/{id}/content`) or, for working-memory items, fetched by your app from the Context Service.

## Documentation

- **[Concepts](./concepts.md)** — Drives, items, grants, content by reference, connections, imports, and app design patterns
- **[Authorization](./authorization.md)** — Acting on behalf of users, dual-grant, inheritance, roles, and what each operation requires
- **[Getting Started](./getting-started.md)** — Create a drive, grant users, upload and share a file, step by step
- **[Integrations](./integrations.md)** — Connecting a user's Microsoft 365 or Box account and importing content
- **[Reference](./reference.md)** — Endpoints, request/response shapes, and error codes
- **[Operations](./operations.md)** — Availability in your environment, configuration your app supplies, limits, and troubleshooting

## Version and Maturity

- **Status**: Preview. The document namespace, the authorization model, and delegated read-only import are available.
- **Microsoft 365 (Graph)**: supported for delegated browse and import.
- **Box**: early access. It uses the same browse/import API but has not yet been validated against live customer Box accounts — validate against your own Box tenant before relying on it.
- **Not yet available**: moving items between folders (rename only), removing a grant, restoring or purging trash, change notifications or continuous sync, write-back to Microsoft 365 or Box, and search.
- **Client libraries**: none yet; use the REST API.

## Repository

Source code: [ff-services-directory](https://github.com/firebrandanalytics/ff-services-directory) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Context Service](../context-service/README.md) — working memories, which directory items can reference
- [Identity Management Service](../identity-service/README.md) — the users and applications that directory grants refer to
