# Part 1: A Working Agent Bundle

By the end of this part, you'll have a deployed agent bundle that accepts messy supplier data, validates and normalizes it with a single decorator-based class, stores the result as a typed entity, and proves the round-trip works. No GUI yet -- just the backend, end to end.

---

## Scaffold the Application

Create the application and agent bundle:

```bash
ff application create catalog-intake
cd catalog-intake
ff agent-bundle create catalog-bundle
```

This gives you a monorepo:

```
catalog-intake/
├── firefoundry.json
├── apps/
│   └── catalog-bundle/
│       ├── firefoundry.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── agent-bundle.ts
│       │   └── constructors.ts
│       ├── package.json
│       └── Dockerfile
├── packages/
│   └── shared-types/        # Shared validation classes (used by bundle AND GUI later)
│       └── src/
│           └── validators/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

The `packages/shared-types/` workspace is where your validation classes live. Not in the bundle, not in the GUI -- in a shared package that both consume. When you change a validator, every consumer gets the update. We'll use this in Part 2 when we add the frontend.

Register the application and install dependencies:

```bash
ff application register
pnpm install
```

`ff application register` writes an `applicationId` into your root `firefoundry.json`. Every entity operation will be scoped to this ID.

---

## Define the Product Data Class

This is the heart of the whole tutorial. Instead of writing validation logic in your workflow handler, you declare it once on a class with decorators.

Here's the key snippet from `packages/shared-types/src/validators/SupplierProductV1.ts`:

```typescript
@Serializable()
@UseSinglePassValidation()
export class SupplierProductV1 {
  @Discriminator('v1_api')
  supplier_schema!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  product_id!: string;

  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  @ValidateRequired()
  category!: string;

  // ... (abbreviated -- see companion repo for full class)

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  base_cost!: number;

  @CoerceType('number')
  @ValidateRequired()
  @ValidateRange(0.01)
  msrp!: number;
}
```

Read the decorators top to bottom on each field -- that's the execution order. Coercions run first, then validations:

- **`@CoerceTrim()`** strips whitespace. Suppliers love sending `"  Air Max 90  "`.
- **`@CoerceCase('title')`** normalizes casing -- `air max 90` becomes `Air Max 90`. `@CoerceCase('lower')` lowercases.
- **`@CoerceType('number')`** converts `"89.99"` (string from a CSV) to `89.99` (number).
- **`@ValidateRequired()`** rejects null, undefined, and empty strings. Runs *after* coercion, so a string that trims to empty gets caught.
- **`@ValidateRange(0.01)`** ensures prices are positive.
- **`@Discriminator('v1_api')`** tags this class for routing in Part 3. For now, it's just metadata.
- **`@Serializable()`** enables JSON round-trips. Store a `SupplierProductV1` instance, load it back, and you get a `SupplierProductV1` -- not a plain object. `instanceof` works. Methods work.
- **`@UseSinglePassValidation()`** means the factory runs every field and collects all errors, rather than stopping at the first failure.

The class *is* the contract. There's no separate schema file, no wiki page, no validation logic in the handler. A new developer reads this class and knows exactly what a valid product looks like.

---

## Data Classes vs Raw JSON

Before we go further, consider what this replaces:

> **Without data classes -- the raw JSON approach:**
>
> ```typescript
> const product = JSON.parse(payload) as SupplierProduct;
> if (!product.product_name) throw new Error('Missing product name');
> product.product_name = product.product_name.trim();
> product.product_name = product.product_name
>   .split(' ')
>   .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
>   .join(' ');
> if (typeof product.base_cost === 'string')
>   product.base_cost = parseFloat(product.base_cost);
> if (isNaN(product.base_cost) || product.base_cost <= 0)
>   throw new Error('Invalid cost');
> // ... 40 more lines of this for every field
> // Then you store it with `as SupplierProduct` and pray
> ```
>
> This code works until it doesn't. The validation is scattered across the handler, the `as` cast tells TypeScript to stop helping you, and three different services each have their own version of the trim-and-coerce logic. When the business adds a `sku` field, you hunt through every file.
>
> **With data classes:**
>
> ```typescript
> const factory = new ValidationFactory();
> const product = await factory.create(SupplierProductV1, rawPayload);
> // Done. product_name is trimmed, title-cased, and guaranteed non-empty.
> // base_cost is a number, guaranteed > 0.01.
> // product is a real class instance, not a plain object.
> ```
>
> One line. One definition. Used everywhere -- the bundle, the GUI, the admin panel. When a field changes, you change one class.

---

## Build the Ingestion Workflow

Now wire the validator into a runnable workflow. This is the code that actually processes submissions.

Here's the key snippet from `apps/catalog-bundle/src/workflows/ApiIngestionWorkflow.ts`:

```typescript
@EntityMixin({ specificType: 'ApiIngestionWorkflow', generalType: 'SupplierProductDraft' })
export class ApiIngestionWorkflow extends RunnableEntity<any> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const factory = new ValidationFactory();
    const validated = await factory.create(SupplierProductV1, dto.data.raw_payload);

    await this.update_data({
      ...dto.data,
      validated_product: validated.toJSON(),
      status: 'draft',
    });

    yield { type: 'PROGRESS', message: 'Validation complete' };
    return validated;
  }
}
```

A few things to notice:

- **This is a `RunnableEntity`, not a bot.** Workflows are idempotent -- re-running one produces the same result. The workflow validates and stores in one atomic step.
- **`factory.create()`** runs the full decorator pipeline. If anything fails, it throws with structured errors for every invalid field (thanks to `@UseSinglePassValidation`).
- **`validated.toJSON()`** serializes the class instance for storage. On read, `fromJSON()` reconstructs it. You never lose the type.
- **`yield { type: 'PROGRESS' }`** emits progress events. Callers can observe the workflow's lifecycle without polling.

---

## Wire Up the Entity

The entity wraps the validated data in the entity graph. When `dataClass` is set, the SDK automatically reconstructs `dto.data` as a typed class instance on every read.

From `apps/catalog-bundle/src/entities/SupplierProductDraft.ts`:

```typescript
@EntityDecorator({
  specificType: 'SupplierProductDraft',
  dataClass: SupplierProductCanonical,
})
export class SupplierProductDraft extends EntityNode<any> {}
```

That's the entire entity. Two things happen because of `dataClass`:

1. **On write:** When a `SupplierProductCanonical` instance is stored, `@Serializable` fires `toJSON()`, producing a plain JSON object with a `__class` marker.
2. **On read:** When you call `entity.get_dto()`, the SDK sees the `dataClass` binding and calls `fromJSON()`. You get a real class instance back -- not raw JSON.

You never call `toJSON()` or `fromJSON()` yourself. The SDK handles the round-trip. The net effect: `dto.data` is always typed, everywhere, every time.

---

## Deploy and Test

Build and deploy:

```bash
pnpm install
npx turbo build
ff application register
ff agent-bundle deploy
```

Submit a test product with messy input. Here's mock data from `data/api/supplier-a-basic.json` -- notice the whitespace, string prices, and inconsistent casing:

```bash
ff-sdk-cli api call intake \
  --method POST \
  --body '{
    "supplier_id": "supplier-A",
    "raw_payload": {
      "product_id": "  SKU-1234  ",
      "product_name": "  air max 90  ",
      "category": "RUNNING",
      "base_cost": "89.99",
      "msrp": "120.00"
    }
  }'
```

Expected response:

```json
{
  "success": true,
  "entity_id": "a1b2c3d4-...",
  "validated_product": {
    "product_id": "sku-1234",
    "product_name": "Air Max 90",
    "category": "running",
    "base_cost": 89.99,
    "msrp": 120.00
  }
}
```

Look at what the decorators did:

- `"  air max 90  "` -> `"Air Max 90"` (trimmed + title-cased)
- `"  SKU-1234  "` -> `"sku-1234"` (trimmed + lowercased)
- `"RUNNING"` -> `"running"` (lowercased)
- `"89.99"` (string) -> `89.99` (number)

Now test a bad submission:

```bash
ff-sdk-cli api call intake \
  --method POST \
  --body '{
    "supplier_id": "supplier-A",
    "raw_payload": {
      "product_name": "",
      "category": "running",
      "base_cost": "-5",
      "msrp": "0"
    }
  }'
```

```json
{
  "success": false,
  "errors": [
    { "field": "product_id", "message": "product_id is required" },
    { "field": "product_name", "message": "product_name is required" },
    { "field": "base_cost", "message": "base_cost must be >= 0.01" },
    { "field": "msrp", "message": "msrp must be >= 0.01" }
  ]
}
```

Every failing field is reported, not just the first one. That's `@UseSinglePassValidation` at work.

Finally, verify the round-trip -- load the entity back and confirm you get a typed instance:

```bash
ff-sdk-cli entity get <entity-id>
```

The stored data should reconstruct as a real class instance, not raw JSON. `dto.data` is a `SupplierProductCanonical` with a prototype chain, working methods, and passing `instanceof` checks. That's the `dataClass` + `@Serializable` machinery doing its job.

---

## What's Next

You have a working agent bundle: raw supplier data goes in, typed class instances come out, and they stay typed through storage and retrieval. But right now you're testing via CLI.

In [Part 2: The Catalog GUI](./part-02-catalog-gui.md), you'll add a Next.js frontend with an intake form and a product browser -- and the `SupplierProductV1` class you just wrote will be shared between the bundle and the GUI. Same class, same decorators, zero duplication.

---

Full source: `catalog-intake/apps/catalog-bundle/` in the [companion repository](https://github.com/firebrandanalytics/ff-demo-apps).
