# Skills Service

## Overview

The Skills Service is a dedicated REST API for managing FireFoundry **skills**: reusable instruction packages (a `SKILL.md` file plus optional modes, assets, and reference documents) that hosted agents load at runtime to extend their behavior. It owns skill storage, manifest parsing, version management, environment-scoped installation, and per-application access control.

## Purpose and Role in Platform

The Skills Service is the single source of truth for skill data on the platform. It lets agents and agent tooling:

- Discover what skills are available in their environment
- Load parsed skill manifests (front matter + mode structure) without re-parsing zip files at runtime
- Read individual files (markdown, assets, references) from a skill on demand, or download the whole skill zip
- Honor per-application access grants

It also gives platform tooling (such as the FF Console) an admin API for publishing registry skills, managing environment-specific custom skills, recording installations, and declaring bot-to-skill dependencies.

Skill management was previously embedded in the Virtual Worker Manager (VWM), with a parallel data model maintained by the console. This service consolidates skill management into a single source of truth, with proper separation between platform-curated **registry skills** and per-environment **custom skills**.

## Key Features

- **Registry Skills** — Platform-level curated skill catalog; each entry has immutable, versioned uploads
- **Custom Skills** — Per-environment, user-created skills that don't go through the platform registry, with a `draft` / `active` / `deprecated` status
- **Installation Tracking** — Records which registry skill version is installed into which environment
- **Access Grants** — Controls which applications may consume which skills (bot and worker grants can also be recorded)
- **Bot Dependencies** — Declarative skill-to-bot dependency records, with an optional version constraint
- **Manifest Parsing at Upload** — YAML front matter and mode extraction run when a zip is uploaded; consumers see pre-parsed JSON manifests, never raw zips
- **File-level Access** — Consumers can list and read individual files inside a skill (e.g. `references/api.md`) without downloading the zip
- **System Skills** — Registry entries flagged as system skills, with a `default_include` toggle that makes them available to every caller regardless of access grants
- **MCP exposure** — The [MCP Gateway](../mcp-gateway/README.md) exposes the consumer API to agents as `skills_list`, `skills_read`, and `skills_read_file` tools

## Architecture Overview

The Skills Service follows the standard FireFoundry layered service architecture:

```
┌─────────────────────────────────────────────────────┐
│                  REST API Layer                     │
│      /admin (management)   /v1 (consumer)           │
│   Entitlement guard · X-On-Behalf-Of identity       │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Business Logic Layer                   │
│   Registry, Custom Skills, Installations,           │
│   Access Grants, Bot Dependencies, Manifest         │
│   parsing, consumer ACL filtering                   │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────────┐  ┌──────▼──────────────────────┐
│   Metadata Store   │  │   Skill Content Store       │
│   (PostgreSQL,     │  │   (Blob Storage:            │
│   `skills` schema) │  │    skill zip files)         │
└────────────────────┘  └─────────────────────────────┘
```

**Core Components:**
- **Admin Router (`/admin`)** — CRUD for registry entries and versions, custom skills and versions, installations, system skills, access grants, and bot dependencies
- **Consumer Router (`/v1`)** — Read-only endpoints for agent bundles, the VWM harness, and the MCP Gateway; filters results through the access-grant ACL
- **Manifest Parser** — Extracts `SKILL.md` front matter, the `modes/` list, and companion file paths when a zip is uploaded, and stores the result as a JSONB manifest
- **Repositories** — PostgreSQL access through separate read (`fireread`) and write (`fireinsert`) connection pools
- **Blob storage client** — Stores and retrieves skill zip files via the shared FireFoundry storage abstraction

## Documentation

- **[Concepts](./concepts.md)** — Skills, the zip format, registry vs. custom skills, installations, access control, and how consumers resolve skills
- **[Getting Started](./getting-started.md)** — Publish a registry skill, then list and read it through the consumer API
- **[Reference](./reference.md)** — Every REST endpoint, request/response shapes, error responses, and environment variables
- **[Operations](./operations.md)** — Helm deployment, configuration, migrations, health checks, security, and troubleshooting

## Design Decisions

- **Parse at upload, not at read.** The YAML front matter and mode structure are extracted when a zip is uploaded. Consumer endpoints serve pre-parsed JSON, so runtime callers never extract zips to read a manifest. This trades a small upload cost for fast, predictable consumer latency.
- **Registry vs. custom skills are different lifecycles.** Registry skills are platform-global and versioned; custom skills are environment-scoped and managed by the environment owner. They share the same zip format but have separate management endpoints.
- **Separate from VWM.** This service owns skill data, replacing earlier duplication between VWM and the console. Consumers such as the VWM harness read skills through the consumer API.
- **REST-only.** Skill reads are infrequent compared to broker or entity calls, so REST is sufficient for both administration and consumption.

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Early release. The API surface described here is implemented and tested, but the service is new, is **disabled by default** in the `firefoundry-core` Helm chart (`skills-service.enabled: false`), and some behaviors (see [Concepts](./concepts.md#current-limitations)) are expected to evolve.

## Repository

Source code: [ff-services-skills](https://github.com/firebrandanalytics/ff-services-skills) (private)

## Related

- [Platform Services Overview](../README.md) — Overview of all FireFoundry services
- [Virtual Worker Manager](../virtual-workers/README.md) — Virtual workers consume skills at runtime
- [MCP Gateway](../mcp-gateway/README.md) — Exposes skills to agents as MCP tools
- [Platform Architecture](../../architecture.md)
