# Skills Service — Getting Started

This guide walks you through authoring a custom skill for your application, uploading and activating it, granting it to your application, and reading it the way your agents do — over REST and through the MCP Gateway. It ends with installing a registry skill into your environment.

## Prerequisites

- The Skills Service enabled in your environment (see [Operations](./operations.md#enabling-the-service)), with blob storage configured in your environment — uploads and file reads require it
- Your **environment ID** (the UUID the Skills Service is configured to serve) and your **application ID**; your environment administrator can provide both
- `curl`, `zip`, and optionally `jq`

For local work against a cluster, port-forward the service:

```bash
kubectl -n <namespace> port-forward svc/firefoundry-core-skills-service 8080:8080
```

The examples use `http://localhost:8080`. From inside the cluster (for example from your agent bundle), use `http://firefoundry-core-skills-service.<namespace>.svc.cluster.local:8080`.

```bash
SKILLS=http://localhost:8080
ENV_ID=22222222-2222-4222-8222-222222222222   # your environment ID
APP_ID=11111111-1111-4111-8111-111111111111   # your application ID
```

## Step 1: Check the Service

```bash
curl -s $SKILLS/health
# {"status":"healthy","timestamp":"2026-09-26T12:00:00.000Z"}
```

## Step 2: Author a Skill

Create a skill folder with a `SKILL.md`, one mode, and a reference document, then zip it:

```bash
mkdir -p ticket-triage/modes ticket-triage/references

cat > ticket-triage/SKILL.md <<'EOF'
---
name: ticket-triage
description: How to classify and route incoming support tickets. Read before triaging any ticket.
version: 1.0.0
tags: [support, triage]
---

# Ticket Triage

Classify each ticket as billing, technical, or account.
See references/routing.md for which queue each category goes to.
EOF

cat > ticket-triage/modes/escalation.md <<'EOF'
---
description: Rules for escalating urgent tickets
---
Escalate when the customer reports data loss or an outage affecting more than one user.
EOF

cat > ticket-triage/references/routing.md <<'EOF'
# Routing table
- billing -> finance-queue
- technical -> tier2-queue
- account -> accounts-queue
EOF

(cd ticket-triage && zip -r ../ticket-triage.zip .)
```

`SKILL.md` must be at the root of the zip or inside a single top-level folder. See [Concepts](./concepts.md#skill-zip-format) for the format.

## Step 3: Create the Custom Skill

Create the skill in your environment with the zip attached. It starts as a `draft`, so agents don't see it in listings yet; the attached zip becomes version `0.1.0`:

```bash
curl -s -X POST $SKILLS/admin/custom \
  -F "file=@ticket-triage.zip" \
  -F "metadata={\"environment_id\":\"$ENV_ID\",\"name\":\"ticket-triage\",\"description\":\"Support ticket triage\",\"tags\":[\"support\"]}"
```

Response (`201 Created`):

```json
{
  "id": "5a1e7c2d-3b4f-4c6d-8e9f-0a1b2c3d4e5f",
  "environment_id": "22222222-2222-4222-8222-222222222222",
  "name": "ticket-triage",
  "description": "Support ticket triage",
  "skill_type": "general",
  "status": "draft",
  "tags": ["support"],
  "created_at": "2026-09-26T12:00:00.000Z",
  "updated_at": "2026-09-26T12:00:00.000Z"
}
```

```bash
SKILL_ID=5a1e7c2d-3b4f-4c6d-8e9f-0a1b2c3d4e5f
```

Check the parsed manifest of the version you just uploaded:

```bash
curl -s $SKILLS/admin/custom/$SKILL_ID/versions | jq '.[0] | {version, manifest}'
```

## Step 4: Upload a New Version

Edit the skill, re-zip it, and upload it with a new version string (version strings must be unique per skill):

```bash
(cd ticket-triage && zip -r ../ticket-triage.zip .)

curl -s -X POST $SKILLS/admin/custom/$SKILL_ID/versions \
  -F "file=@ticket-triage.zip" \
  -F 'metadata={"version":"0.2.0"}'
```

Agents always read the most recently uploaded version of a custom skill.

## Step 5: Activate It

Set the status to `active` so it appears in consumer listings:

```bash
curl -s -X PUT $SKILLS/admin/custom/$SKILL_ID \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}'
```

## Step 6: Grant It to Your Application

An application with no grants sees every skill. To limit your app to the skills it should use, grant them. Once an application has at least one grant, it sees only granted skills (plus system skills with `default_include`), so grant every skill the app needs:

```bash
curl -s -X POST $SKILLS/admin/access-grants \
  -H "Content-Type: application/json" \
  -d "{
    \"environment_id\": \"$ENV_ID\",
    \"skill_source\": \"custom\",
    \"skill_id\": \"$SKILL_ID\",
    \"grantee_type\": \"application\",
    \"grantee_id\": \"$APP_ID\"
  }"
```

## Step 7: Discover Skills as an Agent

Consumer calls must carry an `X-On-Behalf-Of` identity with at least `app` and `bundle`. Without it the listing is empty.

```bash
ON_BEHALF="app=$APP_ID; bundle=support-bundle"

curl -s "$SKILLS/v1/skills?tags=support" -H "X-On-Behalf-Of: $ON_BEHALF"
```

Response (content omitted by default):

```json
[
  {
    "name": "ticket-triage",
    "description": "How to classify and route incoming support tickets. Read before triaging any ticket.",
    "version": "1.0.0",
    "tags": ["support", "triage"],
    "modes": [
      { "name": "escalation", "description": "Rules for escalating urgent tickets" }
    ],
    "companionFiles": ["references/routing.md"],
    "source": "custom"
  }
]
```

Other variants:

```bash
# Glob filter on name
curl -s "$SKILLS/v1/skills?name=ticket*" -H "X-On-Behalf-Of: $ON_BEHALF"

# Everything this app can see, with full content
curl -s "$SKILLS/v1/skills/manifest?include=content" -H "X-On-Behalf-Of: $ON_BEHALF"
```

## Step 8: Read the Skill, a Mode, and a File

```bash
# Full instructions
curl -s "$SKILLS/v1/skills/ticket-triage?include=content" -H "X-On-Behalf-Of: $ON_BEHALF"

# One mode
curl -s "$SKILLS/v1/skills/ticket-triage/modes/escalation" -H "X-On-Behalf-Of: $ON_BEHALF"
# {"name":"escalation","description":"Rules for escalating urgent tickets","content":"Escalate when ..."}

# Files in the skill
curl -s "$SKILLS/v1/skills/ticket-triage/files" -H "X-On-Behalf-Of: $ON_BEHALF"

# One file, returned raw
curl -s "$SKILLS/v1/skills/ticket-triage/files/references/routing.md" -H "X-On-Behalf-Of: $ON_BEHALF"

# The whole zip (for example, to unpack into a worker's workspace)
curl -s -o ticket-triage.zip "$SKILLS/v1/skills/ticket-triage/download" -H "X-On-Behalf-Of: $ON_BEHALF"
```

A request from an application that has grants but not for this skill returns `403 {"error":"Access denied"}`.

## Step 9: Read Skills Through the MCP Gateway

MCP-capable agents don't need to call REST directly. With the skills adapter enabled on the [MCP Gateway](../mcp-gateway/README.md), agents get three tools, and the gateway forwards the agent's `X-On-Behalf-Of` identity so grants apply:

| Tool | Use |
|------|-----|
| `skills_list` | Discover skills (metadata only); optional `tags`, `name` |
| `skills_read` | Load a skill's full instructions; `name` |
| `skills_read_file` | Read one companion file; `name`, `path` (for example `references/routing.md`) |

A typical agent loop: call `skills_list`, pick a skill by its description, call `skills_read`, then `skills_read_file` for any reference it needs. See [MCP Gateway — Tools](../mcp-gateway/tools.md#skills-adapter).

## Step 10 (Optional): Install a Registry Skill

To use a platform catalog skill at a fixed version, find its entry and version, then install it into your environment:

```bash
curl -s "$SKILLS/admin/registry?limit=100" | jq '.data[] | {id, name, description}'
ENTRY_ID=<entry-id>

curl -s $SKILLS/admin/registry/$ENTRY_ID/versions | jq '.[] | {id, version, published_at}'
VERSION_ID=<version-id>

curl -s -X POST $SKILLS/admin/installations \
  -H "Content-Type: application/json" \
  -d "{\"environment_id\":\"$ENV_ID\",\"entry_id\":\"$ENTRY_ID\",\"version_id\":\"$VERSION_ID\"}"
```

Installing again for the same entry replaces the pinned version. If your application has grants, also grant the registry skill (`"skill_source": "registry"`, `"skill_id": "$ENTRY_ID"`).

## Next Steps

- **[Concepts](./concepts.md)** — How listings are assembled and how grants work
- **[Reference](./reference.md)** — All endpoints, fields, and error responses
- **[Operations](./operations.md)** — Enabling the service, verifying from a bundle, limits, and troubleshooting
- **[MCP Gateway](../mcp-gateway/README.md)** — Exposing skills to agents as MCP tools
