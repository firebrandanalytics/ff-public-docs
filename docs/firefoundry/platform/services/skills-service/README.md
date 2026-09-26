# Skills Service

## Overview

The Skills Service stores and serves FireFoundry **skills**: reusable instruction packages (a `SKILL.md` file plus optional modes, assets, and reference documents) that your agents load at runtime to extend what they know how to do. You upload a skill as a zip, the service parses it once, and your agents read the parsed instructions — or individual files from the skill — on demand.

## Purpose and Role in Platform

Skills let you keep domain know-how ("how to triage a support ticket", "our code review checklist", "how to query our entity graph") out of your bot prompts and code, version it independently, and share it across the agents in your application. The Skills Service is where those skills live for your environment.

As an app builder you use it to:

- **Author and upload** custom skills for your application, with versions and a `draft` / `active` / `deprecated` status
- **Install** a specific version of a platform catalog (registry) skill into your environment
- **Grant** skills to your application so its agents see exactly the skills you intend
- **Discover and read** skills at runtime from your agent bundle, either through the REST consumer API or through the [MCP Gateway](../mcp-gateway/README.md) tools `skills_list`, `skills_read`, and `skills_read_file`

## Key Features

- **Custom skills** — Skills you create for your environment, versioned per upload and activated when ready
- **Registry skills** — A platform-level catalog of curated skills, each with immutable versions you can install
- **Installations** — Pin which registry version your environment lists
- **Access grants** — Restrict which skills a given application can see
- **Pre-parsed manifests** — Consumers get JSON (front matter, content, modes, companion file list); no zip handling at runtime
- **File-level reads** — Read one file from a skill (for example `references/api.md`) without downloading the whole zip
- **System skills** — Platform-provided skills that can be made visible to every caller
- **Bot dependencies** — Record that a bot depends on a skill, with an optional version constraint
- **MCP access** — Agents that speak MCP can list and read skills through the MCP Gateway

## Architecture Overview

```
  Your team / tooling                         Your agent bundle
  (FF Console, CI scripts)                    (bots, virtual workers)
          │                                        │          │
          │ /admin API                             │ /v1 API  │ MCP tools
          │ upload · version · install · grant     │          │ skills_list / skills_read /
          ▼                                        │          ▼ skills_read_file
  ┌─────────────────────────────────┐              │   ┌──────────────┐
  │         Skills Service          │◄─────────────┘   │ MCP Gateway  │
  │  skills · versions · manifests  │◄─────────────────┤ (forwards    │
  │  installations · access grants  │   /v1 API        │ X-On-Behalf-Of)
  └─────────────────────────────────┘                  └──────────────┘
```

- The **admin API** (`/admin`) is how your team manages skills: upload, version, activate, install, and grant.
- The **consumer API** (`/v1`) is read-only and is what your agents call. Every call carries the caller's `X-On-Behalf-Of` identity, and results are filtered by your application's grants.
- The **MCP Gateway** wraps the consumer API as MCP tools and forwards the agent's identity automatically.

## Documentation

- **[Concepts](./concepts.md)** — What a skill is, the zip format, custom vs. registry skills, versions, installations, grants, and how agents resolve skills
- **[Getting Started](./getting-started.md)** — Author a custom skill, upload it, grant it to your app, and read it the way an agent does
- **[Reference](./reference.md)** — Admin and consumer endpoints, request/response shapes, and errors
- **[Operations](./operations.md)** — Enabling the service in your environment, verifying access from a bundle, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Early release. The API described here is implemented, but the service is **disabled by default** in the `firefoundry-core` Helm chart (`skills-service.enabled: false`), and some behaviors (see [Current Limitations](./concepts.md#current-limitations)) are expected to evolve.

## Repository

Source code: [ff-services-skills](https://github.com/firebrandanalytics/ff-services-skills) (private)

## Related

- [Platform Services Overview](../README.md) — Overview of all FireFoundry services
- [MCP Gateway](../mcp-gateway/README.md) — Exposes skills to agents as MCP tools
- [Virtual Worker Manager](../virtual-workers/README.md) — Virtual workers consume skills at runtime
- [Platform Architecture](../../architecture.md)
