# Skills Service — Reference

Reference for the Skills Service REST API: the consumer API your agents call, the admin API used to manage skills, data shapes, and errors.

Most teams manage skills in the FF Console and inspect them with [`ff-cli skills svc-*`](../../../../ff-cli/skills.md), and most agents read skills through the [MCP Gateway](#mcp-tools). Call the REST API directly for automation (CI publishing), for bundle code that doesn't use MCP, and for agents that publish skills themselves ([learning loop](./concepts.md#skills-as-a-learning-loop)).

**Base URL (in-cluster):** `http://firefoundry-core-skills-service.<namespace>.svc.cluster.local:8080`

All request and response bodies are JSON unless noted. JSON request bodies are limited to 10 MB; uploaded zip files to 50 MB.

## Consumer API (`/v1`)

Read-only endpoints for agent bundles and the MCP Gateway (virtual workers reach them through the gateway's `skills_*` tools). They serve the environment the service is configured for and take no environment parameter.

### Identity Header

| Header | Required | Format |
|--------|----------|--------|
| `X-On-Behalf-Of` | Yes | `app=<id>; bundle=<id>; user=<id>` — `app` and `bundle` required, `user` optional, any order |

Without a valid identity, list endpoints return `[]` / an empty manifest and single-skill endpoints return `403`. See [Concepts — Access Control](./concepts.md#access-control).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/skills` | List skills visible to the caller |
| GET | `/v1/skills/manifest` | All visible skills as one `SkillManifest` |
| GET | `/v1/skills/:name` | Get one skill's parsed manifest |
| GET | `/v1/skills/:name/modes/:mode` | Get one mode |
| GET | `/v1/skills/:name/files` | List files in the skill |
| GET | `/v1/skills/:name/files/<path>` | Read one file from the skill |
| GET | `/v1/skills/:name/download` | Download the skill zip |

#### `GET /v1/skills`

| Query | Description |
|-------|-------------|
| `tags` | Comma-separated tags; a skill must have **all** of them (case-insensitive) |
| `name` | Glob pattern on skill name; `*` = any characters, `?` = one character (case-insensitive) |
| `include=content` | Include `content` and mode `content` (omitted by default) |

Returns an array of `SkillDefinition` objects, each with an added `source` field: `registry`, `system`, or `custom`. Not paginated.

#### `GET /v1/skills/manifest`

Query: `include=content` (optional). Applies access grants but not the `tags` / `name` filters.

```json
{ "skills": [ /* SkillDefinition */ ], "generatedAt": "2026-09-26T12:00:00.000Z" }
```

#### `GET /v1/skills/:name`

Query: `include=content` (optional). Returns one `SkillDefinition` (without `source`) for the most recently uploaded version.

#### `GET /v1/skills/:name/modes/:mode`

Returns `{"name": "...", "description": "...", "content": "..."}`.

#### `GET /v1/skills/:name/files`

```json
{
  "skill": "ticket-triage",
  "files": [
    { "path": "SKILL.md", "compressedSize": 180, "uncompressedSize": 240 },
    { "path": "references/routing.md", "compressedSize": 60, "uncompressedSize": 95 }
  ]
}
```

Paths are exactly as they appear in the zip, including any top-level folder.

#### `GET /v1/skills/:name/files/<path>`

Returns the raw file bytes. `<path>` may contain slashes and must match a path from the file listing exactly. Content type is chosen by extension:

| Extension | Content-Type |
|-----------|--------------|
| `md` | `text/markdown; charset=utf-8` |
| `txt` | `text/plain; charset=utf-8` |
| `json` | `application/json; charset=utf-8` |
| `yaml`, `yml` | `text/yaml; charset=utf-8` |
| `js` | `application/javascript; charset=utf-8` |
| `ts` | `application/typescript; charset=utf-8` |
| `png` / `jpg`, `jpeg` / `gif` / `svg` | `image/png` / `image/jpeg` / `image/gif` / `image/svg+xml` |
| `pdf` | `application/pdf` |
| anything else | `application/octet-stream` |

#### `GET /v1/skills/:name/download`

Returns the zip with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="<name>-<version>.zip"`.

### SkillDefinition

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Skill name |
| `description` | string | Description |
| `version` | string? | Version from front matter |
| `content` | string | `SKILL.md` body (omitted unless `include=content`) |
| `modes` | `{name, description?, content}[]`? | Modes (`content` omitted unless `include=content`) |
| `toolRefs` | string[]? | Referenced tools |
| `tags` | string[]? | Tags |
| `companionFiles` | string[]? | Paths under `assets/` and `references/` |

### MCP Tools

The [MCP Gateway](../mcp-gateway/tools.md#skills-adapter) exposes the consumer API as `skills_list` (`GET /v1/skills`), `skills_read` (`GET /v1/skills/:name?include=content`), and `skills_read_file` (`GET /v1/skills/:name/files/<path>`), forwarding the caller's `X-On-Behalf-Of` header. There are no MCP tools for the admin API. For using these from bots, bundle code, and virtual workers, see [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md).

## Admin API (`/admin`)

Endpoints for managing skills in your environment: custom skills, installations, access grants, and bot dependencies, plus the registry catalog. The admin API does not read `X-On-Behalf-Of` and performs no per-caller authorization. Call it only from trusted tooling, such as CI scripts or a validated publishing step in your own agent bundle.

For an agent publishing what it learned, the relevant calls are `POST /admin/custom` (new skill, optionally with its first zip), `POST /admin/custom/:id/versions` (new version), `PUT /admin/custom/:id` (status), and `POST /admin/access-grants` (make a new skill visible to an app that uses grants).

### Custom Skills

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/custom?environment_id=<uuid>` | List custom skills in an environment, ordered by name. `environment_id` is required. | `200` custom skill[] |
| POST | `/admin/custom` | Create a custom skill. JSON body, or multipart with optional `file` + `metadata` JSON. | `201` custom skill |
| GET | `/admin/custom/:id` | Get a custom skill with its versions (`versions` array) | `200` |
| PUT | `/admin/custom/:id` | Update metadata or status (partial; `environment_id` cannot change) | `200` custom skill |
| DELETE | `/admin/custom/:id` | Delete a custom skill and its versions | `204` |
| GET | `/admin/custom/:id/versions` | List versions, newest first | `200` version[] |
| POST | `/admin/custom/:id/versions` | Upload a new version (multipart `file` + `metadata` `{"version":"..."}`) | `201` version |

**Create body / metadata:**

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `environment_id` | UUID | Yes | — | Owning environment |
| `name` | string (1–100) | Yes | — | Unique within the environment |
| `description` | string | No | `null` | |
| `skill_type` | string (≤50) | No | `general` | |
| `status` | `draft` \| `active` \| `deprecated` | No | `draft` | Only `active` skills are listed to consumers |
| `tags` | string[] | No | `[]` | |

If a `file` is attached to `POST /admin/custom`, an initial version `0.1.0` is created from it. The response is the custom skill object (without versions).

**Custom skill object:**

```json
{
  "id": "uuid",
  "environment_id": "uuid",
  "name": "ticket-triage",
  "description": "Support ticket triage",
  "skill_type": "general",
  "status": "active",
  "tags": ["support"],
  "created_at": "...",
  "updated_at": "..."
}
```

**Custom version object:** `id`, `skill_id`, `version`, `manifest` (a `SkillDefinition`), `blob_id` (storage reference), `content_hash` (hash of the uploaded zip), `promoted_from` (reserved; `null`), `created_at`.

### Version Uploads (multipart/form-data)

Applies to `POST /admin/custom/:id/versions` and `POST /admin/registry/:id/versions`.

| Part | Required | Description |
|------|----------|-------------|
| `file` | Yes | The skill zip (≤ 50 MB). Must contain `SKILL.md`. |
| `metadata` | No* | JSON string: `{"version": "1.0.0"}` (registry uploads also accept `"requirements": {...}`) |

\* If `metadata` is omitted, `version` (and `requirements`) are read from plain form fields. `version` (1–50 chars) is required and must be unique for the skill or entry.

### Installations

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/installations?environment_id=<uuid>` | List installations in an environment; each row includes `entry_name` and `version` | `200` |
| POST | `/admin/installations` | Install a registry version into an environment (replaces any existing installation of that entry) | `201` installation |
| DELETE | `/admin/installations/:id` | Uninstall | `204` |

**Create body:** `environment_id` (UUID), `entry_id` (UUID), `version_id` (UUID) — all required.

**Installation object:** `id`, `environment_id`, `entry_id`, `version_id`, `installed_at`, `updated_at`.

### Access Grants

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/access-grants?environment_id=<uuid>` | List grants in an environment, newest first | `200` grant[] |
| POST | `/admin/access-grants` | Create a grant | `201` grant |
| DELETE | `/admin/access-grants/:id` | Remove a grant | `204` |

**Create body (all required):**

| Field | Type | Values |
|-------|------|--------|
| `environment_id` | UUID | |
| `skill_source` | enum | `registry`, `custom` |
| `skill_id` | UUID | Registry entry ID or custom skill ID |
| `grantee_type` | enum | `application`, `bot`, `worker` (only `application` affects consumer visibility today) |
| `grantee_id` | UUID | |

Creating a grant that already exists is a no-op: the response is `201` with an empty body.

**Grant object:** `id`, `environment_id`, `skill_source`, `skill_id`, `grantee_type`, `grantee_id`, `granted_at`.

### Bot Dependencies

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/bot-dependencies?environment_id=<uuid>` | List dependencies in an environment, newest first | `200` dependency[] |
| POST | `/admin/bot-dependencies` | Create a dependency (re-creating updates `version_constraint`) | `201` dependency |
| DELETE | `/admin/bot-dependencies/:id` | Remove a dependency | `204` |

**Create body:** `environment_id` (UUID), `bot_id` (UUID), `skill_source` (`registry` \| `custom`), `skill_id` (UUID) — required; `version_constraint` (string ≤ 100) — optional.

**Dependency object:** `id`, `environment_id`, `bot_id`, `skill_source`, `skill_id`, `version_constraint`, `created_at`.

### Registry Catalog

Use these to browse the catalog and find IDs for installations and grants. Creating entries and uploading versions publishes to the platform-wide catalog.

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/registry?page=1&limit=20` | List entries, ordered by name. `page` ≥ 1 (default 1); `limit` 1–100 (default 20). | `200` paginated result |
| GET | `/admin/registry/:id` | Get an entry | `200` entry |
| GET | `/admin/registry/:id/versions` | List versions, newest first | `200` version[] |
| POST | `/admin/registry` | Create an entry | `201` entry |
| PUT | `/admin/registry/:id` | Update entry metadata (partial) | `200` entry |
| DELETE | `/admin/registry/:id` | Delete an entry, its versions, and its installations | `204` |
| POST | `/admin/registry/:id/versions` | Upload a new version (see [Version Uploads](#version-uploads-multipartform-data)) | `201` version |
| GET | `/admin/system-skills` | List system skills | `200` entry[] |
| PUT | `/admin/system-skills/:id/default-include` | Body `{"default_include": true}` (must be a boolean) | `200` entry |

**Entry fields:** `name` (string 1–100, globally unique, required on create), `publisher` (default `firebrand`), `description`, `category` (≤50), `tags` (string[]), `is_system` (boolean, default `false`), `default_include` (boolean, default `false`).

**Entry object:** the fields above plus `id`, `created_at`, `updated_at`.

**Registry version object:** `id`, `entry_id`, `version`, `manifest`, `blob_id`, `content_hash`, `requirements` (free-form object), `published_at`.

**Paginated result:**

```json
{ "data": [ /* entries */ ], "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
```

## Health Endpoints

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{"status":"healthy","timestamp":"<ISO-8601>"}` |
| GET | `/ready` | `{"ready":true}` |
| GET | `/status` | `{"service":"ff-services-skills","version":"0.1.0","uptime":<seconds>,"environment":"..."}` |

## Error Responses

Errors are returned as JSON with an `error` field.

| Status | Body | When |
|--------|------|------|
| `400` | `{"error":"Validation Error","details":[...]}` | Request body or query failed validation; `details` lists the failing fields |
| `400` | `{"error":"environment_id query parameter required"}` | Admin list endpoints called without `environment_id` |
| `400` | `{"error":"No file uploaded"}` | Version upload without a `file` part |
| `400` | `{"error":"default_include must be a boolean"}` | Bad system-skill toggle body |
| `400` | `{"error":"File path required"}` | Empty file path on the file-read endpoint |
| `403` | `{"error":"Access denied"}` | Consumer has no identity, or its application has grants that don't include this skill |
| `404` | `{"error":"Custom skill not found"}`, `"Registry entry not found"`, `"Installation not found"`, `"System skill not found"`, `"Access grant not found"`, `"Bot dependency not found"` | Admin resource missing |
| `404` | `{"error":"Skill not found"}`, `"Skill has no modes"`, `"Mode '<mode>' not found"`, `"File '<path>' not found in skill"` | Consumer resource missing |
| `404` | `{"error":"Not Found"}` | Unknown route |
| `500` | `{"error":"Failed to download skill blob"}` | The skill zip could not be retrieved |
| `500` | `{"error":"Internal Server Error"}` | Any other failure |

Several client mistakes currently return a generic `500` rather than a `4xx`. Check for these first when an admin call fails with `500`:

- The zip is invalid or has no `SKILL.md` at its root (or under one top-level folder)
- The version string already exists for that skill, or the skill/entry name already exists
- The `metadata` part is not valid JSON
- The file exceeds 50 MB
- The target registry entry ID does not exist
- Blob storage is not configured in your environment
