# Skills Service — Getting Started

This guide walks you through publishing a skill to the registry, reading it back through the consumer API the way an agent would, pinning a version with an installation, adding an environment-specific custom skill, and restricting access with a grant.

## Prerequisites

- A running Skills Service (deployed with the `firefoundry-core` Helm chart with `skills-service.enabled: true`, or run locally from source — see [Operations](./operations.md))
- The `skills` database schema migrated (the Helm chart sets `RUN_MIGRATIONS=true`, which migrates on startup)
- **Blob storage configured** for the service — uploads and file reads fail without it
- `ENVIRONMENT_ID` set on the service if you want to follow the installation and custom-skill steps (Steps 7–8)
- `curl`, `zip`, and optionally `jq`

In a cluster, port-forward the service to your machine:

```bash
kubectl -n <namespace> port-forward svc/firefoundry-core-skills-service 8080:8080
```

All examples below use `http://localhost:8080`. From inside the cluster, use `http://firefoundry-core-skills-service.<namespace>.svc.cluster.local:8080`.

## Step 1: Verify the Service Is Running

```bash
curl -s http://localhost:8080/health
# {"status":"healthy","timestamp":"2026-09-26T12:00:00.000Z"}

curl -s http://localhost:8080/status
# {"service":"ff-services-skills","version":"0.1.0","uptime":42.1,"environment":"production"}
```

## Step 2: Package a Skill

Create a skill folder with a `SKILL.md`, one mode, and a reference document, then zip it:

```bash
mkdir -p hello-skill/modes hello-skill/references

cat > hello-skill/SKILL.md <<'EOF'
---
name: hello-skill
description: Greets users politely and explains the greeting policy
version: 1.0.0
tags: [demo, greeting]
---

# Hello Skill

Always greet the user by name. See references/policy.md for tone rules.
EOF

cat > hello-skill/modes/formal.md <<'EOF'
---
description: Formal greetings for business contexts
---
Use "Good morning" / "Good afternoon" and the user's surname.
EOF

echo "# Greeting policy" > hello-skill/references/policy.md

(cd hello-skill && zip -r ../hello-skill.zip .)
```

`SKILL.md` must be at the root of the zip (or inside a single top-level folder). See [Concepts](./concepts.md#skill-zip-format) for the full format.

## Step 3: Create a Registry Entry

```bash
curl -s -X POST http://localhost:8080/admin/registry \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-skill",
    "description": "Demo greeting skill",
    "category": "demo",
    "tags": ["demo", "greeting"]
  }'
```

Response (`201 Created`):

```json
{
  "id": "3f7c1a52-9d0e-4b8a-a1f4-2c6d5e7f8a90",
  "name": "hello-skill",
  "publisher": "firebrand",
  "description": "Demo greeting skill",
  "category": "demo",
  "tags": ["demo", "greeting"],
  "is_system": false,
  "default_include": false,
  "created_at": "2026-09-26T12:00:00.000Z",
  "updated_at": "2026-09-26T12:00:00.000Z"
}
```

Save the ID:

```bash
ENTRY_ID=3f7c1a52-9d0e-4b8a-a1f4-2c6d5e7f8a90
```

## Step 4: Upload a Version

Upload the zip as multipart form data. The `file` field carries the zip and the `metadata` field carries a JSON string with the version:

```bash
curl -s -X POST http://localhost:8080/admin/registry/$ENTRY_ID/versions \
  -F "file=@hello-skill.zip" \
  -F 'metadata={"version":"1.0.0"}'
```

Response (`201 Created`, abbreviated):

```json
{
  "id": "b2d4f6a8-1c3e-4a5b-9d7f-0e1a2b3c4d5e",
  "entry_id": "3f7c1a52-9d0e-4b8a-a1f4-2c6d5e7f8a90",
  "version": "1.0.0",
  "manifest": {
    "name": "hello-skill",
    "description": "Greets users politely and explains the greeting policy",
    "version": "1.0.0",
    "content": "# Hello Skill\n\nAlways greet the user by name. ...",
    "tags": ["demo", "greeting"],
    "modes": [
      { "name": "formal", "description": "Formal greetings for business contexts", "content": "Use \"Good morning\" ..." }
    ],
    "companionFiles": ["references/policy.md"]
  },
  "blob_id": "registry/hello-skill/1.0.0.zip",
  "content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "requirements": {},
  "published_at": "2026-09-26T12:01:00.000Z"
}
```

The manifest was parsed at upload time; consumers will read this JSON rather than the zip.

## Step 5: List Skills as a Consumer

Consumer requests must carry an `X-On-Behalf-Of` identity with at least `app` and `bundle`. Without it the listing is empty.

```bash
ON_BEHALF='app=11111111-1111-4111-8111-111111111111; bundle=my-bundle'

curl -s "http://localhost:8080/v1/skills?tags=demo" \
  -H "X-On-Behalf-Of: $ON_BEHALF"
```

Response (content is stripped by default):

```json
[
  {
    "name": "hello-skill",
    "description": "Greets users politely and explains the greeting policy",
    "version": "1.0.0",
    "tags": ["demo", "greeting"],
    "modes": [
      { "name": "formal", "description": "Formal greetings for business contexts" }
    ],
    "companionFiles": ["references/policy.md"],
    "source": "registry"
  }
]
```

Other useful variants:

```bash
# Glob filter on name
curl -s "http://localhost:8080/v1/skills?name=hello*" -H "X-On-Behalf-Of: $ON_BEHALF"

# Whole environment manifest, including full content
curl -s "http://localhost:8080/v1/skills/manifest?include=content" -H "X-On-Behalf-Of: $ON_BEHALF"
```

## Step 6: Read the Skill, a Mode, and a File

```bash
# Full skill definition with instructions
curl -s "http://localhost:8080/v1/skills/hello-skill?include=content" \
  -H "X-On-Behalf-Of: $ON_BEHALF"

# A single mode
curl -s "http://localhost:8080/v1/skills/hello-skill/modes/formal" \
  -H "X-On-Behalf-Of: $ON_BEHALF"
# {"name":"formal","description":"Formal greetings for business contexts","content":"Use \"Good morning\" ..."}

# Files inside the zip
curl -s "http://localhost:8080/v1/skills/hello-skill/files" \
  -H "X-On-Behalf-Of: $ON_BEHALF"
# {"skill":"hello-skill","files":[{"path":"SKILL.md","compressedSize":...,"uncompressedSize":...}, ...]}

# One file, returned raw with a content type based on its extension
curl -s "http://localhost:8080/v1/skills/hello-skill/files/references/policy.md" \
  -H "X-On-Behalf-Of: $ON_BEHALF"

# The whole zip
curl -s -o hello-skill-latest.zip "http://localhost:8080/v1/skills/hello-skill/download" \
  -H "X-On-Behalf-Of: $ON_BEHALF"
```

Agents usually reach these endpoints through the [MCP Gateway](../mcp-gateway/README.md) tools `skills_list`, `skills_read`, and `skills_read_file` rather than calling them directly.

## Step 7: Pin a Version with an Installation

Registry skills are listed at their latest version by default. To pin the version listed in an environment, install it. Use the same UUID the service is configured with as `ENVIRONMENT_ID`:

```bash
ENV_ID=22222222-2222-4222-8222-222222222222
VERSION_ID=b2d4f6a8-1c3e-4a5b-9d7f-0e1a2b3c4d5e

curl -s -X POST http://localhost:8080/admin/installations \
  -H "Content-Type: application/json" \
  -d "{\"environment_id\":\"$ENV_ID\",\"entry_id\":\"$ENTRY_ID\",\"version_id\":\"$VERSION_ID\"}"

curl -s "http://localhost:8080/admin/installations?environment_id=$ENV_ID"
# [{"id":"...","environment_id":"...","entry_id":"...","version_id":"...","entry_name":"hello-skill","version":"1.0.0", ...}]
```

Posting another installation for the same entry and environment replaces the installed version.

## Step 8: Add a Custom Skill

Custom skills belong to one environment. Create one with its zip attached; the first version is recorded as `0.1.0`. Set `status` to `active` so it appears in consumer listings:

```bash
(cd hello-skill && sed -i 's/^name: hello-skill/name: team-greeting/' SKILL.md && zip -r ../team-greeting.zip .)

curl -s -X POST http://localhost:8080/admin/custom \
  -F "file=@team-greeting.zip" \
  -F "metadata={\"environment_id\":\"$ENV_ID\",\"name\":\"team-greeting\",\"status\":\"active\",\"tags\":[\"demo\"]}"
```

Upload later versions with:

```bash
curl -s -X POST http://localhost:8080/admin/custom/<custom-skill-id>/versions \
  -F "file=@team-greeting.zip" \
  -F 'metadata={"version":"0.2.0"}'
```

The custom skill now appears in `GET /v1/skills` with `"source": "custom"`.

## Step 9: Restrict Access with a Grant

By default an application with no grants sees every skill. Once an application has at least one grant, it sees only granted skills (plus system skills with `default_include`):

```bash
APP_ID=11111111-1111-4111-8111-111111111111

curl -s -X POST http://localhost:8080/admin/access-grants \
  -H "Content-Type: application/json" \
  -d "{
    \"environment_id\": \"$ENV_ID\",
    \"skill_source\": \"registry\",
    \"skill_id\": \"$ENTRY_ID\",
    \"grantee_type\": \"application\",
    \"grantee_id\": \"$APP_ID\"
  }"
```

Now `GET /v1/skills` for `app=$APP_ID` returns `hello-skill` but not `team-greeting`, and `GET /v1/skills/team-greeting` returns `403 {"error":"Access denied"}`.

## Next Steps

- **[Concepts](./concepts.md)** — How listings are assembled and how the ACL works
- **[Reference](./reference.md)** — All endpoints, fields, and error responses
- **[Operations](./operations.md)** — Deployment, blob storage, environment context, and troubleshooting
- **[MCP Gateway](../mcp-gateway/README.md)** — Exposing skills to agents as MCP tools
