# Skills Service — Concepts

This page explains what a skill is, how you package and version one, the difference between custom and registry skills, how your agents discover skills and are authorized to read them, and how agents can publish skills themselves.

## What Is a Skill?

A **skill** is a reusable package of instructions that an agent loads at runtime — for example "how to query the entity graph" or "how to review a pull request". It is primarily markdown written for an AI model, optionally split into **modes** (focused sub-instructions such as `review` or `debug`) and accompanied by **companion files** (assets and reference documents the instructions point to).

Typical ways to use skills in an app:

- **Keep prompts small.** Put long procedures and policies in a skill; the bot lists available skills and reads only the one it needs.
- **Share know-how across bots.** Several bots in one bundle can read the same skill instead of duplicating instructions.
- **Change behavior without redeploying.** Upload a new skill version; agents pick it up on their next read.
- **Let agents learn.** Agents can publish a new skill version when they find a procedure that works, so later runs start from it. See [Skills as a Learning Loop](#skills-as-a-learning-loop).
- **Progressive disclosure.** Keep `SKILL.md` short and put detail in `references/` files the agent reads with a file-level call only when needed.

## Skill Zip Format

Skills are uploaded as zip files:

```
my-skill.zip
├── SKILL.md           # Required — with optional YAML front matter
├── modes/             # Optional — sub-modes (review, debug, etc.)
│   ├── review.md
│   └── debug.md
├── assets/            # Optional — companion files (images, samples)
└── references/        # Optional — reference docs the skill links to
```

The files may also sit inside a single top-level folder (for example `my-skill/SKILL.md`). A zip without a `SKILL.md` is rejected.

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
| `name` | Skill name. If omitted, the name of the custom skill or registry entry is used. |
| `description` | Short description shown in listings. Write it so an agent can decide whether to read the skill. |
| `version` | Informational version carried in the manifest. The version the service tracks is the one you supply at upload. |
| `tags` | Tags agents can filter on (`?tags=` / the `tags` MCP argument). |
| `toolRefs` | Names of tools (for example MCP tools) the skill expects to use. |

Mode files (`modes/<mode-name>.md`) may carry their own front matter; only `description` is read. The mode name is the file name without `.md`. Invalid YAML is treated as "no front matter" rather than an error.

### The Skill Manifest

The service parses the zip when you upload it. Agents receive this parsed JSON (a `SkillDefinition`, the same shape the Agent SDK uses) rather than the zip:

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

`content` is the body of `SKILL.md` without front matter. Optional fields are omitted when empty. Consumer list and get endpoints omit `content` (including mode content) unless the caller passes `?include=content`, so listings stay small.

## Custom Skills

**Custom skills** are the skills you (or your agents) author for your environment. They live only in that environment. People usually manage them in the FF Console; automation and agents use the admin API.

- A custom skill has an `environment_id`, a `name` (unique within the environment), `description`, `skill_type` (default `general`), `tags`, and a `status`.
- **Status** is `draft` (default), `active`, or `deprecated`. Only `active` custom skills appear in consumer listings, so you can upload and review a draft before agents see it.
- Each upload creates a **version** with its own version string (unique per skill). If you attach a zip when creating the skill, its first version is `0.1.0`.

## Registry Skills

**Registry skills** form the platform-level catalog, similar to packages in a package registry.

- A **registry entry** holds catalog metadata: a globally unique `name`, `publisher`, `description`, `category`, `tags`, and the system-skill flags.
- A **registry version** is an immutable upload of a skill zip for an entry, with a version string unique within the entry.

### System Skills

A registry entry marked as a **system skill** ships with the platform. When a system skill's `default_include` flag is on, consumers see it labelled `source: "system"` and it is visible to **every** identified caller, regardless of access grants.

## Environments and Installations

Each Skills Service deployment serves one **environment** (identified by a UUID) on its consumer API. Agents never pass an environment — they see the environment the service is configured for (see [Operations](./operations.md#enabling-the-service)). Admin calls take the environment explicitly as `environment_id`; use the same UUID.

An **installation** pins a specific registry version into your environment. There is at most one installation per registry entry per environment; installing again replaces the pinned version.

## How Agents Resolve Skills

### Listings (`GET /v1/skills`, `GET /v1/skills/manifest`, `skills_list`)

A listing combines:

1. **Installed registry skills** — at the installed version (`source: "registry"`)
2. **Other registry skills** that have at least one version — at their most recently published version (`source: "system"` for system skills with `default_include`, otherwise `source: "registry"`)
3. **Active custom skills** in your environment — at their latest version (`source: "custom"`)

Registry skills are therefore discoverable even without an installation; installing pins which version is listed. The result is then filtered by your application's access grants and, for `GET /v1/skills`, by the optional `tags` and `name` filters.

### Single-skill reads (`GET /v1/skills/:name`, `skills_read`, `skills_read_file`)

Reads by name resolve to:

1. A registry entry with that name — its most recently published version
2. Otherwise, a custom skill with that name in your environment — its most recently uploaded version

"Latest" means most recently uploaded, not the highest semantic version. If a registry skill and a custom skill share a name, the registry skill wins — give custom skills distinctive names.

## Access Control

### Caller Identity (`X-On-Behalf-Of`)

Every consumer call identifies the caller:

```
X-On-Behalf-Of: app=<application-id>; bundle=<bundle-id>; user=<user-id>
```

`app` and `bundle` are required; `user` is optional; keys may appear in any order. Without a valid identity the consumer API **fails closed**: listings are empty and single-skill reads return `403 Access denied`.

The MCP Gateway forwards the calling agent's `X-On-Behalf-Of` header automatically. If your bundle calls the REST API directly, set the header yourself.

### Access Grants

An **access grant** gives a skill (`skill_source` = `registry` or `custom`, plus `skill_id`) to a grantee (`grantee_type` + `grantee_id`) in an environment. Consumer visibility is decided by **application** grants for the caller's `app`:

| Situation | What the agent sees |
|-----------|---------------------|
| No identity header | Nothing |
| The application has **no** application grants | Every skill (pass-through) |
| The application has one or more application grants | Only granted skills, plus system skills with `default_include` |

Design implication: as soon as you grant your application its first skill, every other skill disappears from its view. Grant everything the app needs together.

Grants for `bot` and `worker` grantees can be recorded but do not affect what consumers see in the current release.

## Bot Dependencies

A **bot dependency** records that a bot depends on a skill, optionally with a `version_constraint` such as `^1.0.0`. There is one record per bot and skill; creating it again updates the constraint. These records are informational — useful for your own deployment checks — and the service does not enforce them.

## How Agents Consume Skills

| Consumer | How it reads skills |
|----------|---------------------|
| Bots (LLM-driven) | Call the [MCP Gateway](../mcp-gateway/tools.md#skills-adapter) tools `skills_list`, `skills_read`, `skills_read_file`; the model picks the skill it needs |
| Agent bundle code | Calls the same gateway tools (or `/v1` directly) and renders skills into prompts with Agent SDK utilities |
| Virtual workers | The CLI agent calls the gateway tools when the worker's MCP connections include the gateway |
| People and scripts | FF Console; `ff-cli skills svc-*` to see what an application sees |

The MCP Gateway is the usual path: it forwards the caller's identity so grants apply, and it returns the same `SkillDefinition` JSON as `/v1`. How to wire each option into a bundle, and which SDK utilities help, is covered in the Agent SDK guide [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md).

## Skills as a Learning Loop

Because a skill is versioned data rather than code, an agent can improve it:

1. An agent reads a skill (`skills_read`) and does its work.
2. When the outcome is confirmed good, a capture step in your bundle distills what worked into an updated `SKILL.md`.
3. The bundle uploads it as a new version (`POST /admin/custom/:id/versions`), or as a new custom skill (`POST /admin/custom`).
4. Every later read returns the new version.

Design points:

- **Writes use the admin API.** The MCP Gateway's skills tools are read-only; there is no MCP tool for creating or updating skills.
- **New versions are live immediately.** Versions have no draft stage. To keep a human in the loop, write to a separate candidate skill that your application is not granted, and publish reviewed content from the FF Console.
- **New skills need a grant** if your application uses access grants (see [Access Grants](#access-grants)).
- **Rollback is a re-upload.** There is no way to re-activate an old version; keep the previous content so you can upload it again.
- **Guard the write path.** The admin API has no per-caller authorization (see [Operations — Security](./operations.md#security)); keep skill writes in a deterministic, validated step of your bundle rather than exposing them to the model as a free-form tool.

A complete worked example is in [Skills in Agent Bundles — The Learning Loop](../../../sdk/agent_sdk/feature_guides/skills.md#the-learning-loop-agents-that-write-skills).

## Current Limitations

Behavior of version 0.1.0 to design around:

- Single-skill reads always return the most recently uploaded version; an installation only affects which version appears in listings.
- Single-skill reads of a custom skill do not check its `status`; only listings hide `draft` and `deprecated` skills.
- Application grants apply to the application ID regardless of environment; `bot` and `worker` grants are not enforced.
- Bot dependencies are records only.
- There is no endpoint to promote a custom skill into the registry.
- The admin API has no per-caller authorization; only trusted tooling in your environment should be able to reach it (see [Operations](./operations.md#security)).
