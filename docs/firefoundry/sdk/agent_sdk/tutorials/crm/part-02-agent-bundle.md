# Part 2: Agent Bundle — Bots, Prompts, and API Endpoints

In [Part 1](./part-01-domain-modeling.md) you designed a 7-entity CRM domain model with typed DTOs, graph relationships, and behavioral classifications. Now we'll add AI behavior (bots and prompts), wire everything into an agent bundle, expose 9 API endpoints, and verify the full system.

**What you'll learn:**
- `BotRunnableEntityMixin` — entities that invoke AI processing via `.run()`
- `StructuredOutputBotMixin` — bots that return validated JSON using Zod schemas
- The prompt framework — `PromptTemplateSectionNode`, `PromptTemplateTextNode`, `PromptTemplateStructDataNode`
- `FFAgentBundle` — constructor, entity/bot registration, edge registration, health checks
- API endpoint patterns — CRUD, search, direct bot invocation, graph traversal, multi-entity coordination

**What you'll build:** A running CRM agent bundle with 4 AI bots and 9 API endpoints.

---

## Entities That Run Bots

Some entities need AI processing. FireFoundry's **BotRunnableEntityMixin** lets an entity automatically invoke a bot when its `.run()` method is called.

### The Pattern

```
                  .run() called
                       │
                       ▼
    ┌─────────────────────────────────────┐
    │  BotRunnableEntityMixin             │
    │  1. Calls get_bot_request_args()    │
    │  2. Invokes the registered bot      │
    │  3. Returns structured output       │
    └─────────────────────────────────────┘
```

### Runnable Type Helper

A runnable entity needs an additional type helper that specifies the bot's output type:

```typescript
import type { RunnableEntityTypeHelper } from '@firebrandanalytics/ff-agent-sdk';
import type { NOTE_ENRICHMENT_OUTPUT } from '../schemas.js';

export type NoteEntityRETH = RunnableEntityTypeHelper<
  NoteEntityENH,            // Base entity type helper
  NOTE_ENRICHMENT_OUTPUT    // What the bot returns
>;
```

### NoteEntity — Self-Contained Runnable

Use `AddMixins` to compose `RunnableEntity` with `BotRunnableEntityMixin`:

```typescript
// entities/NoteEntity.ts
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  EntityFactory,
  Context,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import type { BotRequestArgs } from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';
import type { NoteEnricherBTH } from '../bots/NoteEnricherBot.js';

@EntityMixin({
  specificType: 'NoteEntity',
  generalType: 'NoteEntity',
  allowedConnections: {},
})
export class NoteEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<NoteEntityRETH>,
  BotRunnableEntityMixin<NoteEntityRETH>
]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | NoteEntityDTO) {
    super(
      [factory, idOrDto] as any,
      ['NoteEnricherBot']          // Bot name(s) to invoke on .run()
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<NoteEnricherBTH>>
  ): Promise<BotRequestArgs<NoteEnricherBTH>> {
    const dto = await this.get_dto();

    logger.info('[NoteEntity] Building enrichment request', {
      entity_id: this.id,
      category: dto.data.category,
    });

    return {
      args: {} as Record<string, never>,
      input: `Category: ${dto.data.category}\n\nNote:\n${dto.data.content}`,
      context: new Context(dto),
    };
  }
}
```

**Key Elements:**
1. **`AddMixins(RunnableEntity, BotRunnableEntityMixin)`** — Composes the base runnable with bot integration
2. **Constructor**: Pass `[factory, idOrDto]` and the bot name(s) as a string array
3. **`get_bot_request_args_impl()`** — The SDK calls this to build the bot request. You provide:
   - `args`: Static arguments (empty here, but could include configuration)
   - `input`: The text prompt sent to the bot
   - `context`: Entity context for the bot's reference

### EmailDraftEntity — A More Complex Runnable

`EmailDraftEntity` builds a richer prompt from template + contact data:

```typescript
// entities/EmailDraftEntity.ts
protected async get_bot_request_args_impl(
  _preArgs: Partial<BotRequestArgs<EmailPersonalizerBTH>>
): Promise<BotRequestArgs<EmailPersonalizerBTH>> {
  const dto = await this.get_dto();
  const d = dto.data;

  const input = [
    `## Template`,
    `Subject: ${d.subject_template}`,
    ``,
    `Body:`,
    d.body_html_template,
    ``,
    `## Contact Information`,
    `Name: ${d.contact_name}`,
    `Email: ${d.contact_email}`,
    d.contact_company ? `Company: ${d.contact_company}` : '',
  ].filter(Boolean).join('\n');

  return {
    args: {} as Record<string, never>,
    input,
    context: new Context(dto),
  };
}
```

**Pattern:** Load related data from the entity's own DTO (which was populated at creation time), build a markdown-formatted prompt, and return it. The bot handles the AI reasoning.

---

## Structured Output Bots

Every bot in the CRM uses **StructuredOutputBotMixin** to produce validated JSON. This means the LLM's free-text response is parsed into a typed object using a Zod schema — no manual JSON extraction needed.

### Output Schemas

```typescript
// schemas.ts
import { z } from 'zod';

// Note Enrichment — structured insights from free text
export const NoteEnrichmentSchema = z.object({
  key_insights: z.array(z.string()).describe('Key insights from the note'),
  action_items: z.array(z.string()).describe('Action items identified'),
  topics: z.array(z.string()).describe('Topic tags'),
  sentiment: z.enum(['positive', 'neutral', 'negative']).describe('Note sentiment'),
});

// Template Writer — creates email templates with placeholders
export const TemplateWriterSchema = z.object({
  subject_template: z.string().describe('Subject line with {{placeholders}}'),
  body_html: z.string().describe('HTML body with {{placeholders}}'),
  personalization_fields: z.array(z.string()).describe('Placeholder field names used'),
  tone_description: z.string().describe('Description of the tone used'),
});

// Email Personalization — resolves placeholders for a contact
export const EmailPersonalizationSchema = z.object({
  subject: z.string().describe('Personalized subject line'),
  body_html: z.string().describe('Personalized HTML body'),
  personalization_notes: z.string().describe('Notes on what was personalized'),
});

// Contact Summary — engagement analysis
export const ContactSummarySchema = z.object({
  summary: z.string().describe('2-4 sentence relationship summary'),
  key_topics: z.array(z.string()).describe('Main discussion topics'),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']).describe('Relationship sentiment'),
  last_interaction_days_ago: z.number().min(0).describe('Days since last interaction'),
  recommended_actions: z.array(z.string()).describe('Suggested next steps'),
  engagement_score: z.number().min(0).max(100).describe('Engagement score 0-100'),
});
```

**Why Zod?**
- The SDK auto-generates JSON schema documentation from your Zod schema and injects it into the prompt
- The LLM's response is validated against the schema — if it fails, the SDK retries (up to `max_tries`)
- You get full TypeScript type safety on the output

### Building a Bot

Each bot follows the same three-part pattern: **Prompt + Schema + Registration**.

```typescript
// bots/NoteEnricherBot.ts
import {
  MixinBot,
  StructuredOutputBotMixin,
  StructuredPromptGroup,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
} from '@firebrandanalytics/ff-agent-sdk';
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import type { BotTypeHelper } from '@firebrandanalytics/ff-agent-sdk';
import type { BrokerTextContent } from '@firebrandanalytics/shared-types';
import { NoteEnrichmentSchema, type NOTE_ENRICHMENT_OUTPUT } from '../schemas.js';
import { NoteEnricherPrompt, type NoteEnricherPTH } from '../prompts/NoteEnricherPrompt.js';

// Type helper linking prompt → output → content types
export type NoteEnricherBTH = BotTypeHelper<
  NoteEnricherPTH,
  NOTE_ENRICHMENT_OUTPUT,
  NOTE_ENRICHMENT_OUTPUT,
  any,
  BrokerTextContent
>;

class NoteEnricherBotBase extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<NoteEnricherBTH, [StructuredOutputBotMixin<NoteEnricherBTH, typeof NoteEnrichmentSchema>]>,
  [StructuredOutputBotMixin<NoteEnricherBTH, typeof NoteEnrichmentSchema>]
]> {
  constructor() {
    // Build the dynamic input prompt (receives request.input at runtime)
    const inputPrompt = new Prompt<NoteEnricherPTH>({
      role: 'user',
      static_args: {} as Record<string, never>,
    });
    inputPrompt.add_section(
      new PromptTemplateTextNode<NoteEnricherPTH>({
        content: (request) => request.input as string,
      })
    );

    // Compose the prompt group: system prompt + user input
    const promptGroup = new StructuredPromptGroup<NoteEnricherPTH>({
      base: new PromptGroup<NoteEnricherPTH>([
        { name: 'note_enricher_prompt', prompt: new NoteEnricherPrompt() },
      ]),
      input: new PromptGroup<NoteEnricherPTH>([
        { name: 'note_content', prompt: inputPrompt },
      ]),
    });

    super(
      [{
        name: 'NoteEnricherBot',
        model_pool_name: 'firebrand-gpt-5.2-failover',
        base_prompt_group: promptGroup,
        static_args: {} as Record<string, never>,
        max_tries: 3,     // Retry on schema validation failure
      }],
      [{ schema: NoteEnrichmentSchema }]
    );
  }
}

@RegisterBot('NoteEnricherBot')
export class NoteEnricherBot extends NoteEnricherBotBase {
  public override get_semantic_label_impl(): string {
    return 'NoteEnricherBot';
  }
}
```

**Anatomy of a Bot:**

| Component | Purpose |
|-----------|---------|
| `BotTypeHelper` | TypeScript generic linking prompt, input, output, and content types |
| `ComposeMixins(MixinBot, StructuredOutputBotMixin)` | Composes base bot behavior with structured JSON output |
| `StructuredPromptGroup` | Groups the system prompt (`base`) and user input (`input`) |
| `model_pool_name` | Which LLM model pool the broker routes to |
| `max_tries: 3` | Retries if the LLM output fails Zod validation |
| `@RegisterBot('NoteEnricherBot')` | Registers the bot in the global registry for lookup |

### The Four Bots — At a Glance

All four bots follow the identical structure. The only differences are:

| Bot | Schema | Prompt | Entity Integration |
|-----|--------|--------|--------------------|
| `NoteEnricherBot` | `NoteEnrichmentSchema` | `NoteEnricherPrompt` | Called via `NoteEntity.run()` |
| `ContactSummarizerBot` | `ContactSummarySchema` | `ContactSummarizerPrompt` | Called directly in API endpoint |
| `TemplateWriterBot` | `TemplateWriterSchema` | `TemplateWriterPrompt` | Called directly in API endpoint |
| `EmailPersonalizerBot` | `EmailPersonalizationSchema` | `EmailPersonalizerPrompt` | Called via `EmailDraftEntity.run()` |

### Checkpoint: Verify Entities + Bots Compile

At this point you have all 7 entities, 4 Zod schemas, and 4 bots (minus prompts). Verify everything compiles:

```bash
pnpm typecheck
```

Common errors at this stage:
- **Missing `.js` extension** on imports — ESM requires explicit extensions
- **Bot type helper mismatch** — ensure the `BotTypeHelper` generic references the correct `PromptTypeHelper`
- **Circular imports** — entity → bot → entity loops; break them with `import type`

---

## Prompt Engineering

Each bot has a dedicated `Prompt` class that defines the system instructions. The SDK's prompt system supports structured sections, named text nodes, and structured data examples.

### Basic System Prompt

```typescript
// prompts/NoteEnricherPrompt.ts
import {
  Prompt,
  PromptTemplateSectionNode,
  PromptTemplateTextNode,
} from '@firebrandanalytics/ff-agent-sdk';
import type { PromptTypeHelper } from '@firebrandanalytics/ff-agent-sdk';

export type NoteEnricherPTH = PromptTypeHelper<
  string,
  { static: Record<string, never>; request: Record<string, never> },
  any
>;

export class NoteEnricherPrompt extends Prompt<NoteEnricherPTH> {
  constructor() {
    super({ role: 'system', static_args: {} as Record<string, never> });

    // Section 1: Task description
    this.add_section(new PromptTemplateSectionNode<NoteEnricherPTH>({
      semantic_type: 'context',
      name: 'task',
      children: [
        new PromptTemplateTextNode<NoteEnricherPTH>({
          content: `You are a CRM note analysis assistant.

Analyze the provided note and extract structured information:
1. Key insights - important facts, decisions, or observations
2. Action items - tasks or follow-ups mentioned or implied
3. Topics - relevant subject tags for categorization
4. Sentiment - overall tone of the note

Be precise and extract only what is actually present or clearly implied.`,
        }),
      ],
    }));

    // Section 2: Rules and constraints
    this.add_section(new PromptTemplateSectionNode<NoteEnricherPTH>({
      semantic_type: 'rule',
      name: 'rules',
      children: [
        new PromptTemplateTextNode<NoteEnricherPTH>({
          name: 'enrichment_rules',
          content: `## Enrichment Rules
- Key insights: 1-5 concise statements of fact or observation
- Action items: specific, actionable tasks (not vague suggestions)
- Topics: 2-5 short tags (e.g., "pricing", "renewal", "product-demo")
- Sentiment: positive, neutral, or negative based on content
- Do not fabricate information not present in the note`,
        }),
      ],
    }));
  }
}
```

**Prompt Structure Best Practices:**
- Use `semantic_type: 'context'` for task descriptions
- Use `semantic_type: 'rule'` for constraints and guidelines
- Use `semantic_type: 'sample_output'` for examples (see below)
- Named sections help with debugging — you can see which section contributed to the final prompt

### Prompts with Sample Output

The `TemplateWriterPrompt` includes a structured data example so the LLM knows the exact expected format:

```typescript
// prompts/TemplateWriterPrompt.ts
import { PromptTemplateStructDataNode } from '@firebrandanalytics/ff-agent-sdk';

const SAMPLE_OUTPUT = {
  subject_template: 'Quick question about {{company}}\'s growth plans',
  body_html: '<p>Hi {{first_name}},</p><p>I noticed {{company}} has been expanding...</p>',
  personalization_fields: ['first_name', 'company'],
  tone_description: 'Professional yet conversational',
};

// Inside the constructor:
this.add_section(new PromptTemplateSectionNode<TemplateWriterPTH>({
  semantic_type: 'sample_output',
  name: 'sample_output',
  children: [
    new PromptTemplateTextNode<TemplateWriterPTH>({
      content: 'Here is an example of the expected output format:',
    }),
    new PromptTemplateStructDataNode<TemplateWriterPTH>({
      data: SAMPLE_OUTPUT,
    }),
  ],
}));
```

**`PromptTemplateStructDataNode`** serializes the sample data into the prompt, giving the LLM a concrete example of the expected JSON structure. Combined with the Zod schema (which `StructuredOutputBotMixin` auto-injects), this significantly improves output quality.

---

## The Agent Bundle

The agent bundle is the application container that ties everything together: entity registration, API endpoints, initialization logic, and health checks.

### The Constructor

```typescript
// agent-bundle.ts
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
  BotRequest,
  Context,
} from '@firebrandanalytics/ff-agent-sdk';
import { CRMConstructors } from './constructors.js';

// This comes from your firefoundry.json (created by ff-cli)
const APP_ID = 'b4d8f2a3-1e5c-6b7d-8f9a-2c3d4e5f6a78';

export class CRMAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: 'CRMBundle',
        type: 'agent_bundle',
        description: 'CRM demo with email campaigns and AI-powered personalization',
      },
      CRMConstructors,
      createEntityClient(APP_ID) as any
    );
  }
}
```

> **Application ID vs Agent Bundle ID:** In production, an application can contain multiple agent bundles with distinct IDs. For this demo we use a single `APP_ID` for simplicity. In a multi-bundle setup, you'd use separate UUIDs for `id` (the bundle) and `application_id` (the parent application).

### The Constructors Registry

Every entity must be registered. Bot imports must be included to trigger `@RegisterBot` decoration:

```typescript
// constructors.ts
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { ContactEntity } from './entities/ContactEntity.js';
import { NoteEntity } from './entities/NoteEntity.js';
import { InteractionEntity } from './entities/InteractionEntity.js';
import { EmailTemplateEntity } from './entities/EmailTemplateEntity.js';
import { EmailDraftEntity } from './entities/EmailDraftEntity.js';
import { CampaignEntity } from './entities/CampaignEntity.js';
import { CampaignRecipientEntity } from './entities/CampaignRecipientEntity.js';

// Import bot modules to trigger @RegisterBot decorator registration
import './bots/TemplateWriterBot.js';
import './bots/EmailPersonalizerBot.js';
import './bots/ContactSummarizerBot.js';
import './bots/NoteEnricherBot.js';

export const CRMConstructors = {
  ...FFConstructors,          // Include SDK built-in types
  ContactEntity,
  NoteEntity,
  InteractionEntity,
  EmailTemplateEntity,
  EmailDraftEntity,
  CampaignEntity,
  CampaignRecipientEntity,
} as const;
```

**Critical:** The bot import side-effects (`import './bots/TemplateWriterBot.js'`) register each bot in the global bot registry. Without these imports, `FFAgentBundle.getBotOrThrow('TemplateWriterBot')` will throw at runtime.

### Initialization and Edge Registration

The `init()` method runs once at startup. Use it to register edge types:

```typescript
override async init() {
  await super.init();    // Always call super first!

  const edgeTypes = [
    'HasNote', 'HasInteraction', 'HasDraft',
    'RecipientOf', 'UsesTemplate', 'HasRecipient', 'UsedInCampaign',
  ];

  for (const edgeName of edgeTypes) {
    try {
      await this.entity_client.create_node({
        name: edgeName,
        general_type_name: 'Edge',
        agent_bundle_id: this.get_app_id(),
      });
    } catch (err: any) {
      // 409 / "already exists" is expected on restart
      if (err?.status !== 409 && !err?.message?.includes('already exists')) {
        logger.warn(`Failed to register edge type ${edgeName}`, { error: err.message });
      }
    }
  }

  logger.info('CRMAgentBundle initialized!');
}
```

### Health Check Override

```typescript
override async check_readiness() {
  return {
    healthy: true,
    message: 'CRMBundle is healthy',
    details: { service: 'crm-bundle', app_id: this.get_app_id() },
  };
}
```

### The Edge Creation Helper

Due to a known SDK issue where `EntityNode.connect_to()` wraps edges as `EntityNode` and calls `get_dto()` via `/api/node/<edge_id>` (which 404s), use `entity_client.create_edge()` directly:

```typescript
private async createEdge(
  fromId: string, fromType: string,
  toId: string, toType: string,
  edgeType: string, data: Record<string, any> = {},
) {
  return this.entity_client.create_edge({
    from_node_id: fromId,
    from_node_type: fromType,
    to_node_id: toId,
    to_node_type: toType,
    specific_type_name: edgeType,
    general_type_name: 'Edge',
    data,
  });
}
```

### The Server Entry Point

```typescript
// index.ts
import { createStandaloneAgentBundle, logger } from '@firebrandanalytics/ff-agent-sdk';
import { CRMAgentBundle } from './agent-bundle.js';

const port = parseInt(process.env.PORT || '3000', 10);

async function startServer() {
  logger.info(`Starting CRMBundle server on port ${port}`);
  const server = await createStandaloneAgentBundle(CRMAgentBundle, { port });
  logger.info(`CRMBundle server running on port ${port}`);
}

startServer();
```

### Checkpoint: Build, Start, and Verify Health

This is the most important checkpoint — your bundle should now start and respond to health checks:

```bash
# 1. Build
pnpm build

# 2. Start (ensure port-forwards to entity service, broker, context service are active)
PORT=3000 pnpm dev
```

In another terminal:

```bash
# 3. Verify health
ff-sdk-cli health --url http://localhost:3000
# Expected: {"healthy":true,"message":"CRMBundle is healthy","details":{"service":"crm-bundle",...}}
```

If the health check returns `healthy: true`, your bundle is correctly wired up to the entity service and ready for API endpoints. If it fails, check:
- Port-forwards are active (`procman list` or `ss -tlnp`)
- Entity service is reachable on port 8180
- Broker is reachable on port 50052
- Console output for initialization errors (edge registration failures are OK on first run)

---

## API Design Patterns

Now let's look at the 9 API endpoints and the patterns they demonstrate.

### Pattern 1: Create Entity and Return

The simplest pattern — create an entity, build an edge, return the result:

```typescript
@ApiEndpoint({ method: 'POST', route: 'contacts' })
async createContact(data: {
  first_name: string; last_name: string; email: string;
  phone?: string; company?: string; job_title?: string;
  tags?: string[]; actor_id: string;
}) {
  const contact = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `contact-${data.email}`,
    specific_type_name: 'ContactEntity',
    general_type_name: 'ContactEntity',
    status: 'Completed',
    data: {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone || null,
      company: data.company || null,
      job_title: data.job_title || null,
      tags: data.tags || [],
      actor_id: data.actor_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

  const dto = await contact.get_dto();
  return { contact_id: dto.id, ...dto.data };
}
```

### Pattern 2: Search and Filter

```typescript
@ApiEndpoint({ method: 'GET', route: 'contacts' })
async listContacts(data?: { tag?: string }) {
  const tag = data?.tag;
  const { result } = await this.entity_client.search_nodes_scoped({
    specific_type_name: 'ContactEntity',
  });

  const contacts = [];
  for (const node of result) {
    if (!tag || (node.data.tags && (node.data.tags as string[]).includes(tag))) {
      contacts.push({ contact_id: node.id, ...node.data });
    }
  }
  return { contacts, count: contacts.length };
}
```

### Pattern 3: Create + Edge + Optional Bot

Adding a note creates the entity, links it to the contact, and optionally runs AI enrichment:

```typescript
@ApiEndpoint({ method: 'POST', route: 'contacts/note' })
async addNote(data: {
  contact_id: string; content: string; category?: string;
  actor_id: string; enrich?: boolean;
}) {
  // 1. Create the note entity
  const note = await this.entity_factory.create_entity_node({ ... });
  const noteDto = await note.get_dto();

  // 2. Create edge from contact → note
  await this.createEdge(data.contact_id, 'ContactEntity', noteDto.id!, 'NoteEntity', 'HasNote');

  // 3. Optionally enrich via NoteEnricherBot
  if (data.enrich) {
    try {
      const enrichment = await (note as NoteEntity).run();
      const enrichedDto = await note.get_dto();
      await note.update_data({ ...enrichedDto.data, enrichment });
    } catch (err: any) {
      logger.warn('[API] Note enrichment failed, returning unenriched note', {
        note_id: noteDto.id, error: err.message,
      });
    }
    const finalDto = await note.get_dto();
    return { note_id: finalDto.id, ...finalDto.data };
  }

  return { note_id: noteDto.id, ...noteDto.data };
}
```

**Notice the graceful degradation:** If the AI enrichment fails (broker down, model error), the endpoint still returns the unenriched note.

### Pattern 4: Direct Bot Invocation

For operations that don't map to a single entity's `.run()`, invoke bots directly:

```typescript
@ApiEndpoint({ method: 'POST', route: 'templates/generate' })
async generateTemplate(data: {
  description: string; category: string; tone?: string; actor_id: string;
}) {
  const input = [
    `Create an email template for the following:`,
    `Description: ${data.description}`,
    `Category: ${data.category}`,
    data.tone ? `Desired tone: ${data.tone}` : '',
  ].filter(Boolean).join('\n');

  const bot = FFAgentBundle.getBotOrThrow('TemplateWriterBot');
  const request = new BotRequest({
    args: {} as Record<string, never>,
    input,
    context: new Context({ id: 'template-gen', data: {} } as any),
  });

  let result: any;
  try {
    const response = await bot.run(request);
    result = response.output;
  } catch (err: any) {
    logger.error('[API] TemplateWriterBot failed', { error: err.message });
    return { error: 'Template generation failed.' };
  }

  // Create the template entity with the AI-generated content
  const template = await this.entity_factory.create_entity_node({ ... });
  const templateDto = await template.get_dto();
  return { template_id: templateDto.id, ...templateDto.data };
}
```

**When to use direct invocation vs. `BotRunnableEntityMixin`:**

| Approach | Use When |
|----------|----------|
| `entity.run()` via BotRunnableEntityMixin | The bot's input comes entirely from the entity's own data |
| `FFAgentBundle.getBotOrThrow().run()` | You need to assemble input from multiple sources, or the entity doesn't exist yet |

### Pattern 5: Graph Traversal with N+1 Avoidance

The contact summary endpoint traverses the entity graph to gather notes and interactions:

```typescript
@ApiEndpoint({ method: 'POST', route: 'contacts/summarize' })
async summarizeContact(data: { contact_id: string }) {
  const contact = await this.entity_factory.get_entity(data.contact_id);
  const contactDto = await contact.get_dto();

  // Get all outgoing edges (HasNote, HasInteraction, etc.)
  const edgeMap = await this.entity_client.get_node_edges_from(data.contact_id);
  const allEdges = Object.values(edgeMap).flat();

  // Fetch all target entities CONCURRENTLY (avoids N+1)
  const targets = await Promise.all(
    allEdges.map(async (edge: any) => {
      try {
        const entity = await this.entity_factory.get_entity(edge.to_node_id);
        return entity.get_dto();
      } catch { return null; }
    })
  );

  // Classify by type and build prompt...
}
```

**The N+1 Fix:** Without `Promise.all`, each edge target would be fetched sequentially — 10 notes means 10 serial round-trips. With `Promise.all`, all fetches happen concurrently.

### Pattern 6: Multi-Entity Coordination

The draft personalization flow touches three entity types:

```
Template → personalize with Contact data → create Draft (preview)
```

> **Note:** This pattern creates a preview draft only. [Part 5](./part-05-email-workflows.md) extends it with a `personalize-and-send` endpoint that also delivers the email via the notification service.

```typescript
@ApiEndpoint({ method: 'POST', route: 'drafts/personalize' })
async personalizeDraft(data: {
  template_id: string; contact_id: string; actor_id: string;
}) {
  // 1. Load template and contact
  const template = await this.entity_factory.get_entity(data.template_id);
  const templateDto = await template.get_dto();
  const contact = await this.entity_factory.get_entity(data.contact_id);
  const contactDto = await contact.get_dto();

  // 2. Create draft entity with both template + contact data
  const draft = await this.entity_factory.create_entity_node({ ... });

  // 3. Run the EmailPersonalizerBot via the entity's .run()
  const personalization = await (draft as EmailDraftEntity).run();

  // 4. Store the personalized result and create graph edges
  const draftDto = await draft.get_dto();
  await draft.update_data({ ...draftDto.data, ...personalization, status: 'ready' });
  await this.createEdge(data.template_id, 'EmailTemplateEntity', draftDto.id!, 'EmailDraftEntity', 'HasDraft');
  await this.createEdge(data.contact_id, 'ContactEntity', draftDto.id!, 'EmailDraftEntity', 'HasDraft');

  const finalDto = await draft.get_dto();
  return { draft_id: finalDto.id, ...finalDto.data };
}
```

---

## Testing Your Bundle

If you followed the checkpoints, your bundle is already running and passing health checks. Now let's test the full API workflow end-to-end.

Use the **`ff-sdk-cli`** tool to test your bundle. It's the canonical client for interacting with agent bundle servers — it handles authentication, proper content-type headers, error formatting, and works identically whether you're testing locally or through the Kong gateway.

> **Why not curl?** Raw `curl` commands bypass the SDK's client layer, miss error handling, and teach the wrong habit. `ff-sdk-cli` mirrors how production clients interact with your bundle and is the same tool used by CI pipelines, E2E tests, and the `ff-sdk` TypeScript client under the hood.

### Full Workflow Test

```bash
# Set the URL once for convenience
export FF_SDK_URL=http://localhost:3000

# 1. Create a contact
ff-sdk-cli api call contacts --method POST --body '{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@acme.com",
  "company": "Acme Corp",
  "tags": ["enterprise", "vip"],
  "actor_id": "sales-rep@company.com"
}'

# 2. Add a note with AI enrichment
ff-sdk-cli api call contacts/note --method POST --body '{
  "contact_id": "<contact_id from step 1>",
  "content": "Had a productive call about Q2 expansion plans. Jane mentioned they need 50 more seats by March. Budget approved, waiting on legal review.",
  "category": "sales",
  "actor_id": "sales-rep@company.com",
  "enrich": true
}'

# 3. Log an interaction
ff-sdk-cli api call contacts/interaction --method POST --body '{
  "contact_id": "<contact_id>",
  "interaction_type": "call",
  "subject": "Q2 Expansion Discussion",
  "details": "Discussed 50-seat expansion, budget approved, pending legal",
  "actor_id": "sales-rep@company.com"
}'

# 4. Generate AI summary
ff-sdk-cli api call contacts/summarize --method POST \
  --body '{"contact_id": "<contact_id>"}'

# 5. Generate an email template
ff-sdk-cli api call templates/generate --method POST --body '{
  "description": "Follow-up email after expansion discussion",
  "category": "sales-followup",
  "tone": "professional and warm",
  "actor_id": "sales-rep@company.com"
}'

# 6. Approve the template
ff-sdk-cli api call templates/approve --method POST --body '{
  "template_id": "<template_id from step 5>",
  "actor_id": "manager@company.com"
}'

# 7. Personalize for the contact
ff-sdk-cli api call drafts/personalize --method POST --body '{
  "template_id": "<template_id>",
  "contact_id": "<contact_id>",
  "actor_id": "sales-rep@company.com"
}'

# 8. Create a campaign
ff-sdk-cli api call campaigns --method POST --body '{
  "name": "Q2 Expansion Follow-up",
  "description": "Follow up with enterprise contacts about expansion",
  "template_id": "<template_id>",
  "tag_filter": ["enterprise"],
  "actor_id": "sales-rep@company.com"
}'

# Tip: pipe any command through jq for readable output
ff-sdk-cli api call contacts --query '{"tag": "enterprise"}' | jq .
```

### Verifying the Entity Graph

After running the workflow, verify entities and relationships were created correctly:

```bash
# Search for your contact in the entity graph
ff-eg-read search --type ContactEntity --app-id <your_agent_bundle_id>

# View outgoing edges from a contact (notes, interactions, drafts)
ff-eg-read edges-from <contact_id>

# Inspect a specific entity's full DTO
ff-eg-read node <entity_id>
```

---

## Summary

You've now built a complete CRM agent bundle that demonstrates:

- **BotRunnableEntityMixin** for entities that invoke AI processing
- **Structured output bots** with Zod schemas for validated LLM responses
- **Prompt engineering** with sections, rules, and sample outputs
- **API endpoints** covering CRUD, search, AI generation, and multi-entity coordination
- **Graph traversal** with N+1 query avoidance
- **HITL workflows** for template approval
- **Error handling** with graceful degradation when AI services are unavailable
- **Edge registration** at bundle initialization

### Architecture Decision Reference

| Decision | What We Chose | Why |
|----------|---------------|-----|
| Entity vs. flat data | Entities in graph | Relationships, traversal, and reuse across workflows |
| Bot invocation style | Mixed (entity `.run()` + direct) | Entity-driven for self-contained ops, direct for multi-source assembly |
| Output validation | Zod + `StructuredOutputBotMixin` | Type safety, auto-retry on invalid output, schema docs in prompts |
| Edge creation | Direct `entity_client.create_edge()` | Works around SDK `connect_to` bug |
| Error handling | Graceful degradation | Return partial results when AI is unavailable |
| Health checks | Custom `check_readiness()` | Service identification in multi-bundle deployments |

---

**Next:** [Part 3: Consumer GUI — Next.js Frontend](./part-03-consumer-gui.md)
