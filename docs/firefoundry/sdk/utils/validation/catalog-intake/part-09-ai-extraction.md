# Part 9: AI Extraction + Classification

Use AI-powered decorators to extract structured product data from unstructured supplier descriptions, classify categories from free text, and repair malformed JSON payloads.

---

## The Problem: Some Supplier Data Is Unstructured

In Parts 1-8, every supplier — however messy — sent structured data with identifiable fields. Category was always in a `category` field, even if it was misspelled. But some suppliers don't send structured data at all.

**Supplier D** sends free-text product descriptions with all the information buried in prose:

```json
{
  "source_format": "freetext_json",
  "supplier_id": "supplier-d",
  "description": "New arrival: Nike Air Force 1 '07 in White/Black colorway. Premium leather upper. Men's basketball lifestyle shoe. Wholesale $52, retail $110. Available in sizes 7 through 13. SKU: NAF1-WHT-07."
}
```

Everything you need is in that paragraph — product name, color, category, prices, sizes, SKU — but there are no fields to map with `@DerivedFrom` or match with `@CoerceFromSet`. You need **AI** to extract structure from text.

**Supplier E** sends JSON, but it's frequently malformed — trailing commas, unquoted keys, single quotes instead of double quotes:

```json
{
  "source_format": "broken_json",
  "supplier_id": "supplier-e",
  "payload": "{ name: 'Adidas Ultraboost 22', category: 'running', price: 180.00, }"
}
```

`JSON.parse()` fails on this. `@CoerceParse('json')` fails on this. You need AI to repair the JSON before the pipeline can process it.

## Configuring the AI Handler

Before using any AI decorators, you need to tell the `ValidationFactory` how to call your LLM. This is a one-time configuration:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';

const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // params contains: value, instance, context, propertyKey, className,
    //                  previousError, attemptNumber, maxRetries, metadata
    const response = await llm.complete(prompt);
    return response;
  }
});
```

The `aiHandler` receives the prompt built by the AI decorator and returns the LLM's response. The factory handles retry logic, error context injection, and result parsing automatically.

In the FireFoundry bundle, this connects to the Broker service:

```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    return await broker.complete({
      messages: [{ role: 'user', content: prompt }],
      model: 'default',
    });
  }
});
```

## @AIExtract — Pulling Structure from Free Text

`@AIExtract` prompts an LLM to extract specific named fields from unstructured text. It returns a structured object with the requested fields populated.

### Basic Extraction

```typescript
import {
  AIExtract,
  DerivedFrom,
  Staging,
  CoerceTrim,
  CoerceCase,
  CoerceParse,
  ValidateRequired,
  ValidateRange,
} from '@firebrandanalytics/shared-utils/validation';

class SupplierDExtractor {
  // Step 1: Extract all fields from the description into a temporary object
  @DerivedFrom('$.description')
  @AIExtract([
    'product_name',
    'category',
    'subcategory',
    'color',
    'wholesale_price',
    'retail_price',
    'size_range',
    'sku'
  ])
  @Staging()  // Temporary — removed from final output
  _extracted: Record<string, string>;

  // Step 2: Derive each field from the extraction and apply standard decorators

  @DerivedFrom('_extracted', (e) => e.product_name)
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name: string;

  @DerivedFrom('_extracted', (e) => e.category)
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.categories,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  category: string;

  @DerivedFrom('_extracted', (e) => e.color)
  @CoerceTrim()
  @CoerceCase('lower')
  color: string;

  @DerivedFrom('_extracted', (e) => e.wholesale_price)
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  wholesale_price: number;

  @DerivedFrom('_extracted', (e) => e.retail_price)
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;

  @DerivedFrom('_extracted', (e) => e.size_range)
  @CoerceTrim()
  size_range: string;

  @DerivedFrom('_extracted', (e) => e.sku)
  @CoerceTrim()
  @CoerceCase('upper')
  sku: string;
}
```

Notice the pattern:

1. **`@AIExtract`** runs on the raw description and produces a flat object with all the fields.
2. **`@Staging()`** marks the extraction as temporary — it's scaffolding for the derivation step.
3. Each final property uses **`@DerivedFrom('_extracted', ...)`** to pick its value from the extracted object.
4. The extracted values flow through the same coercion and validation decorators from previous parts — `@CoerceTrim`, `@CoerceCase`, `@CoerceFromSet`, `@ValidateRange`.

This is the key insight: **AI extraction feeds into the same pipeline.** The LLM doesn't need to get everything perfect because the coercion and fuzzy matching layers clean up after it. The AI extracts `"basketball lifestyle"` and the fuzzy matcher resolves it to `"basketball"`.

### Running It

```typescript
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    return await broker.complete({ messages: [{ role: 'user', content: prompt }] });
  }
});

const result = await factory.create(SupplierDExtractor, {
  description: "New arrival: Nike Air Force 1 '07 in White/Black colorway. Premium leather upper. Men's basketball lifestyle shoe. Wholesale $52, retail $110. Available in sizes 7 through 13. SKU: NAF1-WHT-07."
}, { context: catalogContext });

console.log(JSON.stringify(result, null, 2));
```

**Output:**

```json
{
  "product_name": "Nike Air Force 1 '07",
  "category": "basketball",
  "color": "white/black",
  "wholesale_price": 52,
  "retail_price": 110,
  "size_range": "7-13",
  "sku": "NAF1-WHT-07"
}
```

The `_extracted` staging field is gone. Every value has been coerced and validated. The AI did the hard part (understanding natural language), and the decorator pipeline did the rest (normalization, type coercion, fuzzy matching).

### Extraction with Object Schemas

For more control over what the AI extracts, pass an object schema instead of a string array:

```typescript
@AIExtract({
  product_name: 'The full product name including brand',
  category: 'The product category (e.g., running, basketball, casual)',
  wholesale_price: 'The wholesale/cost price as a number',
  retail_price: 'The retail/MSRP price as a number',
})
@Staging()
_extracted: Record<string, any>;
```

The object values serve as extraction hints for the LLM, improving accuracy for ambiguous fields.

## @AIClassify — Categorizing from Context

`@AIClassify` is a specialized preset that classifies text into one of a predefined set of labels. It's simpler and more reliable than asking `@AIExtract` for a category — the LLM is constrained to choose from the provided options.

```typescript
import { AIClassify, DerivedFrom, Copy } from '@firebrandanalytics/shared-utils/validation';

class ProductClassifier {
  @Copy()
  description: string;

  @DerivedFrom('description')
  @AIClassify(['running', 'basketball', 'casual', 'training', 'skateboarding'])
  category: string;

  @DerivedFrom('description')
  @AIClassify(['low', 'medium', 'high', 'premium'])
  price_tier: string;

  @DerivedFrom('description')
  @AIClassify(["men's", "women's", "unisex", "kids"])
  target_demographic: string;
}
```

`@AIClassify` builds a prompt that forces the LLM to pick exactly one label from the provided list. It also internally applies `@CoerceFromSet` to ensure the LLM's response matches one of the labels — if the LLM returns `"Running"` instead of `"running"`, the coercion fixes it.

**Input:**

```typescript
const result = await factory.create(ProductClassifier, {
  description: "Premium leather high-top basketball shoe for men. Features Air cushioning and ankle support."
});
```

**Output:**

```json
{
  "description": "Premium leather high-top basketball shoe for men. Features Air cushioning and ankle support.",
  "category": "basketball",
  "price_tier": "premium",
  "target_demographic": "men's"
}
```

### Automatic Retry on Mismatch

If the LLM returns a value that doesn't match any label — say it responds with `"sport"` instead of one of the five categories — the library automatically retries. On the retry, the prompt includes the previous error as context:

```
Previous attempt returned "sport" which is not a valid option.
You must choose exactly one of: running, basketball, casual, training, skateboarding
```

This self-correcting loop is built into all AI decorators. The `maxRetries` option (default: 2) controls how many attempts are made before throwing an error.

## @AIJSONRepair — Fixing Malformed JSON

Supplier E sends broken JSON that standard parsers reject. `@AIJSONRepair` sends the malformed string to an LLM with a specialized prompt asking it to fix the syntax while preserving the data:

```typescript
import {
  AIJSONRepair,
  CoerceParse,
  DerivedFrom,
  Staging,
} from '@firebrandanalytics/shared-utils/validation';

class SupplierEProcessor {
  // Step 1: Repair the broken JSON string
  @DerivedFrom('$.payload')
  @AIJSONRepair()
  @CoerceParse('json', { allowNonString: true })
  @Staging()
  _repaired: Record<string, any>;

  // Step 2: Extract fields from the repaired object
  @DerivedFrom('_repaired', (obj) => obj.name)
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name: string;

  @DerivedFrom('_repaired', (obj) => obj.category)
  @CoerceTrim()
  @CoerceCase('lower')
  category: string;

  @DerivedFrom('_repaired', (obj) => obj.price)
  @CoerceType('number')
  @ValidateRange(0.01)
  retail_price: number;
}
```

The decorator chain:

1. **`@AIJSONRepair()`** — Sends the broken JSON to the LLM, which returns valid JSON
2. **`@CoerceParse('json')`** — Parses the repaired string into a JavaScript object
3. **`@Staging()`** — The repaired object is temporary scaffolding

**Input:**

```json
{
  "payload": "{ name: 'Adidas Ultraboost 22', category: 'running', price: 180.00, }"
}
```

The AI repairs this to:

```json
"{\"name\": \"Adidas Ultraboost 22\", \"category\": \"running\", \"price\": 180.00}"
```

Then `@CoerceParse('json')` produces `{ name: "Adidas Ultraboost 22", category: "running", price: 180 }`, and the remaining decorators extract and normalize each field.

**Output:**

```json
{
  "product_name": "Adidas Ultraboost 22",
  "category": "running",
  "retail_price": 180
}
```

## @AITransform — Custom AI Prompts

For cases not covered by the presets, `@AITransform` lets you write your own prompt:

```typescript
import { AITransform, DerivedFrom } from '@firebrandanalytics/shared-utils/validation';

class ProductEnricher {
  @Copy()
  product_name: string;

  @Copy()
  description: string;

  // Generate a URL-friendly slug from the product name
  @DerivedFrom('product_name')
  @AITransform((params) =>
    `Convert this product name to a URL-friendly slug (lowercase, hyphens, no special characters): "${params.value}". Return only the slug.`
  )
  url_slug: string;

  // Extract material information from the description
  @DerivedFrom('description')
  @AITransform((params) =>
    `Extract the primary material from this product description: "${params.value}". Return only the material name (e.g., "leather", "mesh", "canvas"). If no material is mentioned, return "unknown".`
  )
  @CoerceTrim()
  @CoerceCase('lower')
  primary_material: string;
}
```

The prompt function receives `params` with the current value, the partial instance, context, and retry metadata. The LLM's response flows through any subsequent decorators — so `@CoerceTrim()` and `@CoerceCase('lower')` clean up the AI's response.

### Using Instance Context in Prompts

The `params` object includes the partial instance, so you can reference other already-processed fields:

```typescript
@AITransform((params) => {
  const inst = params.instance;
  return `Given a ${inst.category} shoe called "${inst.product_name}" priced at $${inst.retail_price}, write a one-sentence marketing tagline. Return only the tagline.`;
})
@DependsOn('product_name', 'category', 'retail_price')
marketing_tagline: string;
```

Notice the `@DependsOn` decorator — it explicitly declares that this AI transform needs `product_name`, `category`, and `retail_price` to be resolved first. The AI prompt references them via `params.instance`, but the engine can't infer that from the decorator alone, so the manual dependency declaration is needed.

## Integrating AI Into the Discriminated Union

Bringing it back to the catalog intake architecture from Part 3: Supplier D's free-text format plugs into the discriminated union alongside the structured suppliers.

```typescript
@DiscriminatedUnion({
  discriminator: 'source_format',
  map: {
    'flat_json_snake': SupplierAMapping,
    'nested_json_camel': SupplierBMapping,
    'flat_json_caps': SupplierCMapping,
    'freetext_json': SupplierDMapping,      // AI extraction
    'broken_json': SupplierEMapping,         // AI JSON repair
  }
})
class SupplierSubmissionMapping {
  @Copy()
  source_format: string;
}

class SupplierDMapping extends SupplierSubmissionMapping {
  @Discriminator('freetext_json')
  source_format: string;

  @DerivedFrom('$.description')
  @AIExtract(['product_name', 'category', 'subcategory', 'color',
              'wholesale_price', 'retail_price', 'size_range', 'sku'])
  @Staging()
  _extracted: Record<string, string>;

  @DerivedFrom('_extracted', (e) => e.product_name)
  @CoerceTrim()
  @CoerceCase('title')
  @ValidateRequired()
  product_name: string;

  @DerivedFrom('_extracted', (e) => e.category)
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.categories,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  category: string;

  // ... remaining fields with standard decorators ...
}
```

The dispatch pipeline doesn't care whether a supplier's data is structured or unstructured. `factory.create(SupplierSubmissionMapping, payload)` routes to the right class, and that class uses whatever decorators it needs — basic coercion for structured data, AI extraction for unstructured data. The output schema is the same either way.

## Cost-Aware AI Usage

AI calls are expensive. Use conditionals from Part 6 to apply them only when needed:

```typescript
class SmartExtractor {
  @Copy()
  description: string;

  // Only use AI summarization for long descriptions
  @DerivedFrom('description')
  @If((val: string) => val.length > 500)
    @AISummarize('short')
  @Else()
    @Copy()  // Short descriptions don't need summarization
  @EndIf()
  short_description: string;

  // Only classify if category wasn't provided directly
  @If('$.category', (val: any) => val == null || val === '')
    @DerivedFrom('description')
    @AIClassify(['running', 'basketball', 'casual', 'training', 'skateboarding'])
  @Else()
    @DerivedFrom('$.category')
    @CoerceCase('lower')
  @EndIf()
  category: string;
}
```

This pattern avoids unnecessary AI calls: if the supplier already provided a category, use it directly. Only fall back to AI classification when the field is missing.

## AI Decorator Summary

| Decorator | Purpose | Input | Output |
|-----------|---------|-------|--------|
| `@AIExtract(fields)` | Extract structured fields from text | Unstructured string | Object with named fields |
| `@AIClassify(labels)` | Classify text into one of N labels | Any string | One of the provided labels |
| `@AIJSONRepair()` | Fix malformed JSON syntax | Broken JSON string | Valid JSON string |
| `@AITransform(prompt)` | Custom AI transformation | Any value | LLM response |
| `@AISummarize(length)` | Condense text | Long string | Shorter string |
| `@AISpellCheck()` | Fix spelling and grammar | Text with errors | Corrected text |
| `@AITranslate(lang)` | Translate text | Text in any language | Text in target language |
| `@AIRewrite(style)` | Rewrite in different tone | Text | Restyled text |

All AI decorators:
- Require an `aiHandler` configured on the `ValidationFactory`
- Support automatic retry with error context (default: 2 retries)
- Work with subsequent coercion/validation decorators (the AI output is fed through the rest of the pipeline)
- Can be wrapped in `@If` conditionals to control when they run

## What's Next

AI extraction handles the unstructured data problem, but what happens when things go wrong? An LLM might return garbage. A network call might timeout. A validation might fail on data that's "close enough" to be worth saving rather than rejecting.

In [Part 10: Recovery + Async Validation](./part-10-recovery-async.md), you'll learn how to build resilient pipelines with `@Catch` for graceful fallbacks, `@AICatchRepair` for AI-powered error recovery, and `@ValidateAsync` for validating against live services.

---

**Next:** [Part 10: Recovery + Async Validation](./part-10-recovery-async.md)

**Previous:** [Part 8: Engine Deep Dive](./part-08-engine-deep-dive.md)
