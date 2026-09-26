# Skills Service

## Overview

The Skills Service stores and serves FireFoundry **skills**: reusable instruction packages (a `SKILL.md` file plus optional modes, assets, and reference documents) that your agents load at runtime to extend what they know how to do. You upload a skill as a zip, the service parses it once, and your agents read the parsed instructions — or individual files from the skill — on demand.

## Purpose and Role in Platform

Skills let you keep domain know-how ("how to triage a support ticket", "our code review checklist", "how to query our entity graph") out of your bot prompts and code, version it independently, and share it across the agents in your application. The Skills Service is where those skills live for your environment.

As an app builder you:

- **Manage skills**, usually from the **FF Console**: upload custom skills with versions and a `draft` / `active` / `deprecated` status, install platform catalog (registry) skills, and grant skills to your application. Use `ff-cli skills svc-*` to check what an application sees, and the REST admin API for automation.
- **Let agents load skills at runtime**, mostly through the [MCP Gateway](../mcp-gateway/README.md) tools `skills_list`, `skills_read`, and `skills_read_file`. The Agent SDK has utilities for rendering skills into bot prompts (see [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md)).
- **Let agents improve skills**: an agent can publish a procedure that worked as a new skill or a new version of an existing one, and every later agent that reads the skill uses the improved version. See [Agents That Learn](#agents-that-learn).

## Key Features

- **Agent learning loop**: Agents can create skills and publish new versions at runtime, turning one run's successful procedure into shared, versioned know-how for later runs
- **Custom skills**: Skills you create for your environment, versioned per upload and activated when ready
- **Registry skills**: A platform-level catalog of curated skills, each with immutable versions you can install
- **Installations**: Pin which registry version your environment lists
- **Access grants**: Restrict which skills a given application can see
- **Pre-parsed manifests**: Consumers get JSON (front matter, content, modes, companion file list); no zip handling at runtime
- **File-level reads**: Read one file from a skill (for example `references/api.md`) without downloading the whole zip
- **System skills**: Platform-provided skills that can be made visible to every caller
- **Bot dependencies**: Record that a bot depends on a skill, with an optional version constraint
- **MCP access**: Agents that speak MCP list and read skills through the MCP Gateway

## Agents That Learn

Skills don't have to be written only by people. A capture step in your agent bundle can distill a procedure that just worked (a successful ticket resolution, a working data-cleanup recipe) into a `SKILL.md` and upload it as a **new version** of a skill. Reads always return the most recently uploaded version, so the next agent that calls `skills_read` uses the improved instructions, with no redeploy and no prompt change.

- Agents **read** skills through the MCP Gateway, but the gateway's skills tools are read-only. Agents **write** skills with the Skills Service admin API (`POST /admin/custom`, `POST /admin/custom/:id/versions`).
- A new version of an active skill takes effect immediately. If you want review first, have agents write to a separate candidate skill and publish reviewed content from the FF Console.
- A newly created skill is invisible to an application that uses access grants until it is granted.

The [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md#the-learning-loop-agents-that-write-skills) guide has a worked example and guardrails.

## Architecture Overview

```
  People                                    Your agent bundle / virtual workers
  FF Console · CI scripts                   bots · bundle code · CLI agents
          │                                   │ read                     │ write (learning loop)
          │ manage: upload · version ·        │ skills_list              │
          │ activate · install · grant        ▼ skills_read · skills_read_file
          │                             ┌──────────────┐                 │
          │                             │ MCP Gateway  │                 │
          │                             │ (forwards    │                 │
          │                             │  identity)   │                 │
          │ /admin API                  └──────┬───────┘                 │ /admin API
          ▼                                    │ /v1 API                 ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                            Skills Service                                │
  │        skills · versions · installations · access grants                 │
  └─────────────────────────────────────────────────────────────────────────┘
```

- The **admin API** (`/admin`) creates, versions, activates, installs, and grants skills. People usually do this through the FF Console; scripts and learning agents call the API directly.
- The **consumer API** (`/v1`) is read-only. Every call carries the caller's `X-On-Behalf-Of` identity, and results are filtered by your application's grants.
- The **MCP Gateway** wraps the consumer API as MCP tools and forwards the agent's identity. This is how most agents read skills.

## Documentation

- **[Concepts](./concepts.md)**: What a skill is, the zip format, custom vs. registry skills, versions, installations, grants, how agents consume skills, and the learning loop
- **[Getting Started](./getting-started.md)**: Author a skill, publish and grant it, and read it the way an agent does
- **[Reference](./reference.md)**: Admin and consumer endpoints, request/response shapes, and errors
- **[Operations](./operations.md)**: Enabling the service in your environment, verifying access from a bundle, limits, and troubleshooting
- **[Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md)** (Agent SDK): Loading skills from bots, bundle code, and virtual workers; SDK utilities; agents that publish skills
- **[ff-cli skills commands](../../../../ff-cli/skills.md)**: Inspect skills from the command line

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Early release. The API described here is implemented, but the service is **disabled by default** in the `firefoundry-core` Helm chart (`skills-service.enabled: false`), and some behaviors (see [Current Limitations](./concepts.md#current-limitations)) are expected to evolve.

## Repository

Source code: [ff-services-skills](https://github.com/firebrandanalytics/ff-services-skills) (private)

## Related

- [Platform Services Overview](../README.md) — Overview of all FireFoundry services
- [MCP Gateway](../mcp-gateway/README.md) — Exposes skills to agents as MCP tools
- [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md) — Agent SDK support for loading and publishing skills
- [Virtual Worker Manager](../virtual-workers/README.md) — Virtual workers consume skills at runtime through the MCP Gateway
- [Platform Architecture](../../architecture.md)
