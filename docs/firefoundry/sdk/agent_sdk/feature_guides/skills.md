# Skills in Agent Bundles

Skills are reusable instruction packages (a `SKILL.md` plus optional modes and reference files) that your agents load at runtime instead of hard-coding procedures into prompts. They are stored in the [Skills Service](../../../platform/services/skills-service/README.md), managed from the FF Console, and read by agents, usually through the [MCP Gateway](../../../platform/services/mcp-gateway/README.md).

This guide covers the agent side: how the pieces connect, how bots, bundle code, and virtual workers load skills, which Agent SDK utilities help, and how agents can **write** skills so later runs benefit from what earlier runs learned.

> **Status:** The Skills Service is an early release and is disabled by default in `firefoundry-core`. The SDK utilities described here ship in `@firebrandanalytics/ff-agent-sdk` 4.x (`/prompts`, `/bot`, and `/virtual-worker` entry points).

## Contents

1. [What a Skill Is to an Agent](#what-a-skill-is-to-an-agent)
2. [How the Pieces Connect](#how-the-pieces-connect)
3. [Choosing How to Load Skills](#choosing-how-to-load-skills)
4. [Loading Skills Through the MCP Gateway](#loading-skills-through-the-mcp-gateway)
5. [SDK Utilities](#sdk-utilities)
6. [The Learning Loop: Agents That Write Skills](#the-learning-loop-agents-that-write-skills)
7. [Grants and Visibility Gotchas](#grants-and-visibility-gotchas)
8. [Troubleshooting](#troubleshooting)

---

## What a Skill Is to an Agent

An agent never handles the uploaded zip. It sees a parsed **`SkillDefinition`**, the same shape everywhere (Skills Service, MCP tools, SDK):

```typescript
interface SkillDefinition {
  name: string;              // e.g. "ticket-triage"
  description: string;       // what the skill is for; the agent uses it to decide whether to read it
  version?: string;          // from SKILL.md front matter
  content: string;           // SKILL.md body (markdown instructions)
  modes?: { name: string; description?: string; content: string }[];  // modes/<name>.md
  toolRefs?: string[];       // tools the skill expects to use
  tags?: string[];
  companionFiles?: string[]; // e.g. "references/routing.md", read on demand
}
```

The pattern that works best is **progressive disclosure**: the agent first sees only names and descriptions, reads the full instructions of the one skill that matches its task, and reads a companion file only when the instructions point to it. The skill format itself is described in [Skills Service — Concepts](../../../platform/services/skills-service/concepts.md#skill-zip-format).

## How the Pieces Connect

```
  People                                  Agents at runtime
  ──────                                  ─────────────────
  FF Console / CI scripts                  Bot (LLM tool calls)   Bundle code      Virtual worker
      │                                          │                   │ MCP client       │ mcpServers
      │ manage: create, version,                 │ skills_list       │                  │ skills_* tools
      │ activate, grant                          │ skills_read       │                  │
      │                                          ▼ skills_read_file  ▼                  ▼
      │                                    ┌────────────────────────────────────────────────┐
      │                                    │ MCP Gateway (skills adapter, read-only)        │
      │                                    │ forwards X-On-Behalf-Of                        │
      │                                    └───────────────────────┬────────────────────────┘
      │ /admin                                                     │ /v1 (read, grant-filtered)
      ▼                                                            ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Skills Service   skills · versions · installations · access grants        │
  └──────────────────────────────────────────────────────────────────────────┘
      ▲
      │ /admin: new skill or new version (the learning loop)
      │
  Agent-bundle code that captures what worked (see "The Learning Loop")
```

| Piece | Role for an agent |
|-------|-------------------|
| **Skills Service** | Stores skills and their versions, decides which skills an application can see (access grants), and serves parsed definitions and individual files. Reads need an `X-On-Behalf-Of` identity; without it the service returns nothing. |
| **MCP Gateway, skills adapter** | Turns the Skills Service read API into three MCP tools: `skills_list`, `skills_read`, `skills_read_file`. It forwards the caller's identity so grants apply. It is **read-only**: there are no MCP tools that create or update skills. |
| **Agent SDK** | Types plus prompt utilities that render skills into a bot's prompt (`SkillPromptGroup`, `SkillBotMixin`, `SkillDiscoveryPromptGroup`), pluggable skill providers, and `VWSkillResolver`. The SDK does not include a client for the Skills Service admin API. |
| **FF Console / ff-cli** | How people manage skills. The console is the usual path for creating, versioning, activating, and granting skills. `ff-cli skills svc-*` commands let you check what an app sees (see [ff-cli skills](../../../../ff-cli/skills.md)). |
| **Skills Service admin API** | The REST API behind management. Agents that create or update skills at runtime call it directly. |

## Choosing How to Load Skills

| Your situation | Recommended path |
|----------------|------------------|
| The model should decide at runtime which skill applies (most agents) | Give the bot the gateway's `skills_*` tools: [Let the model pull skills](#let-the-model-pull-skills) |
| Your code knows which skills apply, and the instructions should always be in the prompt | Fetch through the gateway in code and render with `SkillBotMixin`: [Fetch skills in code](#fetch-skills-in-code-through-the-gateway) |
| A virtual worker (Claude Code, Codex, and so on) needs platform skills | Add the MCP Gateway to the worker's `mcpServers`; the CLI agent calls `skills_*` itself. See [Virtual workers](#virtual-workers) |
| Skills ship with your bundle or are unpacked on disk | `FilesystemSkillProvider` (+ `SkillDiscoveryPromptGroup` for agents with file tools) |
| Unit tests or a fixed set of skills | `StaticSkillProvider` or the `skills` config option |

## Loading Skills Through the MCP Gateway

The gateway is the main way agents consume skills. It applies the caller's grants and returns the same `SkillDefinition` JSON the SDK uses. Tool arguments are listed in [MCP Gateway — Tools](../../../platform/services/mcp-gateway/tools.md#skills-adapter).

| Tool | Returns |
|------|---------|
| `skills_list` | Visible skills without `content` (name, description, tags, mode names, companion file paths). Optional `tags` (all must match) and `name` (glob, e.g. `ticket*`). |
| `skills_read` | One skill with full `content`, at its most recently uploaded version. |
| `skills_read_file` | Raw text of one file in the skill, e.g. `references/routing.md`. |

### Let the model pull skills

Let the model do progressive disclosure through tool calls. List the skill tools in the bot's `allowed_mcp_tool_names`, and add a short instruction to the prompt:

```typescript
import { MixinBot } from '@firebrandanalytics/ff-agent-sdk/bot';

class SupportAgentBot extends MixinBot<SupportBTH> {
  constructor() {
    super({
      name: 'SupportAgentBot',
      base_prompt_group: buildSupportPrompts(),
      model_pool_name: 'default',
      allowed_mcp_tool_names: ['skills_list', 'skills_read', 'skills_read_file'],
    });
  }
}
```

```text
Before handling a ticket, call skills_list with tags ["support"]. If a skill's
description matches the task, call skills_read for it and follow its
instructions. Read companion files with skills_read_file only when the skill
tells you to.
```

`allowed_mcp_tool_names` is passed to the FF Broker with each request, and the broker runs those tools on MCP servers registered with it. This path only works if your environment's broker is connected to the MCP Gateway. Your environment administrator sets that up. Confirm that the tools appear before you rely on them.

### Fetch skills in code through the gateway

Take this path when your code should choose the skills, or when the instructions must always be in the prompt. Call the gateway with an MCP client and pass the results to an SDK prompt utility. The adapter below wraps the gateway tools in the SDK's `MCPResourceClient` interface. That lets `MCPSkillProvider`, `SkillBotMixin`, and `VWSkillResolver` all use the gateway:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FFAsyncLocalStorage } from '@firebrandanalytics/shared-utils';
import type { MCPResourceClient } from '@firebrandanalytics/ff-agent-sdk/prompts';

const GATEWAY_URL = 'http://firefoundry-core-mcp-gateway:8080/mcp/skills'; // skills tools only

// Forward the inbound caller identity; otherwise use this bundle's own identity.
function onBehalfOf(): string {
  const id = (FFAsyncLocalStorage.getStore() as any)?.onBehalfOf;
  if (id) return `app=${id.applicationId}; bundle=${id.agentBundleId}${id.userId ? `; user=${id.userId}` : ''}`;
  return `app=${process.env.FF_APPLICATION_ID}; bundle=${process.env.FF_AGENT_BUNDLE_ID}`;
}

async function callSkillsTool(name: string, args: Record<string, unknown>): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL), {
    requestInit: {
      headers: { 'X-Api-Key': process.env.FF_MCP_API_KEY!, 'X-On-Behalf-Of': onBehalfOf() },
    },
  });
  const client = new Client({ name: 'support-bundle', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result: any = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    if (result.isError) throw new Error(text);
    return text;
  } finally {
    await client.close();
  }
}

/** Exposes gateway skills as skill:// resources for MCPSkillProvider / VWSkillResolver. */
export function gatewaySkillClient(filter: { tags?: string[]; name?: string } = {}): MCPResourceClient {
  return {
    async listResources() {
      const skills = JSON.parse(await callSkillsTool('skills_list', filter));
      return skills.map((s: any) => ({ uri: `skill://${s.name}`, name: s.name, description: s.description }));
    },
    async readResource(uri: string) {
      const name = uri.replace(/^skill:\/\//, '');
      if (name === 'manifest') throw new Error('no manifest resource'); // provider falls back to list + read
      return { text: await callSkillsTool('skills_read', { name }), mimeType: 'application/json' };
    },
  };
}
```

Then render the skills into a bot's prompt:

```typescript
import { ComposeMixins, MixinBot, SkillBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';
import { MCPSkillProvider } from '@firebrandanalytics/ff-agent-sdk/prompts';

class TriageBot extends ComposeMixins(MixinBot, SkillBotMixin) {
  constructor() {
    super(
      [{ name: 'TriageBot', base_prompt_group: buildTriagePrompts(), model_pool_name: 'default' }],
      [{
        provider: new MCPSkillProvider({ client: gatewaySkillClient({ tags: ['support'] }) }),
        maxSkillContentLength: 8000,
      }],
    );
  }
}
```

Keep the filter narrow. The provider reads each listed skill in full on **every** bot run, which costs one `skills_read` call per skill and puts all of their content into the prompt.

## SDK Utilities

All of the following are exported from `@firebrandanalytics/ff-agent-sdk/prompts` unless noted.

### Skill providers

A provider has one method, `getSkills(): Promise<SkillDefinition[]>`. Every built-in provider **degrades gracefully**: on error it logs a warning and returns `[]`, so a misconfigured provider leaves you with a bot that has no skills rather than a failed request. Check your logs when skills seem to be missing.

| Provider | Loads from | Notes |
|----------|-----------|-------|
| `StaticSkillProvider(skills)` | An array you pass | Tests and fixed skills. Passing `skills: [...]` to the prompt group or mixin does the same. |
| `ManifestSkillProvider(path)` | A `SkillManifest` JSON file (`{ skills, generatedAt }`) on disk | Use it when a skill manifest file already exists in the container. |
| `FilesystemSkillProvider({ skillsDir })` | Subdirectories of `skillsDir` that contain `SKILL.md` | Reads front matter, `modes/*.md`, and lists `assets/` and `references/` files. Options: `skillFileName`, `modesDir`, `companionDirs`, `collectCompanionFiles`. The front-matter parser (`parseFrontMatter`, also exported) handles strings and arrays, not nested objects. |
| `MCPSkillProvider({ client, uriPrefix?, preferManifest? })` | MCP **resources** named `skill://manifest` or `skill://<name>` | Tries `skill://manifest` first, then lists resources and reads each one. The MCP Gateway publishes skills as **tools**, not resources, so pair this provider with an adapter like [`gatewaySkillClient`](#fetch-skills-in-code-through-the-gateway) or with an MCP server that serves `skill://` resources. |
| `HttpSkillProvider(baseUrl, environmentId)` | `GET <baseUrl>/v1/skills/manifest` | Sends no `X-On-Behalf-Of` header and does not request content, so against the current Skills Service it returns no skills. Use the gateway path or a custom provider instead. |
| Your own class | Anything | Implement `SkillProvider` to call a different source or to add caching. |

### SkillPromptGroup

`SkillPromptGroup` loads skills from its provider every time the prompt is rendered. It then emits:

1. A system message with an **Available Skills** catalog: name, description, tags, and (with `includeModeListing`, default `true`) each mode's name and description.
2. One system message per skill with its `content` in a markdown code box, truncated at `maxSkillContentLength` characters (default `8000`). A second line lists the skill's `toolRefs`, if any.

Mode **content** and companion files are not rendered. If a bot needs a mode's instructions, put them in `SKILL.md` or give the bot `skills_read_file`.

```typescript
import { SkillPromptGroup } from '@firebrandanalytics/ff-agent-sdk/prompts';

const skills = new SkillPromptGroup([], { provider, maxSkillContentLength: 6000, includeModeListing: false });
```

### SkillBotMixin

Exported from `@firebrandanalytics/ff-agent-sdk/bot`. `SkillBotMixin` adds a `SkillPromptGroup` to the bot's **data section**, next to working memory and other context, so every request includes the skills. Its config is the same as `SkillPromptGroupConfig` (`provider`, `skills`, `maxSkillContentLength`, `includeModeListing`). `getActiveSkills()` returns what the provider currently yields, which helps with logging and tests. See the `TriageBot` example [above](#fetch-skills-in-code-through-the-gateway). `SkillBotMixin` is also registered under that name for bots defined in BotML.

### SkillDiscoveryPromptGroup

`SkillDiscoveryPromptGroup` is for **agents that have file tools** (read, glob), such as coding agents working in a workspace. It renders one of:

- **`catalog`** (default): a list of skills (name, description, tags, modes) plus instructions to read `<skillsDir>/<skill-name>/SKILL.md` and `modes/<mode>.md` when a task matches. Only the catalog goes into the prompt; the agent reads files itself.
- **`inline`**: the full content, rendered with `SkillPromptGroup`.

```typescript
import { SkillDiscoveryPromptGroup, FilesystemSkillProvider } from '@firebrandanalytics/ff-agent-sdk/prompts';

const discovery = new SkillDiscoveryPromptGroup([], {
  provider: new FilesystemSkillProvider({ skillsDir: '/workspace/.skills' }),
  skillsDir: '/workspace/.skills',   // default in the instructions: ~/.claude/skills
  mode: 'catalog',
  customPreamble: 'You are working in the support repository.',
});
```

Catalog mode tells the agent to read files at `skillsDir`. Use it only when the skills actually exist as directories at that path in the agent's environment. For skills that live only in the Skills Service, give the agent the `skills_*` tools.

### VWSkillResolver

Exported from `@firebrandanalytics/ff-agent-sdk/virtual-worker`. `VWSkillResolver` merges skills from several sources into one provider:

```typescript
import { VWSkillResolver } from '@firebrandanalytics/ff-agent-sdk/virtual-worker';

const resolver = new VWSkillResolver({
  staticSkills: [houseStyleSkill],                     // always included; wins name conflicts
  mcpClient: gatewaySkillClient({ tags: ['backend'] }), // gateway skills via the adapter above
  skillFilter: (s) => !s.tags?.includes('experimental'),
  cacheSkills: true,                                   // default
});

const provider = resolver.asProvider();  // pass to SkillBotMixin or SkillPromptGroup
```

- Sources are queried in the order static, `httpService`, `mcpClient`. Skills are de-duplicated by name (first wins), then `skillFilter` runs.
- With `cacheSkills` (the default), results are cached for the resolver's lifetime. Call `clearCache()` to pick up new skill versions, which matters in the [learning loop](#the-learning-loop-agents-that-write-skills).
- The `httpService` option uses `HttpSkillProvider` and has the same limitation described above.

### Virtual workers

`VWSkillResolver` builds prompts on the **bundle side**, for example for a planner bot that writes the task for a worker. Despite its name, it does not install anything into a worker's workspace, and the Virtual Worker Manager does not deliver skills itself: VWM has no skill store or skill admin API of its own.

The CLI agent inside a [virtual worker](../../../platform/services/virtual-workers/README.md) gets Skills Service skills through the MCP Gateway. Add the gateway to the worker's `mcpServers` (see [MCP Gateway — Connecting Clients](../../../platform/services/mcp-gateway/clients.md#virtual-workers)); the CLI agent then calls `skills_list`, `skills_read`, and `skills_read_file` like any other agent. Without the gateway in `mcpServers`, a worker has no access to platform skills. See [VWM Concepts — Skills](../../../platform/services/virtual-workers/concepts.md#skills).

Native delivery of Skills Service skills into worker workspaces by VWM is planned. Until it ships, use the MCP Gateway path.

---

## The Learning Loop: Agents That Write Skills

Skills don't have to be written only by people. **An agent can capture a procedure that worked as a new skill, or as a new version of an existing one, and every agent that reads that skill afterwards uses the improved version.** This is one of the main learning loops in FireFoundry: knowledge moves out of a single conversation into a versioned, shared, reviewable artifact that the rest of your application picks up without a redeploy.

```
  ┌────────────┐  skills_read   ┌─────────────┐  outcome   ┌──────────────────┐
  │  Agent run │ ─────────────► │ does the    │ ─────────► │ capture step:    │
  │  (any bot) │ ◄───────────── │ work        │  success   │ distill what     │
  └────────────┘  latest        └─────────────┘            │ worked into      │
        ▲         version                                  │ SKILL.md         │
        │                                                  └────────┬─────────┘
        │                                                           │ POST /admin/custom/:id/versions
        │        next run reads the new version                     ▼
        └───────────────────────────────────────────── Skills Service (new version)
```

### What the platform supports today

| Step | How |
|------|-----|
| Read the current skill | `skills_read` through the MCP Gateway (or any loading path above) |
| Create a new skill | Skills Service admin API: `POST /admin/custom` with the zip (becomes version `0.1.0`) |
| Publish an improved version | Skills Service admin API: `POST /admin/custom/:id/versions` with the zip and a new, unique version string |
| Make a new skill listable | Admin API: `PUT /admin/custom/:id` with `{"status":"active"}` (or create it with `"status": "active"`) |
| Make it visible to an app that uses grants | Admin API: `POST /admin/access-grants` |

**There is no MCP tool and no SDK helper for writing skills.** The MCP Gateway's skills tools are read-only. A learning agent writes to the Skills Service **admin REST API** directly from bundle code. Request formats are in [Skills Service — Reference](../../../platform/services/skills-service/reference.md#admin-api-admin).

### Worked example: capturing a resolution playbook

A support bundle resolves tickets. After a resolution is confirmed, a capture step asks a bot to turn the transcript into a better version of the `support-playbook` skill, then publishes it. The next ticket's agent reads the new version with `skills_read`.

**1. Distill.** Use a structured-output bot to turn "current skill + what just worked" into a new `SKILL.md`. The prompt should ask for a merged, general procedure with no customer data. The bot returns markdown that includes front matter with a `version` field.

**2. Publish.** Zip the skill and upload it as a new version. This sketch uses Node's built-in `fetch`/`FormData` and the `jszip` package (any zip library works):

```typescript
import JSZip from 'jszip';

const SKILLS = 'http://firefoundry-core-skills-service:8080';
const ENV_ID = process.env.SKILLS_ENVIRONMENT_ID!;  // your own setting: the environment UUID the Skills Service serves

async function zipSkill(skillMd: string, files: Record<string, string> = {}): Promise<Blob> {
  const zip = new JSZip();
  zip.file('SKILL.md', skillMd);
  for (const [path, text] of Object.entries(files)) zip.file(path, text);  // e.g. references/*.md
  return new Blob([await zip.generateAsync({ type: 'uint8array' })], { type: 'application/zip' });
}

async function findCustomSkill(name: string): Promise<{ id: string } | undefined> {
  const res = await fetch(`${SKILLS}/admin/custom?environment_id=${ENV_ID}`);
  if (!res.ok) throw new Error(`list custom skills: ${res.status}`);
  return (await res.json()).find((s: any) => s.name === name);
}

/** Creates the skill on first use, otherwise uploads a new version. */
export async function publishLearnedSkill(opts: {
  name: string; description: string; tags: string[]; skillMd: string; version: string;
}): Promise<void> {
  const file = await zipSkill(opts.skillMd);
  const existing = await findCustomSkill(opts.name);
  const form = new FormData();
  form.append('file', file, `${opts.name}.zip`);

  if (existing) {
    form.append('metadata', JSON.stringify({ version: opts.version }));  // must be unique per skill
    const res = await fetch(`${SKILLS}/admin/custom/${existing.id}/versions`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`upload version: ${res.status} ${await res.text()}`);
    return;
  }

  form.append('metadata', JSON.stringify({
    environment_id: ENV_ID, name: opts.name, description: opts.description,
    tags: opts.tags, status: 'active',
  }));
  const res = await fetch(`${SKILLS}/admin/custom`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`create skill: ${res.status} ${await res.text()}`);
  // If your application uses access grants, grant the new skill here (POST /admin/access-grants).
}
```

Call it from the capture step, for example at the end of a runnable entity's run after the outcome has been confirmed:

```typescript
const version = `1.${Date.now()}`;  // any unique string of 1–50 chars
await publishLearnedSkill({
  name: 'support-playbook',
  description: 'How we resolve support tickets. Read before working any ticket.',
  tags: ['support'],
  skillMd: distilledSkillMd.replace(/^version:.*$/m, `version: ${version}`),  // keep front matter in sync
  version,
});
```

**3. Consume.** No redeploy is needed. The next `skills_read` for `support-playbook` returns the new version, because reads always return the most recently uploaded one and neither the gateway nor the service caches skills. Bundle-side resolvers that cache, such as `VWSkillResolver`, need `clearCache()` before they see it.

### Design guardrails for learning agents

- **Updates go live immediately.** A new version of an active skill is what every agent reads next; versions have no draft stage. To review before publishing, have the agent write to a separate **candidate** skill (for example `support-playbook-candidate`) that your application isn't granted. Someone then reviews it in the FF Console and publishes it as the real skill's next version.
- **Rollback means re-uploading.** You can't re-activate an older version. Keep the previous `SKILL.md` (for example in the entity that performed the update) so you can upload it again as a new version. Deleting a custom skill deletes all its versions.
- **Keep the write path in code, not in the model's hands.** The admin API has no per-caller authorization, so anything that can reach it can change any skill in the environment. Put writes behind a deterministic step that validates the content (size, required sections, no secrets or customer data), not behind a free-form tool the LLM can call.
- **Use unique version strings.** Uploading a version string that already exists fails. Two agents publishing concurrently need different versions.
- **Pick distinctive names.** If a registry skill has the same name as your custom skill, reads return the registry skill.
- **Keep front-matter `version` in sync.** Consumers see the front-matter version, not the upload's version string, so set both to the same value.

---

## Grants and Visibility Gotchas

These rules come from the Skills Service ([Concepts — Access Control](../../../platform/services/skills-service/concepts.md#access-control)) and are what agents actually run into:

| Gotcha | Effect on your agent | What to do |
|--------|---------------------|------------|
| No `X-On-Behalf-Of` on the call | `skills_list` returns `[]`; `skills_read` fails with `403` | Make sure identity reaches the gateway; set it explicitly when calling from code |
| The application has no grants | It sees every skill | Fine for development; add grants before production |
| The application gets its first grant | Every other non-system skill disappears from its view | Grant everything the app needs in one step |
| The learning loop creates a **new** skill | Invisible to an app that uses grants until it is granted | Grant it as part of creation, or grant via the console after review |
| Skill is `draft` or `deprecated` | Hidden from `skills_list`, but `skills_read` by exact name still returns it | Don't rely on `draft` to hide content |
| Installed registry version | Pins what `skills_list` shows; `skills_read` still returns the latest upload | Treat the latest upload as live |
| `bot` / `worker` grants | Recorded but not enforced | Scope by application only |

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `skills_*` tools missing from `tools/list` | The gateway's skills adapter isn't configured ([Skills Service — Operations](../../../platform/services/skills-service/operations.md#exposing-skills-over-mcp)) |
| LLM tool calls see no skills, but direct gateway calls with an identity do | The identity isn't reaching the gateway on that path; check with your environment administrator how the broker calls the gateway |
| `SkillBotMixin` renders nothing, with no error | The provider failed and returned `[]`; look for `[MCPSkillProvider]` / `[HttpSkillProvider]` / `[SkillPromptGroup]` warnings in the bundle logs |
| `MCPSkillProvider` pointed at the gateway returns nothing | The gateway publishes tools, not `skill://` resources; use an adapter like `gatewaySkillClient` |
| A skill's text is cut off in the prompt | Content is longer than `maxSkillContentLength` (default 8000); raise it or move detail into `references/` files |
| A newly published version isn't used | A bundle-side cache (`VWSkillResolver` with `cacheSkills`) is holding the old one; call `clearCache()` |
| `500` when publishing a version | Usually a duplicate version string, a zip without `SKILL.md`, or invalid `metadata` JSON (see [Reference — Error Responses](../../../platform/services/skills-service/reference.md#error-responses)) |

## Related

- [Skills Service](../../../platform/services/skills-service/README.md): the service, skill format, management, and API
- [MCP Gateway — Tools](../../../platform/services/mcp-gateway/tools.md#skills-adapter): `skills_*` tool arguments
- [ff-cli skills commands](../../../../ff-cli/skills.md): inspect what an application sees
- [Advanced Bot Mixin Patterns](advanced-bot-mixin-patterns.md): composing `SkillBotMixin` with other mixins
- [Virtual Worker SDK](virtual-worker-sdk.md): orchestrating virtual workers from a bundle
