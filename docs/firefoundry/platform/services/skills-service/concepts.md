# Skills Service — Concepts

This page explains the Skills Service mental model: what a skill is, how skills are packaged and versioned, the difference between registry and custom skills, and how consumers resolve and are authorized to read skills.

## What Is a Skill?

A **skill** is a reusable package of instructions that an agent loads at runtime to extend what it knows how to do — for example, "how to query the entity graph" or "how to review a pull request". A skill is primarily markdown written for an AI model, optionally split into **modes** (focused sub-instructions such as `review` or `debug`) and accompanied by **companion files** (assets and reference documents the instructions point to).

Skills are distributed as **zip files**. The Skills Service stores the zip in blob storage and keeps a parsed **manifest** of it in PostgreSQL.

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

The files may also sit inside a single top-level folder (for example `my-skill/SKILL.md`, `my-skill/modes/review.md`); the parser recognizes both layouts. A zip without a `SKILL.md` is rejected.

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

| Front-matter field | Meaning |
|--------------------|---------|
| `name` | Skill name. If omitted, the registry entry name or custom skill name is used. |
| `description` | Short description shown in listings. Defaults to an empty string. |
| `version` | Informational version string carried in the manifest. The *stored* version is the one you supply at upload time. |
| `tags` | Tags used by the consumer API's `?tags=` filter. |
| `toolRefs` | Names of tools (for example MCP tools) the skill expects to use. |

Mode files (`modes/<mode-name>.md`) may carry their own front matter; only `description` is read from it. The mode name is the file name without `.md`. Invalid YAML is treated as "no front matter" rather than an error.

### Parse at Upload

When a zip is uploaded, the service:

1. Opens the zip and locates `SKILL.md`, every `modes/*.md` file, and every file under `assets/` or `references/`
2. Parses the front matter and body of `SKILL.md` and each mode
3. Computes a SHA-256 hash of the zip
4. Stores the zip in blob storage
5. Stores the resulting **manifest** (below), the blob path, and the hash in PostgreSQL

Consumer endpoints serve the pre-parsed manifest, so runtime callers never extract zips to read instructions. The zip itself is only opened again when a consumer asks for an individual file or downloads the whole skill.

### The Skill Manifest (SkillDefinition)

The parsed manifest has the same shape as the Agent SDK's `SkillDefinition`:

```json
{
  "name": "my-skill",
  "description": "What this skill does",
  "version": "1.0.0",
  "content": "# My Skill\n\nSkill instructions in markdown...",
  "modes": [
    { "name": "review", "description": "Review mode", "content": "..." },
    { "name": "debug", "content": "..." }
  ],
  "toolRefs": ["my-mcp-tool"],
  "tags": ["ai", "tools", "debugging"],
  "companionFiles": ["references/api.md", "assets/diagram.png"]
}
```

`content` is the body of `SKILL.md` with the front matter removed. Optional fields are omitted when empty. Consumer list and get endpoints strip `content` (including mode content) unless the caller passes `?include=content`.

## Registry Skills

**Registry skills** form the platform-level curated catalog, similar to packages in a package registry.

- A **registry entry** holds catalog metadata: a globally unique `name`, `publisher` (default `firebrand`), `description`, `category`, `tags`, and the `is_system` / `default_include` flags.
- A **registry version** is an immutable upload of a skill zip for an entry. Each version has a `version` string (unique per entry), the parsed `manifest`, the blob path, a `content_hash`, a free-form `requirements` JSON object, and a `published_at` timestamp.
- Deleting an entry cascades to its versions and to any installations of it.

Zip files for registry versions are stored at `registry/<entry-name>/<version>.zip` in blob storage.

### System Skills

A registry entry with `is_system: true` is a **system skill** — a built-in skill that ships with the platform. System skills have a `default_include` flag, toggled through `PUT /admin/system-skills/:id/default-include`. When a system skill has `default_include: true`, the consumer API labels it with `source: "system"` and it **always passes the access-grant check** — every identified caller can see it.

## Custom Skills

**Custom skills** are created by an environment's owner and live only in that environment. They never go through the platform registry.

- A custom skill has an `environment_id`, a `name` (unique within its environment), `description`, `skill_type` (default `general`), `tags`, and a `status`.
- **Status** is one of `draft` (default), `active`, or `deprecated`. Only `active` custom skills appear in consumer listings.
- A **custom version** is a zip upload for a custom skill (unique `version` per skill), with the same manifest/hash/blob fields as a registry version plus an optional `promoted_from` field reserved for promotion tracking.
- When you create a custom skill with a zip file attached, the service creates its first version as `0.1.0`.

Custom zips are stored at `custom/<environment-id>/<skill-name>/<version>.zip`.

## Environments and Installations

An **environment** is identified by a UUID. Admin endpoints take the environment as an explicit `environment_id` (query parameter or body field), so one Skills Service can manage records for several environments.

The **consumer API** does *not* take an environment parameter. Each Skills Service deployment serves the environment named by its `ENVIRONMENT_ID` setting (see [Operations](./operations.md#environment-context)).

An **installation** records that a specific registry version is installed into an environment. There is at most one installation per (environment, registry entry): installing again **replaces** the installed version.

## Resolving Skills for Consumers

### Listing (`GET /v1/skills`, `GET /v1/skills/manifest`)

The consumer listing is built from three sources, in this order:

1. **Installed registry skills** — for each installation in the service's environment, the manifest of the *installed* version (`source: "registry"`)
2. **All other registry entries with at least one version** — the manifest of the entry's most recently published version (`source: "system"` if it is a system skill with `default_include: true`, otherwise `source: "registry"`)
3. **Active custom skills** in the service's environment — the latest version's manifest (`source: "custom"`)

Registry skills are therefore discoverable even without an explicit installation; an installation pins which version is listed. The list is then filtered by the access-grant ACL (below) and, on `GET /v1/skills`, by the optional `tags` and `name` filters.

### Single-skill lookups (`GET /v1/skills/:name` and sub-paths)

Lookups by name resolve:

1. A **registry entry** with that name → its most recently published version
2. Otherwise, a **custom skill** with that name in the service's environment → its most recently created version

"Latest" means most recently uploaded, not highest semantic version. If a registry entry and a custom skill share a name, the registry entry wins.

## Access Control

Consumer access is governed by the caller's identity and by **access grants**.

### Caller Identity

Consumers identify themselves with the `X-On-Behalf-Of` header:

```
X-On-Behalf-Of: app=<application-id>; bundle=<bundle-id>; user=<user-id>
```

`app` and `bundle` are both required for the identity to be accepted; `user` is optional. Keys may appear in any order. If the header is missing or incomplete, the request has **no identity** and the consumer API **fails closed**: listings return an empty array and single-skill endpoints return `403 Access denied`.

The MCP Gateway forwards the calling agent's `X-On-Behalf-Of` header to the Skills Service automatically.

### Access Grants

An **access grant** links a skill (`skill_source` = `registry` or `custom`, plus `skill_id` = the registry entry ID or custom skill ID) to a grantee (`grantee_type` = `application`, `bot`, or `worker`, plus `grantee_id`). Grants are scoped to an `environment_id`.

The consumer ACL evaluates **application** grants for the caller's `app` ID:

| Situation | Result |
|-----------|--------|
| No identity header | Nothing is visible (fail-closed) |
| The application has **no** application grants | Every skill is visible (pass-through) |
| The application has one or more application grants | Only granted skills, plus `system` skills, are visible |

Grants for `bot` and `worker` grantees can be created and listed through the admin API but are not evaluated by the consumer API in the current release.

## Bot Dependencies

A **bot dependency** declares that a bot (by `bot_id`) depends on a skill (`skill_source` + `skill_id`), optionally with a `version_constraint` string (for example `^1.0.0`). There is one record per (environment, bot, skill); creating it again updates the constraint.

The service stores and lists these records so deployment tooling can check that a bot's required skills are present. It does not itself enforce or validate dependencies.

## Entitlements

The `/admin` and `/v1` routes are protected by the platform entitlement guard (the `skills.access` feature of the `firefoundry` product). By default the service runs in **report** mode, which logs licensing problems but continues serving; **enforce** mode refuses requests when the deployment is not entitled. Standard endpoints (`/`, `/health`, `/ready`, `/status`) are not guarded. See [Operations](./operations.md#entitlements).

## Interaction with Other Services

```
┌───────────────┐   admin API    ┌──────────────────┐
│  FF Console / │ ─────────────► │                  │ ──► PostgreSQL (skills schema)
│  platform     │                │  Skills Service  │
│  tooling      │                │                  │ ──► Blob storage (skill zips)
└───────────────┘                └──────────────────┘
                                   ▲            ▲
                         /v1 API   │            │  /v1 API
                  ┌────────────────┘            └────────────────┐
          ┌───────┴────────┐                           ┌─────────┴────────┐
          │  MCP Gateway   │  skills_list / skills_read│  VWM harness /   │
          │ (skills tools) │  / skills_read_file       │  agent bundles   │
          └────────────────┘                           └──────────────────┘
```

- **FF Console and platform tooling** use the admin API to publish, install, and govern skills.
- **The [MCP Gateway](../mcp-gateway/README.md)** exposes the consumer API as three MCP tools (`skills_list`, `skills_read`, `skills_read_file`), passing the caller's identity through.
- **[Virtual workers](../virtual-workers/README.md) and agent bundles** can call the consumer API directly, for example to download a skill zip into a workspace.

## Current Limitations

These reflect the implemented behavior of version 0.1.0:

- Single-skill lookups always use the most recently uploaded version; an installation affects only which version appears in listings.
- Single-skill lookups of custom skills do not check `status`; only listings filter to `active`.
- Access grants are matched on the application ID across all environments; `bot` and `worker` grants are recorded but not enforced.
- Bot dependencies are declarative records only.
- `promoted_from` on custom versions is stored but there is no promotion endpoint.
- The admin API performs no caller authorization of its own; restrict it at the network/gateway layer (see [Operations](./operations.md#security)).
