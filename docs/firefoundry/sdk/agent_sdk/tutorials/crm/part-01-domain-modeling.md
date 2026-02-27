# Part 1: CRM Domain Modeling and Entity Graph Design

This is the most involved entity graph modeling exercise in the FireFoundry tutorial series. A CRM is a natural fit — contacts, notes, interactions, templates, drafts, campaigns, and recipients form a rich, interconnected graph with multiple behavioral patterns. Getting the model right here makes everything that follows (bots, APIs, the GUI) fall into place naturally.

**What you'll learn:**
- The 4-step modeling process applied to a real CRM domain
- How to classify entities by behavioral role (data, logic, AI-runnable)
- Edge design: when to use directed edges vs. shared references
- The HITL (human-in-the-loop) approval pattern for AI-generated content
- Translating a whiteboard graph into FireFoundry TypeScript code

**What you'll build:** 7 entity types with typed DTOs, graph relationships, and domain methods — ready for bots and API endpoints in Part 2.

---

## The CRM Problem

We're building a system where sales reps manage contacts, take notes, log interactions, generate email campaigns with AI, and send personalized emails. Let's apply the [4-step modeling process](../../entity_graph/entity_modeling_tutorial.md).

### Step 1: Identify the Nouns

What are the core objects in a CRM?

| Noun | What It Represents |
|------|--------------------|
| **Contact** | A person the sales team interacts with |
| **Note** | Free-text record attached to a contact |
| **Interaction** | A specific touchpoint (call, email, meeting) |
| **Email Template** | Reusable HTML template with `{{placeholders}}` |
| **Email Draft** | A personalized email ready to send to one contact |
| **Campaign** | A bulk email operation targeting contacts by tags |
| **Campaign Recipient** | Per-contact tracking within a campaign |

Seven nouns = seven entity types. That's more than most tutorials, but CRM domains are inherently relational — trying to flatten this into fewer entities would lose the graph's expressiveness.

### Step 2: Identify the Verbs (Edges)

How do these nouns relate?

```
Contact ──HasNote──────► Note
Contact ──HasInteraction─► Interaction
Contact ──HasDraft───────► EmailDraft
Template ──HasDraft──────► EmailDraft
Campaign ──UsesTemplate──► EmailTemplate
Campaign ──HasRecipient──► CampaignRecipient
Contact ──RecipientOf───► CampaignRecipient
Template ──UsedInCampaign► Campaign
```

Notice some patterns:

- **`HasNote`, `HasInteraction`** are simple ownership edges — a contact *has* notes and interactions
- **`HasDraft`** is interesting — *both* `Contact` and `EmailTemplate` connect to `EmailDraft`. A draft sits at the intersection of "which contact" and "which template"
- **`CampaignRecipient`** is a junction entity — it exists to track per-contact-per-campaign status, and both `Contact` and `Campaign` connect to it

### Step 3: Identify the "Doers" (Runnable Entities)

Which entities represent an AI process, not just data storage?

| Entity | Passive or Active? | Why |
|--------|--------------------|-----|
| Contact | Passive (with domain logic) | Stores data, has methods like `addTag()`, but no AI processing |
| Note | **Active** | When enrichment is requested, an AI bot extracts insights, action items, and sentiment |
| Interaction | Passive | Pure data record of a touchpoint |
| EmailTemplate | Passive (with HITL logic) | Stores AI-generated templates, but the *generation* happens in the API layer, not the entity |
| EmailDraft | **Active** | When personalization runs, an AI bot resolves `{{placeholders}}` for a specific contact |
| Campaign | Passive (with domain logic) | Orchestration entity — coordinates recipients, but the AI work happens at the draft level |
| CampaignRecipient | Passive | Per-recipient status tracking |

**Two runnable entities**: `NoteEntity` and `EmailDraftEntity`. These will use `BotRunnableEntityMixin` — when you call `.run()`, they automatically invoke their paired bot and return structured output.

### Step 4: Sketch the Graph

```
                        ┌──────────────────┐
                        │  CampaignEntity  │
                        │  ───────────────  │
                        │  name, status,   │
                        │  tag_filter      │
                        └──────┬───────────┘
                               │ UsesTemplate
                               ▼
┌────────────────┐    HasNote  ┌──────────────────────┐   HasDraft   ┌──────────────────┐
│  NoteEntity    │◄────────────│    ContactEntity      │────────────►│  EmailDraftEntity │
│  ────────────  │             │  ──────────────────── │             │  ───────────────── │
│  content,      │             │  name, email, company │             │  subject, body_html│
│  enrichment    │             │  tags, job_title      │             │  status            │
│  🤖 Runnable   │             └──────┬────────────────┘             │  🤖 Runnable       │
└────────────────┘                    │ HasInteraction               └──────────────────┘
                                      ▼                                      ▲
                              ┌──────────────────────┐            ┌──────────────────────┐
                              │  InteractionEntity   │            │ EmailTemplateEntity  │
                              │  ──────────────────  │            │ ──────────────────── │
                              │  type, subject,      │            │ subject_template,    │
                              │  details             │            │ body_html, status    │
                              └──────────────────────┘            │ ✋ HITL approve/reject│
                                                                  └──────────────────────┘
```

**Key observations from the sketch:**

1. **ContactEntity is the hub** — most edges radiate from it. This is typical of CRM domains: the contact is the central node that everything connects to.

2. **EmailDraftEntity is a bridge** — it connects *both* a template and a contact. This is a common graph pattern for "instantiation" — the draft is a specific instance of a template applied to a specific contact.

3. **Two behavioral zones** — the left side (notes, interactions) is *recording* data. The right side (templates, drafts, campaigns) is *generating and delivering* content. The contact sits in the middle.

4. **CampaignRecipientEntity** (not shown for clarity) is a junction node between Campaign and Contact, tracking per-recipient delivery status.

---

## Modeling Decisions Worth Discussing

### Why Separate Note from Interaction?

Both are "things attached to a contact." Why not one entity?

| | Note | Interaction |
|---|---|---|
| **Content** | Free-text, variable length | Structured (type, subject, details) |
| **AI behavior** | Enrichable (runnable) | None — pure record |
| **Created by** | Human writes it | Human logs it after the fact |
| **Temporal** | No fixed time | Has `occurred_at` timestamp |

Combining them would require conditional logic everywhere: "is this a note or an interaction? Does it have enrichment? Does it have a timestamp?" Separate entities keep each one focused.

### Why is Template Generation Not a Runnable Entity?

`EmailTemplateEntity` stores AI-generated content, but the entity itself isn't runnable. The generation happens in the API endpoint (direct bot invocation). Why?

Because template generation requires **external input** (a description, category, and tone from the user) that doesn't come from the entity's own data. The `BotRunnableEntityMixin` pattern works best when the entity's DTO contains everything the bot needs. Templates are created *from scratch* — there's no pre-existing entity to call `.run()` on.

Contrast with `NoteEntity`: the note already has `content` and `category` in its DTO — everything the enrichment bot needs is right there.

**Rule of thumb:**
- Entity already has the bot's input data → `BotRunnableEntityMixin`
- Bot input comes from external sources or multiple entities → Direct invocation via `FFAgentBundle.getBotOrThrow()`

### Why HITL on Templates but Not Drafts?

Templates are reusable — one bad template affects every contact it's personalized for. Drafts are one-off — a bad draft only affects one email. The cost of a mistake is different:

```
Template mistake × 500 contacts = 500 bad emails
Draft mistake × 1 contact = 1 bad email
```

HITL approval gates should go where the blast radius is highest. Templates get `approve()`/`reject()` methods; drafts just get sent.

### Edge Direction and the `allowedConnections` Schema

Edges in FireFoundry are **directed** — they go *from* one entity *to* another. The `allowedConnections` declaration on an entity defines what outgoing edges it can have:

```typescript
// ContactEntity can have these outgoing edges:
allowedConnections: {
  HasNote: ['NoteEntity'],           // Contact → Note
  HasInteraction: ['InteractionEntity'], // Contact → Interaction
  HasDraft: ['EmailDraftEntity'],    // Contact → Draft
  RecipientOf: ['CampaignRecipientEntity'], // Contact → Recipient
}

// NoteEntity has no outgoing edges:
allowedConnections: {}  // Leaf node

// EmailTemplateEntity has outgoing edges:
allowedConnections: {
  HasDraft: ['EmailDraftEntity'],    // Template → Draft
  UsedInCampaign: ['CampaignEntity'], // Template → Campaign
}
```

**When two entities both connect to a third** (like Contact → Draft ← Template), declare the edge on *both* source entities. The `HasDraft` edge type is shared, but each source entity lists it independently.

---

## FireFoundry Platform Services Used

Before writing code, here's what the CRM bundle relies on:

| Service | Role | How This Bundle Uses It |
|---------|------|------------------------|
| **Entity Service** | Persistent graph database for entities and edges | Stores contacts, notes, templates, campaigns, and all relationships between them |
| **Broker** | Routes LLM requests to model pools with failover | All four bots (enricher, summarizer, writer, personalizer) send prompts through the broker |
| **Context Service** | Manages prompt context and conversation state | Used internally by the SDK when building bot request contexts |

For architecture and configuration details, see the [Platform Overview](../../README.md) and [Core Concepts Glossary](../../fire_foundry_core_concepts_glossary_agent_sdk.md).

### Local Development Setup

To run this bundle locally, you'll need port-forwards to the platform services:

```bash
# Entity service (default port 8180)
kubectl port-forward -n ff-dev svc/firefoundry-core-entity-service 8180:8080 &

# Broker (default port 50052)
kubectl port-forward -n ff-dev svc/firefoundry-core-ff-broker 50052:50052 &

# Context service (default port 50051)
kubectl port-forward -n ff-dev svc/firefoundry-core-context-service 50051:50051 &
```

Or use `procman` if available:
```bash
procman start entity-svc -- kubectl port-forward -n ff-dev svc/firefoundry-core-entity-service 8180:8080
procman start broker -- kubectl port-forward -n ff-dev svc/firefoundry-core-ff-broker 50052:50052
procman start context-svc -- kubectl port-forward -n ff-dev svc/firefoundry-core-context-service 50051:50051
```

---

## Translating the Model to Code

Now let's turn the whiteboard sketch into TypeScript.

### Entity DTO Data Shapes

Each entity needs a TypeScript interface describing its persisted data. The interface must extend `JSONObject` so the SDK can serialize it:

```typescript
// entities/ContactEntity.ts
import type { EntityNodeDTO, JSONObject, JSONValue } from '@firebrandanalytics/shared-types';

export interface ContactEntityDTOData extends JSONObject {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  tags: string[];
  actor_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: JSONValue;    // Required index signature for JSONObject
}

export type ContactEntityDTO = EntityNodeDTO & {
  data: ContactEntityDTOData;
};
```

**Key Points:**
- Use `string | null` for optional fields (not `string?`) — the entity graph stores explicit nulls
- The `[key: string]: JSONValue` index signature is required by `JSONObject`
- `actor_id` tracks which user made the change — important for audit trails

### Entity Node Type Helpers

The type helper wires up TypeScript generics so the SDK knows your entity's exact shape:

```typescript
import type { EntityNodeTypeHelper, EntityTypeHelper } from '@firebrandanalytics/ff-agent-sdk';

export type ContactEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>,
  ContactEntityDTO,
  'ContactEntity',     // Must match the specificType in @EntityMixin
  {},                  // Methods map (empty for simple entities)
  {}                   // Events map
>;
```

### Data-Only Entities

The simplest pattern — used for `InteractionEntity`, `CampaignEntity`, and `CampaignRecipientEntity`:

```typescript
// entities/InteractionEntity.ts
@EntityMixin({
  specificType: 'InteractionEntity',
  generalType: 'InteractionEntity',
  allowedConnections: {},    // Leaf node — no outgoing edges
})
export class InteractionEntity extends EntityNode<InteractionEntityENH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | InteractionEntityDTO) {
    super(factory, idOrDto);
  }
}
```

### Entities with Domain Methods

`ContactEntity` has tag management. `EmailTemplateEntity` has HITL approval:

```typescript
// entities/ContactEntity.ts
@EntityMixin({
  specificType: 'ContactEntity',
  generalType: 'ContactEntity',
  allowedConnections: {
    HasNote: ['NoteEntity'],
    HasInteraction: ['InteractionEntity'],
    HasDraft: ['EmailDraftEntity'],
    RecipientOf: ['CampaignRecipientEntity'],
  },
})
export class ContactEntity extends EntityNode<ContactEntityENH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | ContactEntityDTO) {
    super(factory, idOrDto);
  }

  async addTag(tag: string): Promise<void> {
    const dto = await this.get_dto();
    const tags = dto.data.tags || [];
    if (!tags.includes(tag)) {
      await this.update_data({
        ...dto.data,
        tags: [...tags, tag],
        updated_at: new Date().toISOString(),
      });
    }
  }

  async removeTag(tag: string): Promise<void> {
    const dto = await this.get_dto();
    const tags = (dto.data.tags || []).filter((t: string) => t !== tag);
    await this.update_data({ ...dto.data, tags, updated_at: new Date().toISOString() });
  }

  async getDisplayName(): Promise<string> {
    const dto = await this.get_dto();
    return `${dto.data.first_name} ${dto.data.last_name}`;
  }
}
```

### HITL Approval Pattern

```typescript
// entities/EmailTemplateEntity.ts
@EntityMixin({
  specificType: 'EmailTemplateEntity',
  generalType: 'EmailTemplateEntity',
  allowedConnections: {
    HasDraft: ['EmailDraftEntity'],
    UsedInCampaign: ['CampaignEntity'],
  },
})
export class EmailTemplateEntity extends EntityNode<EmailTemplateEntityENH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | EmailTemplateEntityDTO) {
    super(factory, idOrDto);
  }

  async approve(actorId: string): Promise<void> {
    const dto = await this.get_dto();
    await this.update_data({
      ...dto.data,
      status: 'approved',
      actor_id: actorId,
      updated_at: new Date().toISOString(),
    });
  }

  async reject(actorId: string): Promise<void> {
    const dto = await this.get_dto();
    await this.update_data({
      ...dto.data,
      status: 'rejected',
      actor_id: actorId,
      updated_at: new Date().toISOString(),
    });
  }
}
```

**The HITL Pattern:**
1. AI generates a template (status: `draft`)
2. A human reviews and calls `approve()` or `reject()`
3. Only approved templates can be used for campaigns
4. `actor_id` tracks who approved, enabling audit trails

### Runnable Entities (Preview)

We'll implement these fully in Part 2, but here's the shape. `NoteEntity` and `EmailDraftEntity` use `BotRunnableEntityMixin`:

```typescript
// entities/NoteEntity.ts  (full implementation in Part 2)
@EntityMixin({
  specificType: 'NoteEntity',
  generalType: 'NoteEntity',
  allowedConnections: {},
})
export class NoteEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[...]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | NoteEntityDTO) {
    super(
      [factory, idOrDto] as any,
      ['NoteEnricherBot']   // Bot to invoke on .run()
    );
  }

  // Builds the bot request from the entity's own data
  protected async get_bot_request_args_impl(...) {
    const dto = await this.get_dto();
    return {
      args: {},
      input: `Category: ${dto.data.category}\n\nNote:\n${dto.data.content}`,
      context: new Context(dto),
    };
  }
}
```

### Entity Pattern Decision Matrix

| Pattern | Use When | CRM Examples |
|---------|----------|-------------|
| `EntityNode` (data-only) | Entity stores data, no behavior | `InteractionEntity`, `CampaignRecipientEntity` |
| `EntityNode` with domain methods | Entity has business logic but no AI | `ContactEntity` (tags), `EmailTemplateEntity` (HITL), `CampaignEntity` (orchestration) |
| `RunnableEntity` + `BotRunnableEntityMixin` | Entity's own data is sufficient input for an AI bot | `NoteEntity` (enrichment), `EmailDraftEntity` (personalization) |

---

## Checkpoint: Verify Compilation

Before moving on to bots and API endpoints in Part 2, make sure all 7 entity files compile cleanly:

```bash
pnpm typecheck
```

Fix any type errors now — catching them early is much easier than debugging after bots and the bundle class are added.

Common issues at this stage:
- Missing `.js` extension on imports (ESM requirement)
- `allowedConnections` referencing entity type names that don't match `@EntityMixin({ specificType })` exactly
- Forgetting the `[key: string]: JSONValue` index signature on DTO interfaces

---

## Summary

You've designed and implemented a 7-entity CRM domain model with:

- **3 behavioral categories**: data-only, domain methods, AI-runnable
- **7 edge types** defining the relationship schema
- **HITL approval** on the highest-blast-radius entity (templates)
- **Two runnable entities** (`NoteEntity`, `EmailDraftEntity`) ready for bot integration
- **ContactEntity as the hub** with 4 outgoing edge types

The graph looks complex on paper, but each entity is focused on one responsibility and each edge has a clear semantic meaning. This is the strength of graph modeling — complexity is managed through relationships, not conditionals.

---

**Next:** [Part 2: Agent Bundle — Bots, Prompts, and API Endpoints](./part-02-agent-bundle.md)
