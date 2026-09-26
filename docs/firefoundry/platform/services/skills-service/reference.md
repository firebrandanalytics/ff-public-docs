# Skills Service — Reference

Complete reference for the Skills Service REST API, data shapes, error responses, and configuration.

**Base URL (in-cluster):** `http://firefoundry-core-skills-service.<namespace>.svc.cluster.local:8080`

All request and response bodies are JSON unless noted. JSON request bodies are limited to 10 MB; uploaded zip files to 50 MB.

## Standard Endpoints

These are not subject to the entitlement guard.

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| GET | `/` | Service info | `{"service":"ff-services-skills","description":"FireFoundry Skill Management Service","version":"0.1.0"}` |
| GET | `/health` | Liveness probe | `{"status":"healthy","timestamp":"<ISO-8601>"}` |
| GET | `/ready` | Readiness probe (static; does not check the database) | `{"ready":true}` |
| GET | `/status` | Service status and uptime | `{"service":"...","version":"0.1.0","uptime":<seconds>,"environment":"<NODE_ENV>"}` |

## Admin API (`/admin`)

Management endpoints used by the FF Console and platform tooling. The admin API does not read `X-On-Behalf-Of` and performs no per-caller authorization.

### Registry Entries

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/registry?page=1&limit=20` | List entries, ordered by name. `page` ≥ 1 (default 1); `limit` 1–100 (default 20). | `200` paginated result |
| POST | `/admin/registry` | Create an entry | `201` entry |
| GET | `/admin/registry/:id` | Get an entry | `200` entry |
| PUT | `/admin/registry/:id` | Update entry metadata (partial) | `200` entry |
| DELETE | `/admin/registry/:id` | Delete an entry; cascades to its versions and installations | `204` |

**Create / update body** (`PUT` accepts any subset):

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `name` | string (1–100) | Yes (create) | — | Globally unique |
| `publisher` | string (≤100) | No | `firebrand` | |
| `description` | string | No | `null` | |
| `category` | string (≤50) | No | `null` | |
| `tags` | string[] | No | `[]` | |
| `is_system` | boolean | No | `false` | Marks a system skill |
| `default_include` | boolean | No | `false` | See [System Skills](#system-skills) |

**Entry object:**

```json
{
  "id": "uuid",
  "name": "hello-skill",
  "publisher": "firebrand",
  "description": "Demo greeting skill",
  "category": "demo",
  "tags": ["demo"],
  "is_system": false,
  "default_include": false,
  "created_at": "2026-09-26T12:00:00.000Z",
  "updated_at": "2026-09-26T12:00:00.000Z"
}
```

**Paginated result:**

```json
{ "data": [ /* entries */ ], "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
```

### Registry Versions

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/registry/:id/versions` | List versions for an entry, newest first | `200` version[] |
| POST | `/admin/registry/:id/versions` | Upload a new version (multipart) | `201` version |

**Upload (multipart/form-data):**

| Part | Required | Description |
|------|----------|-------------|
| `file` | Yes | The skill zip (≤ 50 MB). Must contain `SKILL.md`. |
| `metadata` | No* | JSON string: `{"version": "1.0.0", "requirements": {...}}` |

\* If `metadata` is omitted, `version` and `requirements` are read from plain form fields instead. `version` (1–50 chars) is required either way and must be unique for the entry; `requirements` is a free-form object (default `{}`).

**Version object:**

```json
{
  "id": "uuid",
  "entry_id": "uuid",
  "version": "1.0.0",
  "manifest": { /* SkillDefinition */ },
  "blob_id": "registry/hello-skill/1.0.0.zip",
  "content_hash": "<sha256 hex>",
  "requirements": {},
  "published_at": "2026-09-26T12:01:00.000Z"
}
```

### Custom Skills

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/custom?environment_id=<uuid>` | List custom skills in an environment, ordered by name. `environment_id` is required. | `200` custom skill[] |
| POST | `/admin/custom` | Create a custom skill. JSON body, or multipart with optional `file` + `metadata` JSON. | `201` custom skill |
| GET | `/admin/custom/:id` | Get a custom skill with its versions (`versions` array) | `200` |
| PUT | `/admin/custom/:id` | Update metadata (partial; `environment_id` cannot change) | `200` custom skill |
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
  "name": "team-greeting",
  "description": null,
  "skill_type": "general",
  "status": "active",
  "tags": ["demo"],
  "created_at": "...",
  "updated_at": "..."
}
```

**Custom version object:** `id`, `skill_id`, `version`, `manifest`, `blob_id` (`custom/<environment-id>/<name>/<version>.zip`), `content_hash`, `promoted_from` (object or `null`), `created_at`.

### Installations

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/installations?environment_id=<uuid>` | List installations in an environment. Each row also includes `entry_name` and `version`. | `200` |
| POST | `/admin/installations` | Install a registry version into an environment (upsert per environment + entry) | `201` installation |
| DELETE | `/admin/installations/:id` | Uninstall | `204` |

**Create body:** `environment_id` (UUID), `entry_id` (UUID), `version_id` (UUID) — all required.

**Installation object:** `id`, `environment_id`, `entry_id`, `version_id`, `installed_at`, `updated_at`.

### System Skills

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/system-skills` | List registry entries with `is_system = true` | `200` entry[] |
| PUT | `/admin/system-skills/:id/default-include` | Set `default_include`. Body: `{"default_include": true}` (must be a boolean) | `200` entry |

`PUT` returns `404 System skill not found` if the entry does not exist or is not a system skill.

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
| `grantee_type` | enum | `application`, `bot`, `worker` |
| `grantee_id` | UUID | |

Creating a grant that already exists is a no-op: the response is `201` with an empty body.

**Grant object:** `id`, `environment_id`, `skill_source`, `skill_id`, `grantee_type`, `grantee_id`, `granted_at`.

### Bot Dependencies

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| GET | `/admin/bot-dependencies?environment_id=<uuid>` | List dependencies in an environment, newest first | `200` dependency[] |
| POST | `/admin/bot-dependencies` | Create a dependency (upsert: re-creating updates `version_constraint`) | `201` dependency |
| DELETE | `/admin/bot-dependencies/:id` | Remove a dependency | `204` |

**Create body:** `environment_id` (UUID), `bot_id` (UUID), `skill_source` (`registry` \| `custom`), `skill_id` (UUID) — required; `version_constraint` (string ≤ 100) — optional.

**Dependency object:** `id`, `environment_id`, `bot_id`, `skill_source`, `skill_id`, `version_constraint`, `created_at`.

## Consumer API (`/v1`)

Read-only endpoints for agent bundles, the VWM harness, and the MCP Gateway. The environment is the service's configured `ENVIRONMENT_ID`; these endpoints take no environment parameter.

### Identity Header

| Header | Required | Format |
|--------|----------|--------|
| `X-On-Behalf-Of` | Yes (effectively) | `app=<id>; bundle=<id>; user=<id>` — `app` and `bundle` required, `user` optional, any order |

Without a valid identity, list endpoints return `[]` / an empty manifest and single-skill endpoints return `403`. See [Concepts — Access Control](./concepts.md#access-control).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/skills` | List skills available in the environment |
| GET | `/v1/skills/manifest` | Full `SkillManifest` for the environment |
| GET | `/v1/skills/:name` | Get one skill's parsed manifest |
| GET | `/v1/skills/:name/modes/:mode` | Get one mode |
| GET | `/v1/skills/:name/files` | List files in the skill zip |
| GET | `/v1/skills/:name/files/<path>` | Read one file from the skill zip |
| GET | `/v1/skills/:name/download` | Download the skill zip |

#### `GET /v1/skills`

| Query | Description |
|-------|-------------|
| `tags` | Comma-separated tags; a skill must have **all** of them (case-insensitive) |
| `name` | Glob pattern on skill name; `*` = any characters, `?` = one character (case-insensitive) |
| `include=content` | Include `content` and mode `content` (omitted by default) |

Returns an array of `SkillDefinition` objects, each with an added `source` field: `registry`, `system`, or `custom`.

#### `GET /v1/skills/manifest`

Query: `include=content` (optional). Applies the ACL but not the `tags` / `name` filters.

```json
{ "skills": [ /* SkillDefinition */ ], "generatedAt": "2026-09-26T12:00:00.000Z" }
```

#### `GET /v1/skills/:name`

Query: `include=content` (optional). Returns a single `SkillDefinition` (without `source`) for the most recently uploaded version.

#### `GET /v1/skills/:name/modes/:mode`

Returns `{"name": "...", "description": "...", "content": "..."}`.

#### `GET /v1/skills/:name/files`

```json
{
  "skill": "hello-skill",
  "files": [
    { "path": "SKILL.md", "compressedSize": 180, "uncompressedSize": 240 },
    { "path": "references/policy.md", "compressedSize": 20, "uncompressedSize": 18 }
  ]
}
```

Paths are exactly as stored in the zip (including any top-level folder).

#### `GET /v1/skills/:name/files/<path>`

Returns the raw file bytes. `<path>` may contain slashes and must match a zip path exactly. Content type is chosen by extension:

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

## Error Responses

Errors are returned as JSON with an `error` field.

| Status | Body | When |
|--------|------|------|
| `400` | `{"error":"Validation Error","details":[...]}` | Request body or query failed schema validation (details are Zod issues) |
| `400` | `{"error":"environment_id query parameter required"}` | Admin list endpoints called without `environment_id` |
| `400` | `{"error":"No file uploaded"}` | Version upload without a `file` part |
| `400` | `{"error":"default_include must be a boolean"}` | Bad system-skill toggle body |
| `400` | `{"error":"File path required"}` | Empty file path on the file-read endpoint |
| `403` | `{"error":"Access denied"}` | Consumer lacks identity or grant for the skill |
| `404` | `{"error":"Registry entry not found"}`, `"Custom skill not found"`, `"Installation not found"`, `"System skill not found"`, `"Access grant not found"`, `"Bot dependency not found"` | Admin resource missing |
| `404` | `{"error":"Skill not found"}`, `"Skill has no modes"`, `"Mode '<mode>' not found"`, `"File '<path>' not found in skill"` | Consumer resource missing |
| `404` | `{"error":"Not Found"}` | Unknown route |
| `500` | `{"error":"Failed to download skill blob"}` | Blob read failed on download |
| `500` | `{"error":"Internal Server Error","message":"..."}` | Any other failure. `message` is included only when `NODE_ENV=development`. |

Conditions that currently surface as `500` include: uploading a zip without `SKILL.md` or an invalid zip; uploading when blob storage is not configured; uploading a version to a non-existent entry; duplicate names or versions (database unique constraints); malformed `metadata` JSON; and files over 50 MB.

When the entitlement guard is in enforce mode and the deployment is not entitled, `/admin` and `/v1` requests are refused by the guard before reaching these handlers.

## Environment Variables

### Service

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port |
| `NODE_ENV` | `development` | `development`, `production`, or `test`. In `development`, 500 responses include the error message. |
| `LOG_LEVEL` | `info` | Must be one of `debug`, `info`, `warn`, `error` (validated at startup) |
| `SERVICE_NAME` | `ff-services-skills` | Reported by `/` and `/status` |
| `ENVIRONMENT_ID` | — | UUID of the environment this instance serves on the consumer API. When unset, consumer endpoints return registry skills only (no installations or custom skills). |
| `RUN_MIGRATIONS` | unset (off) | Run SQL migrations on startup. **Any non-empty value — including `"false"` — enables it**; leave unset to disable. |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `PG_HOST` | — | Database host. Takes precedence over `PG_SERVER`. |
| `PG_SERVER` | — | Azure PostgreSQL server name; expands to `<name>.postgres.database.azure.com` |
| `PG_PORT` | `5432` | Database port |
| `PG_DATABASE` | `firefoundry` | Database name |
| `PG_PASSWORD` | — | Password for the `fireread` role (read pool, max 10 connections) |
| `PG_INSERT_PASSWORD` | — | Password for the `fireinsert` role (write pool, max 5 connections; also used for migrations) |
| `PG_SSL_DISABLED` | unset (SSL on) | Disable SSL. **Any non-empty value — including `"false"` — disables SSL**; leave unset to keep SSL on. |

If neither `PG_HOST` nor `PG_SERVER` is set, the service connects to `localhost`.

### Blob Storage

Blob storage is created with the shared FireFoundry storage factory (`createBlobStorage()` from `@firebrandanalytics/shared-utils`), which reads the standard `BLOB_STORAGE_*` variables — for example `BLOB_STORAGE_PROVIDER`, `BLOB_STORAGE_ACCOUNT`, `BLOB_STORAGE_CONTAINER`, and provider credentials. If initialization fails, the service starts anyway with uploads, downloads, and file reads disabled.

### Logging

The service writes its logs (one line per request, plus startup, identity, and error messages) to stdout/stderr. The shared `LOGGING_PROVIDER` variable (injected by the umbrella chart) and `CONSOLE_LOG_LEVEL` are ignored by this release.

### Entitlements

| Variable | Default | Description |
|----------|---------|-------------|
| `FF_ENTITLEMENT_MODE` | `report` | Only the exact value `enforce` enables refusal; anything else is report mode |
| `FF_ENTITLEMENT_AGENT_URL` | `http://ff-entitlement-agent:8090` | Entitlement agent token endpoint |
| `FF_ENTITLEMENT_ISSUER` | `https://license.firefoundry.ai` | Token issuer |
| `FF_ENTITLEMENT_JWKS_URL` | `<issuer>/.well-known/jwks.json` | Verification keys |
| `FF_CLUSTER_REF` | — | Lowercase RFC 4122 cluster UUID |
| `FF_NAMESPACE` | service-account namespace | Kubernetes namespace; falls back to the pod's service-account namespace file |
| `FF_ENTITLEMENT_POLL_SECONDS` | `30` | Poll interval; must be a positive number or startup fails |

## Database Schema

All tables live in the `skills` schema. Applied migrations are tracked in `public.skills_migrations`.

| Table | Purpose | Uniqueness |
|-------|---------|------------|
| `registry_entries` | Platform-level skill catalog | `name` |
| `registry_versions` | Immutable versions per entry (cascade on entry delete) | `(entry_id, version)` |
| `custom_skills` | Per-environment custom skills | `(environment_id, name)` |
| `custom_versions` | Versions for custom skills (cascade on skill delete) | `(skill_id, version)` |
| `installations` | Registry versions installed into environments | `(environment_id, entry_id)` |
| `access_grants` | Skill-to-application/bot/worker permissions | `(environment_id, skill_source, skill_id, grantee_type, grantee_id)` |
| `bot_dependencies` | Bot-to-skill dependency tracking | `(environment_id, bot_id, skill_source, skill_id)` |
