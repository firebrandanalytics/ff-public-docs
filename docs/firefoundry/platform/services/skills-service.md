# Skills Service

## Overview

The Skills Service is a dedicated REST API for managing FireFoundry skills — reusable instruction packages (markdown + assets) that hosted agents load at runtime to extend their behavior. It owns skill storage, manifest parsing, version management, environment-scoped installation, and per-bot access control.

## Purpose and Role in Platform

The Skills Service is the single source of truth for skill data on the platform. It enables agents to:

- Discover what skills are available in their environment
- Load parsed skill manifests (front matter + mode structure) without re-parsing zip files at runtime
- Download skill content (markdown, assets, references) on demand
- Honor per-bot access grants and dependency declarations

Previously, skills were tacked onto the Virtual Worker Manager (VWM) using a single flat `shared.skills` table, while the console maintained its own parallel data model. This service consolidates skill management into one schema with proper separation between platform-curated registry skills and per-environment custom skills.

## Key Features

- **Registry Skills**: Platform-level curated skill catalog with semantic versioning
- **Custom Skills**: Per-environment, user-created skills that don't go through the platform registry
- **Installation Tracking**: Records which registry skill versions are installed into which environment
- **Access Grants**: Fine-grained permissions controlling which apps, bots, or workers may consume which skills
- **Bot Dependencies**: Declarative skill-to-bot dependency tracking so deployments can validate completeness
- **Manifest Parsing at Upload**: YAML front matter and mode extraction run when a zip is uploaded; results stored as JSONB for zero-cost runtime reads
- **System Skills**: Built-in skills with a default-include toggle for new environments
- **Multi-tenant Storage**: Skill zips persisted in blob storage; metadata in PostgreSQL

## Architecture Overview

The Skills Service follows the standard FireFoundry layered architecture:

```
┌─────────────────────────────────────────────────────┐
│                  REST API Layer                     │
│              (Express 5 + Zod validation)           │
│      /admin (management)  /v1 (consumer)            │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Business Logic Layer                   │
│   Registry, Custom Skills, Installations,           │
│   Access Grants, Bot Dependencies, Manifest         │
│   parsing (js-yaml + unzipper)                      │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────────┐  ┌──────▼──────────────────────┐
│   PostgreSQL       │  │   Blob Storage              │
│   (skills schema)  │  │   (shared-utils adapter)    │
│   - Metadata       │  │   - Skill zip files         │
│   - Manifest JSONB │  │   - Per-version immutable   │
└────────────────────┘  └─────────────────────────────┘
```

**Core Components:**
- **Express Application**: Standard lifecycle with `/health`, `/ready`, `/status` probes
- **Admin Router (`/admin`)**: CRUD for registry, custom skills, installations, grants, and dependencies
- **Consumer Router (`/v1`)**: Read-only endpoints for agent bundles and the VWM harness
- **Manifest Parser**: Extracts SKILL.md front matter and mode list when a zip is uploaded
- **PostgreSQL Pools**: Separate read (fireread) and write (fireinsert) connection pools
- **Blob Storage**: Skill zip files stored via the shared blob storage adapter

## Skill Zip Format

Skills are uploaded as zip files with a fixed top-level structure:

```
my-skill.zip
├── SKILL.md           # Required — with optional YAML front matter
├── modes/             # Optional — sub-modes (review, debug, etc.)
│   ├── review.md
│   └── debug.md
├── assets/            # Optional — companion files (images, samples)
└── references/        # Optional — reference docs the skill links to
```

**SKILL.md front matter:**

```yaml
---
name: my-skill
description: What this skill does
version: 1.0.0
tags: [ai, tools, debugging]
toolRefs: [my-mcp-tool]
---

# My Skill

Skill instructions in markdown...
```

The service parses the front matter and mode list at **upload time** and stores the result as a `manifest` JSONB column. Consumer endpoints serve pre-parsed JSON, so runtime callers never extract zips.

## API and Interfaces

### Standard Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (checks DB connectivity) |
| GET | `/status` | Service status and uptime |

### Admin API (`/admin`)

Management endpoints used by the FF Console and platform tooling.

**Registry Management:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/registry` | List registry entries (paginated: `?page=1&limit=20`) |
| POST | `/admin/registry` | Create registry entry |
| GET | `/admin/registry/:id` | Get entry by ID |
| PUT | `/admin/registry/:id` | Update entry metadata |
| DELETE | `/admin/registry/:id` | Delete entry (cascades to versions) |
| GET | `/admin/registry/:id/versions` | List versions for entry |
| POST | `/admin/registry/:id/versions` | Upload new version (multipart: `file` + `metadata` JSON) |

**Custom Skills (environment-scoped):**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/custom?environment_id=<uuid>` | List custom skills |
| POST | `/admin/custom` | Create custom skill (optional multipart file upload) |
| GET | `/admin/custom/:id` | Get detail with versions |
| PUT | `/admin/custom/:id` | Update metadata |
| DELETE | `/admin/custom/:id` | Delete |

**Installations:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/installations?environment_id=<uuid>` | List installations |
| POST | `/admin/installations` | Install registry skill version into environment |
| DELETE | `/admin/installations/:id` | Uninstall |

**System Skills:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/system-skills` | List system skills |
| PUT | `/admin/system-skills/:id/default-include` | Toggle default-include flag |

**Access Grants & Bot Dependencies:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/access-grants?environment_id=<uuid>` | List grants |
| POST | `/admin/access-grants` | Create grant (skill → app / bot / worker) |
| DELETE | `/admin/access-grants/:id` | Remove grant |
| GET | `/admin/bot-dependencies?environment_id=<uuid>` | List bot-to-skill dependencies |
| POST | `/admin/bot-dependencies` | Create dependency |
| DELETE | `/admin/bot-dependencies/:id` | Remove dependency |

### Consumer API (`/v1`)

Read-only endpoints intended for agent bundles and the VWM harness.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/skills?environment_id=<uuid>` | List skills available in an environment |
| GET | `/v1/skills/:name?environment_id=<uuid>` | Get parsed skill manifest |
| GET | `/v1/skills/:name/modes/:mode?environment_id=<uuid>` | Get specific mode content |
| GET | `/v1/skills/manifest?environment_id=<uuid>` | Full `SkillManifest` for an environment |
| GET | `/v1/skills/:name/download?environment_id=<uuid>` | Download skill zip |

## Database Schema

All tables live in the `skills` schema:

| Table | Purpose |
|-------|---------|
| `registry_entries` | Platform-level skill catalog |
| `registry_versions` | Immutable versions per registry entry |
| `custom_skills` | Per-environment custom skills |
| `custom_versions` | Versions for custom skills |
| `installations` | Registry skills installed into environments |
| `access_grants` | Skill-to-app/bot/worker permissions |
| `bot_dependencies` | Bot-to-skill dependency tracking |

Migrations are managed in the service repository and applied via `pnpm migrate`.

## Dependencies

### Required Services
- **PostgreSQL** with the `skills` schema and migrations applied
- Database roles: `fireread` (readonly) and `fireinsert` (write access)
- **Blob storage** backend (Azure Blob, S3, or local) accessible via `@firebrandanalytics/shared-utils`

### NPM Dependencies
- `express@5` — Web framework
- `zod` — Request validation
- `pg` — PostgreSQL client
- `multer` — Multipart file upload handling
- `js-yaml` — Front matter parsing
- `unzipper` — Skill zip extraction at upload time
- `@firebrandanalytics/shared-utils` — Blob storage adapter, logging

## Configuration

### Service Settings
```bash
NODE_ENV=development              # development | production | test
PORT=8080                         # HTTP server port
LOG_LEVEL=info                    # debug | info | warn | error
SERVICE_NAME=skills-service       # Service identifier
```

### Database Connection
```bash
PG_HOST=...                       # Database host (or PG_SERVER)
PG_DATABASE=firefoundry           # Database name (default: firefoundry)
PG_PASSWORD=***                   # fireread password
PG_INSERT_PASSWORD=***            # fireinsert password
RUN_MIGRATIONS=false              # Auto-run migrations on startup
```

See the repository's `.env.example` for the complete list.

## Design Decisions

- **Parse at upload, not at read.** The YAML front matter and mode structure are extracted when a zip is uploaded and stored as a JSONB `manifest` column. Consumer endpoints serve pre-parsed JSON, so runtime callers never extract zips. This trades a small upload cost for fast, predictable consumer latency.
- **Registry vs. custom skills are different lifecycles.** Registry skills are platform-global and versioned; custom skills are environment-scoped and managed by the environment owner. They share the same zip format and manifest schema but have separate tables and admin endpoints.
- **Separate from VWM.** This service owns skill data. VWM's skill harness bootstrap reads from this service's consumer API rather than managing skills directly, eliminating the prior duplication between VWM's `shared.skills` table and the console's parallel model.
- **REST-only at v0.1.** No gRPC yet. Skill reads are infrequent compared to broker or entity calls, so REST is sufficient. A gRPC consumer interface can be added later if high-throughput internal use cases emerge.

## Version and Maturity

- **Current Version**: 0.1.0
- **Status**: Beta — early in life, API may change
- **Node.js Version**: 20+ required
- **TypeScript**: Full type safety with strict mode

## Repository

Source code: [ff-services-skills](https://github.com/firebrandanalytics/ff-services-skills)

## Related Documentation

- [Platform Services Overview](./README.md) — Overview of all FireFoundry services
- [Virtual Worker Manager](./virtual-workers.md) — VWM consumes skills via this service
