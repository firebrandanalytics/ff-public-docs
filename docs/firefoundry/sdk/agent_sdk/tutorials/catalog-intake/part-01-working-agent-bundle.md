# Part 1: A Working Agent Bundle

By the end of this part, you'll have a deployed agent bundle that calls a supplier's API, validates and normalizes the response with a decorator-based data class, stores the result as a typed entity, and proves the round-trip works. No GUI yet — just the backend, end to end.

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

The `packages/shared-types/` workspace is where your validation classes live. Not in the bundle, not in the GUI — in a shared package that both consume. When you change a validator, every consumer gets the update. We'll use this in Part 2 when we add the frontend.

Register the application and install dependencies:

```bash
ff application register
pnpm install
```

`ff application register` writes an `applicationId` into your root `firefoundry.json`. Every entity operation will be scoped to this ID.

---

## The Supplier's API

Before we write any of our own code, let's look at what we're dealing with. FireKicks sources products from multiple suppliers. The first is **Supplier A**, a wholesaler that exposes a REST API.

Their endpoint: `GET /products/{product_id}`

Their response:

```json
{
  "product_id": "FK-BLZ-001",
  "product_name": "  blaze runner  ",
  "category": "RUNNING",
  "subcategory": "road",
  "brand_line": "Performance Elite",
  "base_cost": "89.99",
  "msrp": "159.99",
  "color": "black/white",
  "size_range": "7-13"
}
```

Look at this data. It's technically correct — all the fields are present, the values are real. But it's *messy* in the way that real supplier data always is:

- **`product_name`** has leading and trailing whitespace: `"  blaze runner  "`
- **`category`** is `"RUNNING"` (ALL CAPS), but `subcategory` is `"road"` (lowercase) — inconsistent casing in the same response
- **`brand_line`** is `"Performance Elite"` (title case), but sometimes they send `"performance elite"` or `"PERFORMANCE ELITE"`
- **`base_cost`** and **`msrp`** are strings: `"89.99"`, not `89.99`. Their API serializes everything as strings.
- **`product_id`** casing varies between calls — sometimes `"FK-BLZ-001"`, sometimes `"fk-blz-001"`

None of this is wrong per se. It's just what happens when you receive data from systems you don't control. The question is: where do you clean it up?

### What We Want

Here's the same product after normalization — this is our internal format:

```json
{
  "product_id": "fk-blz-001",
  "product_name": "Blaze Runner",
  "category": "running",
  "subcategory": "road",
  "brand_line": "performance elite",
  "base_cost": 89.99,
  "msrp": 159.99,
  "color": "black/white",
  "size_range": "7-13"
}
```

- IDs are lowercase (for consistent lookups)
- Names are title-cased (for display)
- Categories are lowercase (for matching)
- Prices are real numbers (for arithmetic)

The gap between "what they send" and "what we need" is small per field but multiplied across every field, every product, every supplier. Somewhere that conversion has to happen. The usual approach looks like this:

```typescript
const product = await response.json() as SupplierProduct;
if (!product.product_name) throw new Error('Missing product name');
product.product_name = product.product_name.trim();
product.product_name = product.product_name
  .split(' ')
  .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
  .join(' ');
if (typeof product.base_cost === 'string')
  product.base_cost = parseFloat(product.base_cost);
if (isNaN(product.base_cost) || product.base_cost <= 0)
  throw new Error('Invalid cost');
// ... 40 more lines of this for every field
// Then you store it with `as SupplierProduct` and pray
```

This code works until it doesn't. The validation is scattered across the handler, the `as` cast tells TypeScript to stop helping you, and three different services each have their own version of the trim-and-coerce logic. When the business adds a `sku` field, you hunt through every file.

We're going to take a different approach.

---

## Define the Product Data Class

Instead of writing validation logic in your workflow handler, you declare it once on a class with decorators. Each decorator is an instruction: trim this, lowercase that, parse this string to a number, reject values outside this range.

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

  // ... (abbreviated — see companion repo for full class)

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

Read the decorators top to bottom on each field — that's the execution order. Coercions run first, then validations:

- **`@CoerceTrim()`** strips whitespace. `"  blaze runner  "` becomes `"blaze runner"`.
- **`@CoerceCase('title')`** normalizes casing — `"blaze runner"` becomes `"Blaze Runner"`. `@CoerceCase('lower')` lowercases.
- **`@CoerceType('number')`** converts `"89.99"` (the string from the API) to `89.99` (a number we can do math with).
- **`@ValidateRequired()`** rejects null, undefined, and empty strings. Runs *after* coercion, so a string that trims to empty gets caught.
- **`@ValidateRange(0.01)`** ensures prices are positive.
- **`@Discriminator('v1_api')`** tags this class for routing in Part 3. For now, it's just metadata.
- **`@Serializable()`** enables JSON round-trips. Store a `SupplierProductV1` instance, load it back, and you get a `SupplierProductV1` — not a plain object. `instanceof` works. Methods work.
- **`@UseSinglePassValidation()`** means the factory runs every field and collects all errors, rather than stopping at the first failure.

Look at this class and compare it to the API response above. You can see the bridge: `product_name` arrives as `"  blaze runner  "` from the API, and the decorators `@CoerceTrim()` + `@CoerceCase('title')` produce `"Blaze Runner"`. `base_cost` arrives as `"89.99"` and `@CoerceType('number')` + `@ValidateRange(0.01)` produces a validated `89.99`. The class *is* the mapping from their shape to ours.

The class is also the contract. There's no separate schema file, no wiki page, no validation logic in the handler. A new developer reads this class and knows exactly what a valid product looks like — and exactly how the supplier's messy data gets cleaned up.

---

## Build the Ingestion Workflow

Now wire the data class into a workflow that actually calls the supplier's API.

The key pattern: the workflow's entity data contains *parameters* for what to fetch (the product ID, the API URL), not the data itself. The workflow fetches the data, validates it, and stores the result.

Here's the key snippet from `apps/catalog-bundle/src/workflows/ApiIngestionWorkflow.ts`:

```typescript
@EntityMixin({ specificType: 'ApiIngestionWorkflow', generalType: 'SupplierProductDraft' })
export class ApiIngestionWorkflow extends RunnableEntity<any> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    // Step 1: Read parameters — what product to fetch, from where
    const productIdToFetch = dto.data.product_id_to_fetch;
    const apiUrl = dto.data.supplier_api_url ?? SUPPLIER_A_API_URL;

    // Step 2: Call the supplier's API
    const rawProduct = await this.fetchFromSupplierApi(apiUrl, productIdToFetch);

    yield { type: 'PROGRESS', message: 'Validating API response...' };

    // Step 3: Validate the raw response through the decorator pipeline
    const factory = new ValidationFactory();
    const validated = await factory.create(SupplierProductV1, rawProduct);

    // Step 4: Store the validated result
    await this.update_data({
      ...dto.data,
      source_type: 'api',
      status: 'draft',
      raw_api_response: rawProduct,
      validated_product: validated.toJSON(),
    });

    return validated;
  }
}
```

A few things to notice:

- **The entity carries parameters, not data.** `dto.data.product_id_to_fetch` tells the workflow *what* to fetch. The raw API response is fetched at runtime, validated, and stored alongside the original response for auditability.
- **This is a `RunnableEntity`, not a bot.** Workflows are idempotent — re-running one produces the same result. The workflow fetches, validates, and stores in one atomic step.
- **`factory.create()`** runs the full decorator pipeline on the raw API response. If anything fails, it throws with structured errors for every invalid field (thanks to `@UseSinglePassValidation`).
- **`validated.toJSON()`** serializes the class instance for storage. On read, `fromJSON()` reconstructs it. You never lose the type.
- **`yield { type: 'PROGRESS' }`** emits progress events. Callers can observe the workflow's lifecycle without polling.

The `fetchFromSupplierApi` method is a simple HTTP call in production. For local development, it falls back to reading from the mock data files in `data/api/`:

```typescript
private async fetchFromSupplierApi(apiUrl: string, productId: string) {
  try {
    const response = await fetch(`${apiUrl}/products/${productId}`);
    if (!response.ok) throw new Error(`Supplier API returned ${response.status}`);
    return await response.json();
  } catch {
    // Local dev: fall back to mock data files
    return this.loadMockProduct(productId);
  }
}
```

> **Mock data:** The `data/api/` directory contains sample API responses — `supplier-a-basic.json` (single product) and `supplier-a-batch.json` (five products). These are realistic payloads with the same messiness the real API would have: string prices, inconsistent casing, extra whitespace. See the companion repository.

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
2. **On read:** When you call `entity.get_dto()`, the SDK sees the `dataClass` binding and calls `fromJSON()`. You get a real class instance back — not raw JSON.

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

Create a workflow entity with the API call parameters — notice we're telling it *what to fetch*, not giving it the data:

```bash
ff-sdk-cli entity create SupplierProductDraft \
  --data '{
    "product_id_to_fetch": "FK-BLZ-001",
    "supplier_api_url": "http://localhost:3050"
  }'
```

Run the workflow:

```bash
ff-sdk-cli entity run <entity-id>
```

Expected result — the workflow fetched from the API, cleaned up the data, and stored it:

```json
{
  "success": true,
  "entity_id": "a1b2c3d4-...",
  "validated_product": {
    "product_id": "fk-blz-001",
    "product_name": "Blaze Runner",
    "category": "running",
    "subcategory": "road",
    "brand_line": "performance elite",
    "base_cost": 89.99,
    "msrp": 159.99,
    "color": "black/white",
    "size_range": "7-13"
  }
}
```

Compare this to the raw API response we started with:

| Field | API sent | We stored |
|-------|----------|-----------|
| `product_id` | `"FK-BLZ-001"` | `"fk-blz-001"` |
| `product_name` | `"  blaze runner  "` | `"Blaze Runner"` |
| `category` | `"RUNNING"` | `"running"` |
| `base_cost` | `"89.99"` (string) | `89.99` (number) |
| `msrp` | `"159.99"` (string) | `159.99` (number) |

Every transformation is declared in the data class. None of it lives in the workflow handler.

Now test a bad submission — create an entity with an invalid product ID to simulate an API response with missing/bad data:

```bash
ff-sdk-cli entity create SupplierProductDraft \
  --data '{
    "product_id_to_fetch": "INVALID-999",
    "supplier_api_url": "http://localhost:3050"
  }'
ff-sdk-cli entity run <entity-id>
```

If the product doesn't exist, the workflow throws. If the API returns incomplete data, the validation pipeline catches it:

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

Finally, verify the round-trip — load the entity back and confirm you get a typed instance:

```bash
ff-sdk-cli entity get <entity-id>
```

The stored data reconstructs as a real class instance, not raw JSON. `dto.data` is a `SupplierProductCanonical` with a prototype chain, working methods, and passing `instanceof` checks. That's the `dataClass` + `@Serializable` machinery doing its job.

---

## What's Next

You have a working agent bundle: it calls a supplier's API, validates the response through a decorator pipeline, and stores the result as a typed entity that survives the round-trip. But right now you're testing via CLI.

In [Part 2: The Catalog GUI](./part-02-catalog-gui.md), you'll add a Next.js frontend with an intake form and a product browser — and the `SupplierProductV1` class you just wrote will be shared between the bundle and the GUI. Same class, same decorators, zero duplication.

---

Full source: `catalog-intake/apps/catalog-bundle/` in the [companion repository](https://github.com/firebrandanalytics/ff-demo-apps).
