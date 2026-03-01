---
name: ff-add-entity
description: Add a domain entity to an existing agent bundle (SDK v4)
user_invocable: true
argument: entity name (e.g. TaskEntity)
---

# Add a Domain Entity to an Agent Bundle

Add a new entity class to an existing FireFoundry agent bundle following the Entity-Bot-Prompt pattern.

## 1. Resolve context

Use the provided argument as the entity name. If not provided, ask the user what domain concept this entity represents.

Locate the agent bundle — look for `firefoundry.json` with `"type": "agent-bundle"` in the current directory or an `apps/*/` subdirectory. If in a monorepo root, ask which bundle to add the entity to.

## 2. Read existing code

Before creating anything, read the existing bundle structure:

```
apps/<bundle>/src/agent-bundle.ts   — the main bundle class
apps/<bundle>/src/constructors.ts   — entity type registry
apps/<bundle>/src/entities/         — existing entities (if any)
```

## 3. Create the entity file

Create `apps/<bundle>/src/entities/<EntityName>.ts`:

```typescript
import {
  RunnableEntityClass,
  RunnableEntityDecorator,
} from "@firebrandanalytics/ff-agent-sdk";

// Type helper for the entity — defines input/output shapes
interface EntityTypeHelper {
  input: {
    // Define what this entity receives when run
    [key: string]: any;
  };
  output: {
    // Define what this entity produces
    [key: string]: any;
  };
}

@RunnableEntityDecorator({
  generalType: "<GeneralCategory>",      // e.g., "Workflow", "Step", "Task", "Document"
  specificType: "<EntityName>",           // e.g., "TaskEntity", "AnalysisStep"
  allowedConnections: {
    // Define which entity types this can connect to via edges
    // "<EdgeType>": ["<TargetEntityType>", ...]
    // e.g., "Calls": ["AnalysisStep"], "Contains": ["ResultEntity"]
  },
})
export class <EntityName> extends RunnableEntityClass<EntityTypeHelper> {
  /**
   * The main execution logic for this entity.
   * Called when the entity is invoked via /invoke or entity.run().
   * Uses async generators for streaming progress updates.
   */
  protected override async *run_impl(
    input: EntityTypeHelper["input"]
  ): AsyncGenerator<any, EntityTypeHelper["output"], never> {
    // Yield progress updates
    yield { type: "INTERNAL_UPDATE", message: "Processing..." };

    // Access entity data
    const dto = await this.get_dto();
    const entityData = dto.data;

    // Access platform services through the bundle
    // this.entity_client  — entity graph operations
    // this.entity_factory — create/retrieve entities
    // this.context_client — working memory

    // Do work here...

    // Return the final result
    return {
      // output fields
    };
  }
}
```

### Entity Type Guidelines

**General types** (broad category):
- `Workflow` — multi-step orchestration
- `Step` — a single processing step in a workflow
- `Task` — a user-facing unit of work
- `Document` — a data artifact
- `Collection` — groups other entities

**Specific types** should be unique and descriptive: `TaskEntity`, `AnalysisStep`, `ArticleDocument`.

**Allowed connections** define the entity graph edges:
- `"Calls"` — workflow calls a step
- `"Contains"` — collection contains items
- `"Produces"` — step produces output
- `"References"` — entity references another

## 4. Register in constructors

Edit `apps/<bundle>/src/constructors.ts` to add the new entity:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { <EntityName> } from "./entities/<EntityName>.js";

export const MyConstructors = {
  ...FFConstructors,
  <EntityName>: <EntityName>,
  // ... other entities
} as const;
```

The key in the registry **must match** the `specificType` in the decorator. This is how the entity factory resolves types by name.

## 5. Use from the bundle

In `agent-bundle.ts`, you can now create and interact with the entity:

### Create via @ApiEndpoint

```typescript
@ApiEndpoint({ method: "POST", route: "create-task" })
async createTask(body: any = {}): Promise<any> {
  const dto = await this.entity_factory.create_entity_node({
    agent_bundle_id: this.get_app_id(),
    name: `task-${Date.now()}`,
    specific_type_name: "<EntityName>",
    general_type_name: "<GeneralType>",
    status: "Pending",
    data: body,
  });
  return { entityId: dto.id, status: dto.status };
}
```

**Note**: The DTO field is `agent_bundle_id` in SDK v4 (renamed from `app_id` in v2). The bundle's `get_app_id()` method still returns the correct UUID.

### Invoke (run) an entity

```typescript
@ApiEndpoint({ method: "POST", route: "run-task" })
async runTask(body: any = {}): Promise<any> {
  const { entityId } = body;
  const entity = await this.entity_factory.get_entity(entityId);
  const result = await entity.run(body);
  return { result };
}
```

### Connect entities via edges

```typescript
const child = await parentEntity.appendConnection(
  "Calls",           // edge type
  "<ChildType>",     // target entity's specificType
  `child-${Date.now()}`,  // name
  { /* initial data */ }
);
```

## 6. Build and verify

```bash
pnpm run build
```

Fix any TypeScript errors. Common issues:
- Import path must end in `.js` (ESM modules): `from "./entities/MyEntity.js"`
- Decorator must match class: `specificType` in decorator = key in constructors
- `run_impl` must be an async generator (use `yield` and `return`)

## 7. Test the entity

After deploying (use `/ff-deploy-local` skill), test entity creation and invocation:

```bash
# Create
curl -s -X POST http://localhost:8000/agents/<env-name>/<bundle-name>/api/create-task \
  -H "Content-Type: application/json" \
  -d '{"title": "test task"}'

# Run (with the returned entityId)
curl -s -X POST http://localhost:8000/agents/<env-name>/<bundle-name>/api/run-task \
  -H "Content-Type: application/json" \
  -d '{"entityId": "<id-from-create>"}'
```
