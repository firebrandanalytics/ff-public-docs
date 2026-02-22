# Part 1: A Working Agent Bundle

In this part you'll scaffold a complete agent bundle that ingests supplier product data, validates it with a decorator-based data class, stores the result as a typed entity in the graph, and deploy it end-to-end. By the end, you'll have a running service you can test from the CLI.

## Step 1: Scaffold the Application

Use `ff-cli` to create a new application and agent bundle:

```bash
ff application create catalog-intake
cd catalog-intake
ff agent-bundle create catalog-bundle
```

This creates a monorepo with:

```
catalog-intake/
├── firefoundry.json              # Application-level config (lists components)
├── apps/
│   └── catalog-bundle/           # Your agent bundle
│       ├── firefoundry.json      # Bundle-level config (port, resources, health)
│       ├── src/
│       │   ├── index.ts          # Server entry point
│       │   ├── agent-bundle.ts   # Bundle class
│       │   └── constructors.ts   # Entity registry
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── packages/
│   └── shared-types/             # Shared type definitions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### Register the Application

Register the application with the entity service. This creates an application record in the entity graph and assigns an application ID:

```bash
ff application register
```

This writes the `applicationId` into the root `firefoundry.json`. You'll use this ID in your agent bundle class to scope all entity operations to this application.

Install dependencies:

```bash
pnpm install
```

---

## Step 2: Define the Product Data Class

The heart of this application is a validation class. Instead of scattering `if` checks and `typeof` guards across your codebase, you declare the contract once with decorators.

Create the V1 validator:

**`apps/catalog-bundle/src/validators/SupplierProductValidator.ts`**:

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceCase,
  CoerceType,
  ValidateRange,
  ValidatePattern,
  Serializable,
} from '@firebrandanalytics/shared-utils/validation';

@Serializable()
export class SupplierProductValidator {
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  category!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  subcategory!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  brand_line!: string;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;

  @CoerceTrim()
  color_variant!: string;

  @CoerceTrim()
  @ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)
  size_range!: string;
}
```

Read the decorators top-to-bottom for each field -- that's the execution order:

- **`@CoerceTrim()`** strips leading and trailing whitespace. Suppliers love sending `"  Air Max 90  "`.
- **`@CoerceCase('title')`** normalizes to title case (`air max 90` becomes `Air Max 90`). `@CoerceCase('lower')` lowercases.
- **`@CoerceType('number')`** coerces strings to numbers. Supplier CSVs send everything as strings, so `"89.99"` becomes `89.99`.
- **`@ValidateRequired()`** rejects `null`, `undefined`, and empty strings. Runs after coercion, so trimmed-to-empty strings are caught.
- **`@ValidateRange(0.01)`** ensures prices are positive. A base cost of `0` or `-5` fails validation.
- **`@ValidatePattern(/^\d+(\.\d+)?-\d+(\.\d+)?$/)`** enforces the size range format: `"7-13"` or `"7.5-12.5"`.
- **`@Serializable()`** enables JSON round-trips. When this class instance is stored in the entity graph, `toJSON()` preserves the class identity. When it's loaded back, `fromJSON()` reconstructs a real `SupplierProductValidator` instance -- not a plain object.

The factory drives the whole pipeline:

```typescript
const factory = new ValidationFactory();
const product = await factory.create(SupplierProductValidator, rawPayload);
// product.product_name is trimmed and title-cased
// product.base_cost is a number, guaranteed > 0
// product is a SupplierProductValidator instance with a prototype chain
```

---

## Step 3: Why Data Classes Matter

Before we go further, let's see what this replaces. Two approaches to the same problem:

> **Without data classes (the raw JSON way):**
>
> ```typescript
> function handleSubmission(raw: any) {
>   if (!raw.product_name) throw new Error('Missing product_name');
>   const name = typeof raw.product_name === 'string'
>     ? raw.product_name.trim()
>     : String(raw.product_name);
>   const titleName = name.charAt(0).toUpperCase() + name.slice(1);
>
>   const cost = typeof raw.base_cost === 'string'
>     ? parseFloat(raw.base_cost)
>     : raw.base_cost;
>   if (isNaN(cost) || cost <= 0) throw new Error('Invalid cost');
>
>   if (typeof raw.msrp === 'string') raw.msrp = parseFloat(raw.msrp);
>   if (!raw.msrp || raw.msrp <= 0) throw new Error('Invalid msrp');
>
>   // ... 50 more lines of this for every field
>   // Then you store it with `as SupplierProduct` and pray
>   return raw as SupplierProduct;
> }
> ```
>
> This works until it doesn't. The validation is scattered across the handler, the coercion logic is duplicated in three places (the bot, the GUI, the admin panel), and the `as` cast means TypeScript stops helping you.

> **With data classes:**
>
> ```typescript
> const product = await factory.create(SupplierProductValidator, rawPayload);
> // Done. product_name is trimmed and title-cased. base_cost is a number.
> // product is a real class instance with a prototype chain.
> ```
>
> One line. One definition. Used everywhere.

Why this matters for the rest of the tutorial:

- **The validator IS the documentation.** Decorators declare the contract. New developers read the class, not a wiki page.
- **One definition, used everywhere.** The same `SupplierProductValidator` class runs in the agent bundle, the Next.js GUI (for client-side preview), and any backend service that touches product data.
- **Changes are localized.** When the business adds a `sku` field or changes the size format, you update one class. Every consumer gets the change.
- **The class instance carries its identity.** Thanks to `@Serializable`, when you store a `SupplierProductValidator` in the entity graph and load it back, you get a `SupplierProductValidator` -- not a `{ product_name: "..." }` plain object. `instanceof` checks work. Methods work. The prototype chain is intact.

---

## Step 4: Create the Entity

The entity wraps the validation result in the entity graph. When `dataClass` is set, the SDK automatically reconstructs `dto.data` as a `SupplierProductValidator` instance every time the entity is loaded -- zero custom code.

**`apps/catalog-bundle/src/entities/SupplierProductDraft.ts`**:

```typescript
import {
  EntityNode,
  EntityDecorator,
} from '@firebrandanalytics/ff-agent-sdk';
import { SupplierProductValidator } from '../validators/SupplierProductValidator.js';

@EntityDecorator({
  specificType: 'SupplierProductDraft',
  dataClass: SupplierProductValidator,
})
export class SupplierProductDraft extends EntityNode<any> {}
```

That's the entire entity. `@EntityDecorator` does two things:

1. **Registers the type** (like `@EntityMixin({ specificType })` in other tutorials).
2. **Binds `dataClass`** so the SDK knows how to reconstruct the data.

The reconstruction mechanism works like this:

- **On write:** When a `SupplierProductValidator` instance is stored as entity data, `@Serializable` fires `toJSON()`. The result is a plain JSON object that includes a `__class` marker identifying the source class.
- **On read:** When you call `entity.get_dto()`, the SDK sees the `dataClass` binding and calls `fromJSON()` on the stored JSON. The result is a real `SupplierProductValidator` instance -- not raw JSON.

You never call `toJSON()` or `fromJSON()` yourself. The SDK handles the round-trip automatically.

---

## Step 5: Wire Up the Bot

The `CatalogIntakeBot` is the entry point for supplier submissions. It accepts raw JSON, runs it through the validator, and returns the result.

**`apps/catalog-bundle/src/bots/CatalogIntakeBot.ts`**:

```typescript
import {
  RegisterBot,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import {
  ValidationFactory,
} from '@firebrandanalytics/shared-utils/validation';
import { SupplierProductValidator } from '../validators/SupplierProductValidator.js';

interface CatalogIntakeRequest {
  supplier_id: string;
  raw_payload: Record<string, unknown>;
}

interface CatalogIntakeResult {
  success: boolean;
  validated_data?: Record<string, unknown>;
  errors?: Array<{ field: string; message: string }>;
}

@RegisterBot('CatalogIntakeBot')
export class CatalogIntakeBot {
  private factory: ValidationFactory;

  constructor() {
    this.factory = new ValidationFactory();
  }

  async validate(request: CatalogIntakeRequest): Promise<CatalogIntakeResult> {
    const { supplier_id, raw_payload } = request;

    logger.info('[CatalogIntakeBot] Validating submission', {
      supplier_id,
    });

    try {
      const validated = await this.factory.create(
        SupplierProductValidator,
        raw_payload,
      );

      logger.info('[CatalogIntakeBot] Validation succeeded', {
        supplier_id,
        product_name: validated.product_name,
      });

      return {
        success: true,
        validated_data: validated as unknown as Record<string, unknown>,
      };
    } catch (error: any) {
      logger.warn('[CatalogIntakeBot] Validation failed', {
        supplier_id,
        error: error.message,
      });

      const errors: Array<{ field: string; message: string }> =
        Array.isArray(error.errors)
          ? error.errors.map((e: any) => ({
              field: e.propertyPath ?? e.field ?? 'unknown',
              message: e.message ?? String(e),
            }))
          : [{ field: error.propertyPath ?? 'unknown', message: error.message }];

      return {
        success: false,
        errors,
      };
    }
  }
}
```

**Key details:**

- **`@RegisterBot('CatalogIntakeBot')`** registers the bot in the global component registry. The entity's `BotRunnableEntityMixin` looks it up by this name.
- **`ValidationFactory.create()`** runs the full decorator pipeline: coercion first, then validation. If any validation fails, it throws with structured error details.
- **Error unpacking:** Validators may throw an aggregate error with an `errors` array containing per-field failures. The bot maps all of them into the response so callers see every failing field, not just the first one.

### Connecting the Bot to the Entity

The entity and bot are connected through `BotRunnableEntityMixin`. If you want the entity to run the bot automatically when started (the SDK pattern from the [News Analysis](../news-analysis/part-01-bundle.md) and [Illustrated Story](../illustrated-story/part-01-setup-and-safety.md) tutorials), you can extend the entity with the mixin:

**`apps/catalog-bundle/src/entities/SupplierProductDraft.ts`** (full version with mixin):

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  logger,
  Context,
} from '@firebrandanalytics/ff-agent-sdk';
import type {
  EntityFactory,
  BotRequestArgs,
} from '@firebrandanalytics/ff-agent-sdk';
import { AddMixins } from '@firebrandanalytics/shared-utils';

@EntityMixin({
  specificType: 'SupplierProductDraft',
  generalType: 'SupplierProductDraft',
  allowedConnections: {},
})
export class SupplierProductDraft extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
)<any> {
  constructor(factory: EntityFactory<any>, idOrDto: any) {
    super(
      [factory, idOrDto] as any,
      ['CatalogIntakeBot'],
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: any,
  ): Promise<BotRequestArgs<any>> {
    const dto = await (this as any).get_dto();
    const { supplier_id, raw_payload } = dto.data;

    logger.info('[SupplierProductDraft] Building bot request', {
      entity_id: (this as any).id,
      supplier_id,
    });

    return {
      args: { supplier_id } as any,
      input: JSON.stringify(raw_payload),
      context: new Context(dto),
    };
  }
}
```

How this works:

- **`AddMixins(RunnableEntity, BotRunnableEntityMixin)`** composes two classes. `RunnableEntity` provides the lifecycle (`run()`, progress events). `BotRunnableEntityMixin` connects it to a registered bot.
- **`['CatalogIntakeBot']`** in the constructor tells the mixin which bot to look up from the registry at runtime. This must match the name in `@RegisterBot('CatalogIntakeBot')`.
- **`get_bot_request_args_impl()`** is the only method you implement. It pulls `supplier_id` and `raw_payload` from the entity's stored data and packages them for the bot.
- **On write:** Bot output becomes entity data automatically. `toJSON()` fires via `@Serializable`, serializing the validated class instance to JSON for storage.
- **On read:** When the entity is loaded, `fromJSON()` fires, reconstructing the `SupplierProductValidator` instance. `dto.data` is typed, not raw JSON.

For Part 1, either entity pattern works. The simpler `@EntityDecorator` version is enough to demonstrate the data class round-trip. The mixin version shows the full SDK pattern -- we'll use it more in later parts.

---

## Step 6: Bundle Entry Point

### Constructor Map

Register the entity so the bundle can instantiate it.

**`apps/catalog-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { SupplierProductDraft } from './entities/SupplierProductDraft.js';

// Import bot module to trigger @RegisterBot decorator registration
import './bots/CatalogIntakeBot.js';

export const CatalogBundleConstructors = {
  ...FFConstructors,
  SupplierProductDraft: SupplierProductDraft,
} as const;
```

The `import './bots/CatalogIntakeBot.js'` line is critical -- it ensures the `@RegisterBot` decorator fires and registers the bot in the global component registry before any entity tries to look it up.

### Agent Bundle Class

**`apps/catalog-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { CatalogBundleConstructors } from './constructors.js';
import { CatalogIntakeBot } from './bots/CatalogIntakeBot.js';

// Replace with your applicationId from firefoundry.json
const APP_ID = 'YOUR_APPLICATION_ID';

export class CatalogBundleAgentBundle extends FFAgentBundle<any> {
  private intakeBot: CatalogIntakeBot;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: 'CatalogIntakeBundle',
        type: 'agent_bundle',
        description: 'Supplier product intake and validation service',
      },
      CatalogBundleConstructors,
      createEntityClient(APP_ID),
    );
    this.intakeBot = new CatalogIntakeBot();
  }

  override async init() {
    await super.init();
    logger.info('CatalogIntakeBundle initialized!');
  }

  @ApiEndpoint({ method: 'POST', route: 'intake' })
  async intake(data: {
    supplier_id: string;
    raw_payload: Record<string, unknown>;
  }) {
    const { supplier_id, raw_payload } = data;

    if (!supplier_id || !raw_payload) {
      throw new Error("Missing 'supplier_id' or 'raw_payload' in request body");
    }

    logger.info(`[API] POST /api/intake - supplier: ${supplier_id}`);

    // Validate the submission
    const result = await this.intakeBot.validate({
      supplier_id,
      raw_payload,
    });

    if (!result.success) {
      return result;
    }

    // Store the validated product as an entity
    const entity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `product-${supplier_id}-${Date.now()}`,
      specific_type_name: 'SupplierProductDraft',
      general_type_name: 'SupplierProductDraft',
      status: 'Validated',
      data: result.validated_data!,
    });

    return {
      success: true,
      entity_id: (entity as any).id,
      validated_data: result.validated_data,
    };
  }

  @ApiEndpoint({ method: 'GET', route: 'product' })
  async getProduct(data: { entityId: string }) {
    const { entityId } = data;

    if (!entityId) {
      throw new Error("Missing 'entityId' query parameter");
    }

    const entity = await this.entity_factory.get_entity(entityId);
    const dto = await (entity as any).get_dto();

    return {
      entity_id: entityId,
      data: dto.data,
      data_is_instance: dto.data instanceof Object && dto.data.constructor?.name !== 'Object',
      class_name: dto.data?.constructor?.name ?? 'Object',
    };
  }
}
```

Replace `YOUR_APPLICATION_ID` with the `applicationId` from your root `firefoundry.json` (written by `ff application register` in Step 1).

The `getProduct` endpoint is there to prove the round-trip works. When you load the entity back, `dto.data` should be a `SupplierProductValidator` instance -- and `class_name` will confirm it.

### Server Entry Point

**`apps/catalog-bundle/src/index.ts`**:

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { CatalogBundleAgentBundle } from './agent-bundle.js';

// Import bot for registration side effect
import './bots/CatalogIntakeBot.js';

// Re-export validators and entities for external consumers
export { SupplierProductValidator } from './validators/SupplierProductValidator.js';
export { SupplierProductDraft } from './entities/SupplierProductDraft.js';
export { CatalogIntakeBot } from './bots/CatalogIntakeBot.js';

const port = parseInt(process.env.PORT || '3000', 10);

async function startServer() {
  try {
    const server = await createStandaloneAgentBundle(
      CatalogBundleAgentBundle,
      { port },
    );
    logger.info(`CatalogIntakeBundle server running on port ${port}`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

The re-exports matter: they let the GUI package (Part 2) import `SupplierProductValidator` directly from the bundle package for client-side validation preview.

---

## Step 7: Deploy and Test

### Build

```bash
pnpm install
npx turbo build
```

### Deploy

Build the Docker image and deploy to your cluster:

```bash
ff ops build --app-name catalog-bundle
ff ops deploy --app-name catalog-bundle
```

### Test with ff-sdk-cli

**Check health:**

```bash
ff-sdk-cli health --url http://localhost:3001
# { "healthy": true }
```

**Submit a product:**

Post raw supplier data to the intake endpoint. Notice the messy input -- whitespace, string prices, inconsistent casing:

```bash
ff-sdk-cli api call intake \
  --method POST \
  --body '{
    "supplier_id": "supplier-A",
    "raw_payload": {
      "product_name": "  air max 90  ",
      "category": "RUNNING",
      "subcategory": "  Road Running  ",
      "brand_line": "AIR MAX",
      "base_cost": "89.99",
      "msrp": "120.00",
      "color_variant": "  Infrared / White  ",
      "size_range": "7-13"
    }
  }' \
  --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "success": true,
    "entity_id": "a1b2c3d4-...",
    "validated_data": {
      "product_name": "Air Max 90",
      "category": "running",
      "subcategory": "road running",
      "brand_line": "air max",
      "base_cost": 89.99,
      "msrp": 120.00,
      "color_variant": "Infrared / White",
      "size_range": "7-13"
    }
  }
}
```

Notice what the decorators did:

- `"  air max 90  "` became `"Air Max 90"` (trimmed + title-cased)
- `"RUNNING"` became `"running"` (lowercased)
- `"89.99"` (string) became `89.99` (number)
- `"  Infrared / White  "` became `"Infrared / White"` (trimmed)

**Test validation failures:**

```bash
ff-sdk-cli api call intake \
  --method POST \
  --body '{
    "supplier_id": "supplier-A",
    "raw_payload": {
      "product_name": "",
      "category": "running",
      "base_cost": "-5",
      "msrp": "0",
      "size_range": "invalid"
    }
  }' \
  --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "success": false,
    "errors": [
      { "field": "product_name", "message": "product_name is required" },
      { "field": "base_cost", "message": "base_cost must be >= 0.01" },
      { "field": "msrp", "message": "msrp must be >= 0.01" },
      { "field": "size_range", "message": "size_range does not match required pattern" }
    ]
  }
}
```

Every failing field is reported -- not just the first one.

**Verify the entity round-trip:**

Use the `entity_id` from the successful submission to load the entity back:

```bash
ff-sdk-cli api call product \
  --query '{"entityId":"a1b2c3d4-..."}' \
  --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "entity_id": "a1b2c3d4-...",
    "data": {
      "product_name": "Air Max 90",
      "category": "running",
      "subcategory": "road running",
      "brand_line": "air max",
      "base_cost": 89.99,
      "msrp": 120.00,
      "color_variant": "Infrared / White",
      "size_range": "7-13"
    },
    "data_is_instance": true,
    "class_name": "SupplierProductValidator"
  }
}
```

The key line is `"class_name": "SupplierProductValidator"`. The data that came back from the entity graph is not a plain `Object` -- it's a real `SupplierProductValidator` instance, reconstructed from JSON by the `@Serializable` + `dataClass` machinery. `instanceof SupplierProductValidator` returns `true`. Methods on the class (if you add any) work. The prototype chain is intact.

This is the core promise of the data class pattern: **raw input goes in, typed class instances come out, and they stay typed through the entire lifecycle** -- validation, storage, retrieval, serialization, deserialization.

### Verify with Diagnostic Tools

```bash
# View the entity node
ff-eg-read node get <entity-id>

# View the entity's stored data
ff-eg-read node get <entity-id> | jq '.data'

# List recent SupplierProductDraft entities
ff-eg-read search nodes-scoped --page 1 --size 10 \
  --condition '{"specific_type_name": "SupplierProductDraft"}' \
  --order-by '{"created": "desc"}'
```

---

## What You've Built

You now have a deployed agent bundle with:

- A **validation class** (`SupplierProductValidator`) that normalizes and validates supplier data with decorators
- An **entity** (`SupplierProductDraft`) that stores validated products with automatic class reconstruction via `dataClass`
- A **bot** (`CatalogIntakeBot`) that accepts raw JSON and runs the validation pipeline
- An **API endpoint** (`POST /api/intake`) that validates, stores, and returns the result
- A **round-trip proof** (`GET /api/product`) showing that data loaded from the entity graph is a typed class instance, not raw JSON

The full cycle: raw supplier input -> decorator pipeline (coerce + validate) -> typed class instance -> entity graph -> load -> typed class instance again.

---

## What's Next

Your agent bundle works, but you're testing via CLI. In [Part 2: The Catalog GUI](./part-02-catalog-gui.md), we'll add a Next.js GUI with a product intake form and a database browser -- and the `SupplierProductValidator` class you just wrote will be shared between the bundle and the frontend. Same class, same decorators, zero duplication.
