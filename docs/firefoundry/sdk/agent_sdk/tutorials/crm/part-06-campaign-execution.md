# Part 6: Campaign Execution & Parallel Patterns

In [Part 5](./part-05-email-workflows.md) you connected the bundle to the notification service for single-email workflows. Now we'll scale that up to **parallel campaign execution** — sending AI-personalized emails to hundreds of contacts simultaneously with capacity-controlled concurrency.

**What you'll learn:**
- Converting entities to `RunnableEntity` with `run_impl()` async generators
- Using `parallelCalls()` to fan out child entities for concurrent work
- Managing concurrency with `HierarchicalTaskPoolRunner` and `CapacitySource`
- Streaming real-time progress updates via status envelopes
- The parent/child entity pattern for parallel workflows

**What you'll build:** A campaign execution system where `CampaignEntity` fans out `CampaignRecipientEntity` children — each one personalizes and sends a single email — with capacity limits preventing notification service overload.

---

## Architecture

```
executeCampaign endpoint
    │
    ▼
CampaignEntity.run_impl()      ← RunnableEntity (parent)
    │
    ├─ parallelCalls() ─────────────────────────────────────┐
    │                                                        │
    ▼                  ▼                  ▼                  ▼
CampaignRecipient  CampaignRecipient  CampaignRecipient  CampaignRecipient
    │                  │                  │                  │
    ▼                  ▼                  ▼                  ▼
EmailDraftEntity   EmailDraftEntity   EmailDraftEntity   EmailDraftEntity
(AI personalize)   (AI personalize)   (AI personalize)   (AI personalize)
    │                  │                  │                  │
    ▼                  ▼                  ▼                  ▼
Notification Svc   Notification Svc   Notification Svc   Notification Svc
(send email)       (send email)       (send email)       (send email)
```

**Capacity control:**
- Per-campaign: 3 concurrent sends
- Global: 5 concurrent sends across all campaigns
- `HierarchicalTaskPoolRunner` enforces both limits

This follows the same pattern as the illustrated-story demo's `StoryPipelineEntity` → `ImageGenerationEntity` parallel fan-out.

---

## Step 1: CampaignEntity as a RunnableEntity

The key insight: `CampaignEntity` extends `RunnableEntity` instead of `EntityNode`. Its `run_impl()` method is an **async generator** that yields progress updates and returns a final result.

### Imports

```typescript
// In CampaignEntity.ts
import {
  RunnableEntity,
  EntityMixin,
  EntityFactory,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import type {
  EntityNodeTypeHelper,
  EntityTypeHelper,
  RunnableEntityTypeHelper,
} from '@firebrandanalytics/ff-agent-sdk';
import type { EntityNodeDTO, JSONObject, JSONValue } from '@firebrandanalytics/shared-types';
import type { UUID } from '@firebrandanalytics/shared-types';
import {
  CapacitySource,
  HierarchicalTaskPoolRunner,
  SourceFromIterable,
} from '@firebrandanalytics/shared-utils';
import { CampaignRecipientEntity } from './CampaignRecipientEntity.js';
```

The parallelism utilities come from `@firebrandanalytics/shared-utils`, not the agent SDK itself. They're general-purpose concurrency primitives:

| Import | Purpose |
|--------|---------|
| `CapacitySource` | Semaphore-like concurrency limiter with hierarchical chaining |
| `HierarchicalTaskPoolRunner` | Runs tasks from a source, respecting capacity limits |
| `SourceFromIterable` | Wraps an async iterable (from `parallelCalls()`) into a task source |

### DTO Interfaces

```typescript
export interface CampaignEntityDTOData extends JSONObject {
  name: string;
  description: string;
  template_id: string;
  status: string;
  tag_filter: string[];
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  actor_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: JSONValue;
}

export interface CampaignExecutionResult extends JSONObject {
  campaign_id: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  [key: string]: JSONValue;
}
```

Note the `[key: string]: JSONValue` index signature — this is required because the DTO `data` field extends `JSONObject`. The `_contacts` and `_template` snapshot data (set by the `executeCampaign` endpoint) are accessed via type assertion rather than declared as typed fields.

### Type Helpers

```typescript
export type CampaignEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>,
  CampaignEntityDTO,
  'CampaignEntity',
  {},
  {}
>;

export type CampaignEntityRETH = RunnableEntityTypeHelper<
  CampaignEntityENH,
  CampaignExecutionResult
>;
```

The `RunnableEntityTypeHelper` generic tells the SDK what type `run_impl()` returns.

### Global Capacity

```typescript
const GLOBAL_SEND_CAPACITY = new CapacitySource(5);
```

This process-level constant limits total concurrent email sends across **all** campaigns. If two campaigns execute simultaneously, they share this pool of 5 slots.

### Entity Class and `run_impl()`

```typescript
@EntityMixin({
  specificType: 'CampaignEntity',
  generalType: 'CampaignEntity',
  allowedConnections: {
    HasRecipient: ['CampaignRecipientEntity'],
    UsesTemplate: ['EmailTemplateEntity'],
  },
})
export class CampaignEntity extends RunnableEntity<CampaignEntityRETH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | CampaignEntityDTO) {
    super(factory, idOrDto);
  }

  protected override async *run_impl() {
    const dto = await this.get_dto();
    const { template_id, actor_id, name } = dto.data;

    // Snapshot data set by the executeCampaign endpoint
    const contacts = dto.data._contacts as CampaignContactSnapshot[] | undefined;
    const templateSnap = dto.data._template as CampaignTemplateSnapshot | undefined;

    // ─── Validate pre-loaded data ───────────────────────────────

    if (!contacts || !templateSnap) {
      const msg = 'Campaign data missing: _contacts and _template must be set by executeCampaign endpoint';
      logger.error('[CampaignEntity] Missing snapshot data', { entityId: this.id });
      await this.updateEntityData({ status: 'failed', error: msg });
      return {
        campaign_id: this.id!,
        status: 'failed',
        total_recipients: 0,
        sent_count: 0,
        failed_count: 0,
      } as CampaignExecutionResult;
    }

    const totalRecipients = contacts.length;

    yield await this.createStatusEnvelope(
      'RUNNING',
      `Sending to ${totalRecipients} contacts`,
    );
    await this.updateEntityData({ stage: 'sending' });

    // ─── Parallel send via CampaignRecipientEntity ──────────────

    const taskItems = contacts.map((contact) => ({
      name: `recipient-${contact.id}`,
      data: {
        contact_id: contact.id,
        campaign_id: this.id!,
        template_id,
        contact_name: `${contact.first_name} ${contact.last_name}`,
        contact_email: contact.email,
        contact_company: contact.company,
        subject_template: templateSnap.subject_template,
        body_html_template: templateSnap.body_html,
        actor_id,
        draft_id: null,
        status: 'pending',
        error_message: null,
        sent_at: null,
      },
    }));

    const taskSource = new SourceFromIterable(
      this.parallelCalls(CampaignRecipientEntity, taskItems),
    );

    // Per-campaign capacity (3 concurrent), linked to global (5 total)
    const campaignCapacity = new CapacitySource(3, GLOBAL_SEND_CAPACITY);

    const runner = new HierarchicalTaskPoolRunner<any, any>(
      'campaign-send',
      taskSource,
      campaignCapacity,
    );

    let sentCount = 0;
    let failedCount = 0;

    for await (const envelope of runner.runTasks()) {
      if (envelope.type === 'FINAL' && envelope.value) {
        if (envelope.value.status === 'sent') {
          sentCount++;
        } else {
          failedCount++;
        }
        await this.updateEntityData({
          sent_count: sentCount,
          failed_count: failedCount,
        });
        yield await this.createStatusEnvelope(
          'RUNNING',
          `Sent ${sentCount}/${totalRecipients} emails (${failedCount} failed)`,
        );
      } else if (envelope.type === 'ERROR') {
        failedCount++;
        await this.updateEntityData({ failed_count: failedCount });
      }
    }

    // ─── Mark completed ─────────────────────────────────────────

    const finalStatus = failedCount > 0 && sentCount > 0
      ? 'completed_with_errors'
      : failedCount > 0 && sentCount === 0
        ? 'failed'
        : 'completed';

    await this.updateEntityData({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      stage: 'completed',
      updated_at: new Date().toISOString(),
    });

    return {
      campaign_id: this.id!,
      status: finalStatus,
      total_recipients: totalRecipients,
      sent_count: sentCount,
      failed_count: failedCount,
    } as CampaignExecutionResult;
  }
}
```

**Key patterns:**

1. **Data snapshotting**: The `executeCampaign` endpoint pre-loads contacts and template data onto the campaign entity's DTO as `_contacts` and `_template`. This means `run_impl()` doesn't need direct `entity_client` access — it reads everything from its own DTO.

2. **`parallelCalls()`**: Creates `CampaignRecipientEntity` children via `appendOrRetrieveCall()`. Each child gets its own DTO with all the data it needs to personalize and send one email. The method is idempotent — if the campaign is resumed after a crash, existing children are retrieved rather than duplicated.

3. **`SourceFromIterable`**: Wraps the async iterable from `parallelCalls()` into a task source that `HierarchicalTaskPoolRunner` can consume.

4. **Capacity chaining**: `new CapacitySource(3, GLOBAL_SEND_CAPACITY)` means this campaign can use at most 3 concurrent slots, but only if the global pool (5 total) has availability. Two campaigns running simultaneously share the global pool.

5. **Status envelopes**: `yield await this.createStatusEnvelope('RUNNING', message)` pushes real-time progress updates that are streamed to the client via SSE.

---

## Step 2: CampaignRecipientEntity — The Unit of Work

Each `CampaignRecipientEntity` is one "personalize and send" operation — the smallest unit of work in the campaign.

```typescript
// In CampaignRecipientEntity.ts

const NOTIF_URL = process.env.NOTIF_URL || 'http://localhost:8085';

@EntityMixin({
  specificType: 'CampaignRecipientEntity',
  generalType: 'CampaignRecipientEntity',
  allowedConnections: {},
})
export class CampaignRecipientEntity extends RunnableEntity<CampaignRecipientEntityRETH> {
  protected override async *run_impl() {
    const dto = await this.get_dto();
    const d = dto.data;

    yield await this.createStatusEnvelope('RUNNING', `Personalizing email for ${d.contact_name}`);

    try {
      // Step 1: Create EmailDraftEntity for personalization
      const draftEntity = await this.appendOrRetrieveCall(
        EmailDraftEntity,
        'personalize-draft',
        {
          contact_id: d.contact_id,
          template_id: d.template_id,
          contact_name: d.contact_name,
          contact_email: d.contact_email,
          contact_company: d.contact_company,
          subject_template: d.subject_template,
          body_html_template: d.body_html_template,
          subject: null,
          body_html: null,
          status: 'generating',
          actor_id: d.actor_id,
          personalization_notes: null,
          created_at: new Date().toISOString(),
        },
      );

      // Run the EmailPersonalizerBot via BotRunnableEntityMixin
      const personalization: any = yield* await draftEntity.start();

      // Step 2: Send via notification service
      yield await this.createStatusEnvelope('RUNNING', `Sending email to ${d.contact_email}`);

      const idempotencyKey = `campaign-${d.campaign_id}-${d.contact_id}`;

      const notifResponse = await fetch(`${NOTIF_URL}/send/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: [d.contact_email],
          subject: personalization.subject,
          html: personalization.body_html,
          from: d.actor_id,
          idempotencyKey,
          metadata: {
            draft_id: draftEntity.id,
            contact_id: d.contact_id,
            campaign_id: d.campaign_id,
            template_id: d.template_id,
          },
        }),
      });

      if (!notifResponse.ok) {
        throw new Error(`Notification service ${notifResponse.status}`);
      }

      // Step 3: Mark sent
      await this.markSent(draftEntity.id!);

      return {
        contact_id: d.contact_id,
        draft_id: draftEntity.id!,
        status: 'sent',
        notification_id: null,
      } as RecipientSendResult;

    } catch (err: any) {
      await this.markFailed(err?.message || String(err));

      return {
        contact_id: d.contact_id,
        draft_id: d.draft_id || '',
        status: 'failed',
        notification_id: null,
      } as RecipientSendResult;
    }
  }
}
```

**Key patterns:**

1. **`appendOrRetrieveCall()`**: Creates a child `EmailDraftEntity` idempotently. The string `'personalize-draft'` is a call key — if this recipient is reprocessed (crash recovery), the same draft entity is retrieved instead of creating a duplicate.

2. **`yield* await draftEntity.start()`**: Delegates to the draft entity's `run_impl()`, which uses `BotRunnableEntityMixin` to invoke the `EmailPersonalizerBot`. The `yield*` propagates any status envelopes from the child entity.

3. **Idempotency key**: `campaign-${campaign_id}-${contact_id}` ensures that even if the notification service call is retried, the same email isn't sent twice.

4. **Error isolation**: Each recipient catches its own errors and returns `status: 'failed'` rather than crashing the entire campaign. The parent `CampaignEntity` tallies successes and failures.

---

## Step 3: The Execute Endpoint

The `executeCampaign` endpoint in the agent bundle validates inputs, pre-loads data, and sets up the campaign entity for execution:

```typescript
// In agent-bundle.ts

@ApiEndpoint({ method: 'POST', route: 'campaigns/execute' })
async executeCampaign(data: { campaign_id: string; actor_id: string }) {
  const campaign = await this.entity_factory.get_entity(data.campaign_id) as CampaignEntity;
  const campaignDto = await campaign.get_dto();

  if (campaignDto.data.status !== 'draft') {
    return { error: `Campaign cannot be executed (status: ${campaignDto.data.status})` };
  }

  // Validate template is approved
  const template = await this.entity_factory.get_entity(campaignDto.data.template_id);
  const templateDto = await template.get_dto();
  if (templateDto.data.status !== 'approved') {
    return { error: `Template is not approved (status: ${templateDto.data.status})` };
  }

  // Query matching contacts
  const { result: allContacts } = await this.entity_client.search_nodes_scoped({
    specific_type_name: 'ContactEntity',
  });

  const tagFilter = campaignDto.data.tag_filter;
  const matchingContacts = allContacts.filter((c: any) => {
    const tags: string[] = c.data?.tags || [];
    return tagFilter.some((filterTag: string) => tags.includes(filterTag));
  });

  // Snapshot contacts + template data onto the campaign entity
  await campaign.update_data({
    ...campaignDto.data,
    status: 'executing',
    total_recipients: matchingContacts.length,
    updated_at: new Date().toISOString(),
    _contacts: matchingContacts.map((c: any) => ({
      id: c.id,
      first_name: c.data.first_name,
      last_name: c.data.last_name,
      email: c.data.email,
      company: c.data.company || null,
    })),
    _template: {
      subject_template: templateDto.data.subject_template,
      body_html: templateDto.data.body_html,
    },
  });

  return {
    campaign_id: campaignDto.id,
    entity_id: campaignDto.id,
    status: 'executing',
    total_recipients: matchingContacts.length,
    message: 'Campaign execution started. Use iterator run for progress streaming.',
  };
}
```

**Why snapshot data onto the entity?**

`RunnableEntity.run_impl()` runs within the entity — it only has access to its own DTO, not to the bundle's `entity_client`. By storing `_contacts` and `_template` as snapshot data on the campaign's DTO, `run_impl()` has everything it needs without requiring external dependencies.

This is the same pattern as the illustrated-story demo, where `StoryPipelineEntity` receives all its configuration data before execution begins.

---

## Step 4: Running the Campaign

The `executeCampaign` endpoint returns an `entity_id`. The client uses this to start and stream the execution:

```bash
# Start campaign execution and stream progress via SSE
ff-sdk-cli iterator run <entity_id>
```

This calls the entity's `run_impl()` and streams each `yield`ed status envelope as a Server-Sent Event. The output looks like:

```
data: {"type":"RUNNING","message":"Sending to 15 contacts"}
data: {"type":"RUNNING","message":"Sent 1/15 emails (0 failed)"}
data: {"type":"RUNNING","message":"Sent 2/15 emails (0 failed)"}
...
data: {"type":"RUNNING","message":"Sent 15/15 emails (0 failed)"}
data: {"type":"FINAL","value":{"campaign_id":"...","status":"completed","total_recipients":15,"sent_count":15,"failed_count":0}}
```

---

## Step 5: BFF and GUI Updates

### BFF Proxy

```typescript
// In CampaignsController.ts
public initializeRoutes(): void {
  this.router.post('/', this.asyncHandler(this.create.bind(this)));
  this.router.post('/execute', this.asyncHandler(this.execute.bind(this)));
}

private async execute(req: Request, res: Response) {
  const body = { ...req.body, actor_id: this.getActorId(req) };
  const result = await this.client.call_api_endpoint(
    'campaigns/execute', { method: 'POST', body }
  );
  res.json(result);
}
```

### GUI Campaign Tab

```typescript
// In api.ts
export async function executeCampaign(campaign_id: string) {
  return request<any>('/api/v1/campaigns/execute', {
    method: 'POST',
    body: JSON.stringify({ campaign_id }),
  });
}
```

The Campaigns tab adds an "Execute Campaign" button that calls this endpoint and displays the returned status:

```typescript
function CampaignsTab() {
  const [execResult, setExecResult] = useState<any>(null);

  async function handleExecute(campaignId: string) {
    const result = await api.executeCampaign(campaignId);
    setExecResult(result);
  }

  // Show execute button for campaigns with status 'draft'
  // After execution, display entity_id for SSE streaming
}
```

---

## Capacity Control Deep Dive

The capacity system uses two levels:

```typescript
// Process-level: max 5 concurrent sends across ALL campaigns
const GLOBAL_SEND_CAPACITY = new CapacitySource(5);

// Inside run_impl(): max 3 concurrent sends for THIS campaign
const campaignCapacity = new CapacitySource(3, GLOBAL_SEND_CAPACITY);
```

`CapacitySource` is a semaphore with hierarchical chaining. When you pass a parent capacity source as the second argument, acquiring a slot requires availability in **both** the local and parent sources.

**Example with two campaigns running simultaneously:**

| Time | Campaign A (3 slots) | Campaign B (3 slots) | Global (5 slots) |
|------|---------------------|---------------------|-----------------|
| t=0 | Starts 3 sends | — | 3/5 used |
| t=1 | 3 running | Starts 2 sends | 5/5 used |
| t=2 | 3 running | 2 running, wants 3rd | **Blocked** (global full) |
| t=3 | 1 completes, 2 running | Gets 3rd slot | 5/5 used |

Campaign B can't use its 3rd local slot until the global pool has availability. This prevents notification service overload regardless of how many campaigns run in parallel.

---

## The Entity Hierarchy

After campaign execution, the entity graph shows a clear hierarchy:

```
CampaignEntity (status: completed, sent: 15, failed: 0)
  ├─ HasRecipient → CampaignRecipientEntity (status: sent, contact: Alice)
  │     └─ (child) → EmailDraftEntity (status: ready, personalized content)
  ├─ HasRecipient → CampaignRecipientEntity (status: sent, contact: Bob)
  │     └─ (child) → EmailDraftEntity (status: ready, personalized content)
  ├─ HasRecipient → CampaignRecipientEntity (status: failed, contact: Charlie)
  │     └─ (child) → EmailDraftEntity (status: generating, partial content)
  └─ UsesTemplate → EmailTemplateEntity (status: approved)
```

Every email send is fully auditable — you can trace from campaign → recipient → draft → notification service call.

Verify with `ff-eg-read`:

```bash
# Check campaign entity status
ff-eg-read node <campaign_entity_id>

# List all recipients
ff-eg-read edges-from <campaign_entity_id>

# Check a specific recipient's draft
ff-eg-read edges-from <recipient_entity_id>
```

---

## Checkpoint: Verify Campaign Execution

1. Create 3+ contacts with overlapping tags (e.g., `["enterprise"]`, `["enterprise", "tech"]`)
2. Generate and approve a template
3. Create a campaign targeting the `enterprise` tag
4. Execute the campaign:

```bash
ff-sdk-cli api call campaigns/execute \
  --method POST \
  --body '{"campaign_id":"<CAMPAIGN_ID>","actor_id":"test@example.com"}'
```

5. Stream progress:

```bash
ff-sdk-cli iterator run <entity_id>
```

6. Verify results:
   - Campaign entity status should be `completed` (or `completed_with_errors`)
   - Each `CampaignRecipientEntity` should have `status: sent` or `status: failed`
   - Each recipient should have a child `EmailDraftEntity` with personalized content
   - Notification service logs should show the sent emails

---

## Summary

Campaign execution demonstrates the full power of FireFoundry's entity-bot architecture:

- **`RunnableEntity`** encapsulates complex workflows as entity behavior
- **`parallelCalls()`** with **`appendOrRetrieveCall()`** provides idempotent parallel fan-out
- **`HierarchicalTaskPoolRunner`** with **`CapacitySource`** gives fine-grained concurrency control
- **Status envelopes** enable real-time progress streaming via SSE
- **Entity graph persistence** makes every step auditable and resumable

The same pattern scales to any parallel workflow — document processing, data enrichment, multi-channel notifications, or batch AI analysis. The key ingredients are always the same: a parent `RunnableEntity` that fans out child entities, capacity sources that prevent overload, and status envelopes that stream progress.

### Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `crm/`.
