# Part 5: Fuzzy Matching + Runtime Context

Match supplier values against the FireKicks catalog using fuzzy string matching, synonyms, and runtime-loaded canonical sets.

---

## The Problem: Suppliers Never Use Your Exact Terminology

In Parts 1-4, we built a pipeline that parses, reparents, and type-coerces supplier data. But there's a fundamental problem we haven't addressed: **suppliers don't use the same names as the catalog.**

FireKicks has a canonical list of categories: `running`, `basketball`, `casual`, `training`, `skateboarding`. But suppliers send:

| Supplier Input | Intended Category |
|---------------|-------------------|
| `"running"` | `running` |
| `"Running Shoes"` | `running` |
| `"BASKETBALL"` | `basketball` |
| `"baskeball"` | `basketball` (typo) |
| `"lifestyle"` | `casual` (different term) |
| `"skate"` | `skateboarding` (abbreviation) |
| `"cross-training"` | `training` (variation) |

The `@CoerceCase('lower')` from Part 1 handles the casing differences, but it can't fix typos, abbreviations, or alternate terminology. You need **fuzzy matching** — and the match set needs to come from the live catalog, not hardcoded constants.

## @CoerceFromSet — Matching Against a Known Set

`@CoerceFromSet` is the decorator that bridges the gap between messy supplier input and your canonical values. It takes a set of valid values and matches the input against them using a configurable strategy.

### Exact Matching (Case-Insensitive)

The simplest strategy: match exactly, but ignore casing.

```typescript
import {
  CoerceFromSet,
  ValidateRequired,
  CoerceTrim,
} from '@firebrandanalytics/shared-utils/validation';

const CATEGORIES = ['running', 'basketball', 'casual', 'training', 'skateboarding'];

class CategoryExample {
  @CoerceTrim()
  @CoerceFromSet(() => CATEGORIES, { strategy: 'exact', caseSensitive: false })
  category: string;
}

// "RUNNING"      → "running"     ✓ (case-insensitive match)
// "Basketball"   → "basketball"  ✓
// "baskeball"    → Error         ✗ (exact match can't handle typos)
```

This handles `"RUNNING"` → `"running"` but fails on `"baskeball"`. For typo tolerance, we need fuzzy matching.

### Fuzzy Matching

The `fuzzy` strategy uses Levenshtein distance to find the closest match above a confidence threshold:

```typescript
class CategoryFuzzy {
  @CoerceTrim()
  @CoerceFromSet(() => CATEGORIES, {
    strategy: 'fuzzy',
    fuzzyThreshold: 0.7  // 0 = match anything, 1 = exact match only
  })
  category: string;
}

// "baskeball"    → "basketball"     ✓ (fuzzy match, score ~0.89)
// "runing"       → "running"        ✓ (fuzzy match, score ~0.86)
// "xyz"          → Error            ✗ (no match above 0.7 threshold)
```

The threshold controls how strict the matching is. A threshold of `0.7` means the input must be at least 70% similar to a candidate. For category names, `0.7` is a good balance — it catches common typos without producing false positives.

### Fuzzy Matching + Synonyms

Fuzzy matching handles typos, but it can't handle completely different terms. `"lifestyle"` and `"casual"` are semantically equivalent, but they share almost no characters. For these cases, use **synonyms**:

```typescript
class CategoryWithSynonyms {
  @CoerceTrim()
  @CoerceFromSet(() => CATEGORIES, {
    strategy: 'fuzzy',
    fuzzyThreshold: 0.7,
    synonyms: {
      casual: ['lifestyle', 'everyday', 'street', 'streetwear'],
      training: ['cross-training', 'gym', 'workout', 'fitness'],
      skateboarding: ['skate', 'skating', 'sk8'],
      running: ['jogging', 'road running', 'trail running'],
      basketball: ['hoops', 'bball'],
    }
  })
  category: string;
}

// "lifestyle"      → "casual"         ✓ (synonym match)
// "cross-training" → "training"       ✓ (synonym match)
// "skate"          → "skateboarding"  ✓ (synonym match)
// "baskeball"      → "basketball"     ✓ (fuzzy match — typo)
// "joging"         → "running"        ✓ (fuzzy matches synonym "jogging")
```

Synonyms are checked **before** fuzzy matching, making them fast and deterministic. They're the right tool for known alternate terms, abbreviations, and industry jargon. Fuzzy matching is the fallback for unexpected typos.

## Runtime Context: Loading Match Sets from the Catalog

So far, our category list has been a hardcoded constant. In a real application, the canonical categories, brands, and colors live in the database and change over time. You need to load them at runtime and pass them into the validation pipeline.

This is where **context** comes in. The `@CoerceFromSet` decorator can extract its match set from a runtime context object instead of a static array.

### Defining the Context Type

```typescript
interface CatalogContext {
  categories: string[];
  subcategories: string[];
  brandLines: string[];
  colors: string[];
  categorySynonyms: Record<string, string[]>;
}
```

### Using Context in Decorators

```typescript
class SupplierProductDraftV5 {
  @ValidateRequired()
  @DerivedFrom([
    '$.product_name',
    '$.productInfo.name',
    '$.PRODUCT_NAME'
  ])
  @CoerceTrim()
  @CoerceCase('title')
  product_name: string;

  @ValidateRequired()
  @DerivedFrom([
    '$.category',
    '$.productInfo.category',
    '$.CATEGORY'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.categories,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.7,
      synonyms: {  // Static fallback synonyms
        casual: ['lifestyle', 'everyday', 'street'],
        training: ['cross-training', 'gym', 'workout'],
        skateboarding: ['skate', 'skating'],
      }
    }
  )
  category: string;

  @DerivedFrom([
    '$.subcategory',
    '$.productInfo.subcategory',
    '$.SUBCATEGORY'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.subcategories,
    { strategy: 'fuzzy', fuzzyThreshold: 0.6 }
  )
  subcategory: string;

  @DerivedFrom([
    '$.brand_line',
    '$.productInfo.brandLine',
    '$.BRAND_LINE'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.brandLines,
    { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
  )
  brand_line: string;

  @DerivedFrom([
    '$.color',
    '$.productInfo.color',
    '$.COLOR'
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.colors,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.6,
      synonyms: {
        'black/white': ['blk/wht', 'bk/wh', 'black and white', 'b&w'],
        'navy/gold': ['navy and gold', 'nvy/gld'],
      }
    }
  )
  color: string;

  // --- Price fields (unchanged from Part 2) ---

  @DerivedFrom(['$.wholesale_price', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  wholesale_price: number;

  @DerivedFrom(['$.retail_price', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  retail_price: number;
}
```

### Passing Context at Runtime

Load the canonical values from your Data Access Service (DAS) and pass them as context when creating the validator:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';

// Load canonical values from the database
const catalogContext: CatalogContext = {
  categories: await das.query('SELECT DISTINCT name FROM categories'),
  subcategories: await das.query('SELECT DISTINCT name FROM subcategories'),
  brandLines: await das.query('SELECT DISTINCT name FROM brand_lines'),
  colors: await das.query('SELECT DISTINCT name FROM colors'),
  categorySynonyms: await das.query('SELECT canonical, synonyms FROM category_synonyms'),
};

const factory = new ValidationFactory();

const draft = await factory.create(
  SupplierProductDraftV5,
  rawSupplierPayload,
  { context: catalogContext }  // <-- Pass context here
);
```

The context is available to every `@CoerceFromSet` decorator in the pipeline. When a new category is added to the database, the validator automatically picks it up without any code changes.

## CoercionAmbiguityError: When Fuzzy Matching Is Uncertain

Fuzzy matching can produce ambiguous results. If the input is `"sport"` and the candidates are `["sports", "sporty"]`, both match with similar scores. The library doesn't guess — it throws a `CoercionAmbiguityError`.

```typescript
import { CoercionAmbiguityError } from '@firebrandanalytics/shared-utils/validation';

try {
  await factory.create(SupplierProductDraftV5, {
    product_name: 'Test Product',
    category: 'sport',  // Ambiguous: "sports" or "sporty"?
  }, { context: catalogContext });
} catch (error) {
  if (error instanceof CoercionAmbiguityError) {
    console.log(error.message);
    // "Ambiguous match for 'sport': candidates 'sports' (0.91) and 'sporty' (0.83)
    //  are within ambiguity tolerance"

    console.log(error.candidates);
    // [
    //   { value: 'sports', score: 0.91 },
    //   { value: 'sporty', score: 0.83 }
    // ]
  }
}
```

This is exactly the kind of issue that should be surfaced in the review queue (from DESIGN.md). The intake bot catches the ambiguity, records it in `supplier_validation_runs`, and the human reviewer picks the correct match.

### Controlling Ambiguity Tolerance

By default, candidates within `0.1` of each other's score are considered ambiguous. You can adjust this:

```typescript
@CoerceFromSet<CatalogContext>(
  (ctx) => ctx.categories,
  {
    strategy: 'fuzzy',
    fuzzyThreshold: 0.7,
    ambiguityTolerance: 0.05  // Tighter: only flag if scores are within 5% of each other
  }
)
category: string;
```

A lower `ambiguityTolerance` means fewer ambiguity errors (the library will pick the top match more aggressively). A higher tolerance means more cases go to human review. For catalog intake, erring on the side of human review is safer — a wrong category match is worse than a delayed import.

## Matching Complex Objects with Selectors

Sometimes you need to match against a set of objects, not just strings. For example, matching a brand name against a table of brand records to get the `brand_id`:

```typescript
interface Brand {
  id: number;
  name: string;
  aliases: string[];
}

interface CatalogContext {
  brands: Brand[];
  // ...
}

class DraftWithBrandLookup {
  @DerivedFrom(['$.brand_line', '$.productInfo.brandLine', '$.BRAND_LINE'])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.brands,
    {
      selector: (brand) => brand.name,  // Match based on the name field
      strategy: 'fuzzy',
      fuzzyThreshold: 0.7
    }
  )
  matched_brand: Brand;  // Returns the full Brand object, not just the name
}

// Input: { brand_line: "performnce" }
// Output: { matched_brand: { id: 3, name: "performance", aliases: ["perf"] } }
```

The `selector` option tells `@CoerceFromSet` which property of the candidate object to compare against the input. When a match is found, the **full object** is returned, not just the matched property. This lets you extract the `brand_id` for the foreign key in `supplier_product_drafts`.

## Try It: Messy Supplier Data with Fuzzy Resolution

Here's a complete example that exercises all the matching features:

**Input (from a sloppy supplier):**

```json
{
  "product_name": "  Air Jordan 1 Retro High  ",
  "category": "baskeball",
  "subcategory": "mens",
  "brand_line": "jordon",
  "color": "blk/wht",
  "wholesale_price": "$95.00",
  "retail_price": "$170.00"
}
```

**Context (loaded from database):**

```typescript
const catalogContext: CatalogContext = {
  categories: ['running', 'basketball', 'casual', 'training', 'skateboarding'],
  subcategories: ["men's", "women's", "unisex", "kids"],
  brandLines: ['performance', 'premium', 'jordan', 'air max', 'boost'],
  colors: ['black/white', 'white/red', 'navy/gold', 'grey/black', 'all black'],
  categorySynonyms: {},
};
```

**Output:**

```json
{
  "product_name": "Air Jordan 1 Retro High",
  "category": "basketball",
  "subcategory": "men's",
  "brand_line": "jordan",
  "color": "black/white",
  "wholesale_price": 95,
  "retail_price": 170
}
```

Let's trace the fuzzy matches:

| Field | Input | Matched To | How |
|-------|-------|-----------|-----|
| category | `"baskeball"` | `"basketball"` | Fuzzy match (score ~0.89 — one transposed letter) |
| subcategory | `"mens"` | `"men's"` | Fuzzy match (score ~0.80 — missing apostrophe) |
| brand_line | `"jordon"` | `"jordan"` | Fuzzy match (score ~0.83 — swapped vowel) |
| color | `"blk/wht"` | `"black/white"` | Synonym match (defined in synonyms map) |

Four fields corrected. No manual if/else. No string processing code. The validation library handled the typos, the missing apostrophe, the abbreviation, and the case normalization — all declaratively.

## What's Next

The V5 validator matches supplier values against the catalog, but it treats every field the same way regardless of context. In reality, validation rules need to adapt:

- If the category is `"running"`, size ranges should be numeric (`"7-13"`). If the category is `"casual"`, sizes might be letters (`"S-XL"`).
- The retail price should always be greater than the wholesale price.
- Some fields are only required for certain product types.

In [Part 6: Conditionals + Object Rules](./part-06-conditionals-rules.md), you'll learn how to apply validation rules conditionally with `@If`/`@ElseIf`/`@Else`/`@EndIf`, enforce cross-field relationships with `@ObjectRule`, and validate property interdependencies with `@CrossValidate`.

---

**Next:** [Part 6: Conditionals + Object Rules](./part-06-conditionals-rules.md)

**Previous:** [Part 4: Nested Variants](./part-04-nested-variants.md)
