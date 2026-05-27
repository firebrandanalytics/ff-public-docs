# Skills Service

## Overview

The Skills Service is a dedicated REST API for managing FireFoundry skills — reusable instruction packages (markdown + assets) that hosted agents load at runtime to extend their behavior. It owns skill storage, manifest parsing, version management, environment-scoped installation, and per-bot access control.

## Purpose and Role in Platform

The Skills Service is the single source of truth for skill data on the platform. It enables agents to:

- Discover what skills are available in their environment
- Load parsed skill manifests (front matter + mode structure) without re-parsing zip files at runtime
- Download skill content (markdown, assets, references) on demand
- Honor per-bot access grants and dependency declarations

Skill management was previously embedded in the Virtual Worker Manager (VWM), with a parallel data model maintained by the console. This service consolidates skill management into a single source of truth, with proper separation between platform-curated registry skills and per-environment custom skills.

## Key Features

- **Registry Skills**: Platform-level curated skill catalog with semantic versioning
- **Custom Skills**: Per-environment, user-created skills that don't go through the platform registry
- **Installation Tracking**: Records which registry skill versions are installed into which environment
- **Access Grants**: Fine-grained permissions controlling which apps, bots, or workers may consume which skills
- **Bot Dependencies**: Declarative skill-to-bot dependency tracking so deployments can validate completeness
- **Manifest Parsing at Upload**: YAML front matter and mode extraction run when a zip is uploaded; consumers always see pre-parsed manifests, never raw zips
- **System Skills**: Built-in skills with a default-include toggle for new environments

## Architecture Overview

The Skills Service follows the standard FireFoundry layered architecture:

```
┌─────────────────────────────────────────────────────┐
│                  REST API Layer                     │
│      /admin (management)   /v1 (consumer)           │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Business Logic Layer                   │
│   Registry, Custom Skills, Installations,           │
│   Access Grants, Bot Dependencies, Manifest         │
│   parsing                                           │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────────┐  ┌──────▼──────────────────────┐
│   Metadata Store   │  │   Skill Content Store       │
│   (PostgreSQL)     │  │   (Blob Storage)            │
└────────────────────┘  └─────────────────────────────┘
```

**Core Components:**
- **Admin Router (`/admin`)**: CRUD for registry, custom skills, installations, grants, and dependencies
- **Consumer Router (`/v1`)**: Read-only endpoints for agent bundles and other skill consumers
- **Manifest Parser**: Extracts SKILL.md front matter and mode list when a zip is uploaded

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

The service parses the front matter and mode list at **upload time**. Consumer endpoints serve pre-parsed JSON, so runtime callers never extract zips.

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

## Dependencies

The Skills Service depends on a relational database for metadata and a blob storage backend for skill content. Both are configured per environment as part of the standard FireFoundry deployment.

## Configuration

The service is configured via environment variables (see `.env.example` in the service repository for the complete list). The main groups are:

- **Service settings** — `NODE_ENV`, `PORT`, `LOG_LEVEL`
- **Database connection** — host, database, credentials
- **Blob storage** — backend selection and credentials

## Design Decisions

- **Parse at upload, not at read.** The YAML front matter and mode structure are extracted when a zip is uploaded. Consumer endpoints serve pre-parsed JSON, so runtime callers never extract zips. This trades a small upload cost for fast, predictable consumer latency.
- **Registry vs. custom skills are different lifecycles.** Registry skills are platform-global and versioned; custom skills are environment-scoped and managed by the environment owner. They share the same zip format but follow separate management endpoints.
- **Separate from VWM.** This service owns skill data. The Virtual Worker Manager reads from this service's consumer API rather than managing skills directly, replacing earlier duplication between VWM and the console.
- **REST-only at v0.1.** Skill reads are infrequent compared to broker or entity calls, so REST is sufficient. A higher-throughput interface can be added later if usage warrants it.

## Version and Maturity

- **Current Version**: 0.1.0
- **Status**: Beta — early in life, API may change
- **Node.js Version**: 20+ required

## Repository

Source code: [ff-services-skills](https://github.com/firebrandanalytics/ff-services-skills)

## Related Documentation

- [Platform Services Overview](./README.md) — Overview of all FireFoundry services
- [Virtual Worker Manager](./virtual-workers/README.md) — VWM consumes skills via this service
