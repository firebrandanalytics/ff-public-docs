# Skills Service — Getting Started

This guide walks you through authoring a custom skill for your application, publishing and granting it, and reading it the way your agents do. It ends with installing a registry skill into your environment.

**Console, CLI, or API?** Day to day, most teams create, version, activate, and grant skills in the **FF Console**, and use [`ff-cli skills svc-*`](../../../../ff-cli/skills.md) to check what an application sees. This guide uses the REST admin API with `curl` so that every step is visible. The console covers the same operations, and these are the same calls an agent makes when it [publishes a skill itself](./concepts.md#skills-as-a-learning-loop).

## Prerequisites

- The Skills Service enabled in your environment (see [Operations](./operations.md#enabling-the-service)), with blob storage configured in your environment — uploads and file reads require it
- Your **environment ID** (the UUID the Skills Service is configured to serve) and your **application ID**; your environment administrator can provide both
- `curl`, `zip`, and optionally `jq` and [`ff-cli`](../../../../ff-cli/README.md)

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

Agents always read the most recently uploaded version of a custom skill. This upload is also the call an agent makes in the [learning loop](./concepts.md#skills-as-a-learning-loop) when it publishes an improved version.

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

## Step 7: Check What Your Application Sees

Every read carries an `X-On-Behalf-Of` identity with at least `app` and `bundle`, and results are filtered by that application's grants. Without an identity, listings are empty. The quickest check is `ff-cli`:

```bash
export SKILLS_SERVICE_URL=$SKILLS
export FF_ON_BEHALF_OF="app=$APP_ID; bundle=support-bundle"

ff-cli skills svc-list --tags support
ff-cli skills svc-read ticket-triage
```

## Step 8: Read Skills Through the MCP Gateway

Most agents read skills through the [MCP Gateway](../mcp-gateway/README.md). With its skills adapter enabled, agents get three tools, and the gateway forwards the caller's `X-On-Behalf-Of` identity so grants apply:

| Tool | Use |
|------|-----|
| `skills_list` | Discover skills (metadata only); optional `tags`, `name` (glob) |
| `skills_read` | Load a skill's full instructions; `name` |
| `skills_read_file` | Read one companion file; `name`, `path` (for example `references/routing.md`) |

A typical agent loop: call `skills_list`, pick a skill by its description, call `skills_read`, then `skills_read_file` for any reference it needs. To try it by hand (see [MCP Gateway — Getting Started](../mcp-gateway/getting-started.md) for `MCP_URL` and `MCP_KEY`):

```bash
curl -s -X POST $MCP_URL/mcp/skills \
  -H "Content-Type: application/json" -H "X-Api-Key: $MCP_KEY" \
  -H "X-On-Behalf-Of: app=$APP_ID; bundle=support-bundle" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"skills_read","arguments":{"name":"ticket-triage"}}}' \
  | jq -r '.result.content[0].text'
```

To wire this into a bundle (LLM tool calls, `SkillBotMixin`, virtual workers), see [Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md).

## Step 9: Read Skills over REST (Optional)

Code that doesn't use MCP can call the consumer API directly and set the identity header itself:

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

```bash
# Full instructions
curl -s "$SKILLS/v1/skills/ticket-triage?include=content" -H "X-On-Behalf-Of: $ON_BEHALF"

# One mode
curl -s "$SKILLS/v1/skills/ticket-triage/modes/escalation" -H "X-On-Behalf-Of: $ON_BEHALF"
# {"name":"escalation","description":"Rules for escalating urgent tickets","content":"Escalate when ..."}

# Files in the skill, and one file returned raw
curl -s "$SKILLS/v1/skills/ticket-triage/files" -H "X-On-Behalf-Of: $ON_BEHALF"
curl -s "$SKILLS/v1/skills/ticket-triage/files/references/routing.md" -H "X-On-Behalf-Of: $ON_BEHALF"

# Everything this app can see, with full content
curl -s "$SKILLS/v1/skills/manifest?include=content" -H "X-On-Behalf-Of: $ON_BEHALF"

# The whole zip (for example, to unpack into a worker's workspace)
curl -s -o ticket-triage.zip "$SKILLS/v1/skills/ticket-triage/download" -H "X-On-Behalf-Of: $ON_BEHALF"
```

A request from an application that has grants but not for this skill returns `403 {"error":"Access denied"}`.

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

- **[Skills in Agent Bundles](../../../sdk/agent_sdk/feature_guides/skills.md)** — Load skills from bots and virtual workers, and let agents publish improved versions
- **[Concepts](./concepts.md)** — How listings are assembled and how grants work
- **[Reference](./reference.md)** — All endpoints, fields, and error responses
- **[Operations](./operations.md)** — Enabling the service, verifying from a bundle, limits, and troubleshooting
- **[MCP Gateway](../mcp-gateway/README.md)** — Exposing skills to agents as MCP tools
