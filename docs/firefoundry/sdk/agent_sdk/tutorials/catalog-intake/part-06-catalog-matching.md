# Part 6: Catalog Matching & Context

Supplier values don't match your catalog. They send "RUNNING" when the catalog says "Running Shoes." They send "nike" when the catalog says "Nike Inc." They send "bball" and you have to figure out if that's "Basketball" or "Baseball." In this part, you'll add fuzzy matching against the live FireKicks product catalog so the validation pipeline can bridge the gap between messy supplier input and canonical catalog values.

**What you'll learn:**
- Using `@CoerceFromSet` with fuzzy matching, synonyms, and confidence thresholds
- Defining a `CatalogContext` type for runtime value sets
- Loading canonical values from the FireKicks database via the Data Access Service (DAS)
- Handling ambiguous matches with `CoercionAmbiguityError` and confidence scoring
- Updating the GUI to display match confidence and ambiguity indicators

**What you'll build:** A validation pipeline that fuzzy-matches supplier categories, brands, and subcategories against the live catalog, with confidence scoring that auto-accepts high-confidence matches and flags ambiguous ones for human review. Plus GUI updates to show match confidence per field.

**Starting point:** Completed code from [Part 5: The Validation Trace](./part-05-validation-trace.md). You should have a working validation pipeline with trace capture, `@Staging`, per-field audit, and the trace viewer GUI.

---

## Step 1: The Problem -- Supplier Values Don't Match

Look at what suppliers actually send versus what the FireKicks catalog expects:

| Supplier Sends | Catalog Has | Problem |
|---------------|-------------|---------|
| `"RUNNING"` | `"Running Shoes"` | Wrong casing, abbreviated |
| `"nike"` | `"Nike Inc."` | Lowercase, missing suffix |
| `"bball"` | `"Basketball"` or `"Baseball"` ? | Ambiguous abbreviation |
| `"baskeball"` | `"Basketball"` | Typo |
| `"cross-training"` | `"Training"` | Alternate terminology |
| `"lifestyle"` | `"Casual"` | Completely different word |

The `@CoerceCase` and `@CoerceTrim` decorators from earlier parts handle casing and whitespace. But they can't fix typos, resolve abbreviations, or map alternate terminology. You need **fuzzy matching** -- and the set of valid values needs to come from the live catalog, not hardcoded constants.

---

## Step 2: @CoerceFromSet -- Fuzzy Matching

The `@CoerceFromSet` decorator matches an input value against a set of candidates using a configurable strategy. Start with the simplest version -- a hardcoded set -- to understand the mechanics before wiring up the live catalog.

### Exact Matching

The `exact` strategy matches case-insensitively but requires the full, correct value:

```typescript
import {
  CoerceFromSet,
  CoerceTrim,
  CoerceCase,
  ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

const CATEGORIES = [
  'Running Shoes', 'Basketball', 'Hiking',
  'Casual', 'Training',
];

class ProductWithExactMatch {
  @ValidateRequired()
  @CoerceTrim()
  @CoerceFromSet(() => CATEGORIES, {
    strategy: 'exact',
    caseSensitive: false,
  })
  category: string;
}

// "RUNNING SHOES"  -> "Running Shoes"   (case-insensitive match)
// "Basketball"     -> "Basketball"       (exact match)
// "baskeball"      -> Error              (exact can't handle typos)
// "bball"          -> Error              (exact can't handle abbreviations)
```

Exact matching handles `"RUNNING SHOES"` but fails on `"baskeball"`. For typo tolerance, you need the `fuzzy` strategy.

### Fuzzy Matching with Levenshtein Distance

The `fuzzy` strategy uses Levenshtein distance to find the closest candidate above a confidence threshold:

```typescript
class ProductWithFuzzyMatch {
  @ValidateRequired()
  @CoerceTrim()
  @CoerceFromSet(() => CATEGORIES, {
    strategy: 'fuzzy',
    fuzzyThreshold: 0.7,  // 0 = match anything, 1 = exact only
  })
  category: string;
}

// "baskeball"      -> "Basketball"     (score ~0.89, one transposed letter)
// "Runing Shoes"   -> "Running Shoes"  (score ~0.92, missing letter)
// "Traning"        -> "Training"       (score ~0.86, missing letter)
// "xyz"            -> Error            (no match above 0.7)
```

The `fuzzyThreshold` controls how strict the matching is. A threshold of `0.7` means the input must be at least 70% similar to a candidate. For category names, `0.7` is a good balance -- it catches common typos without producing false positives.

### Adding Synonyms

Fuzzy matching handles typos, but `"lifestyle"` and `"Casual"` share almost no characters. For completely different terms that mean the same thing, use **synonyms**:

```typescript
class ProductWithSynonyms {
  @ValidateRequired()
  @CoerceTrim()
  @CoerceFromSet(() => CATEGORIES, {
    strategy: 'fuzzy',
    fuzzyThreshold: 0.7,
    synonyms: {
      'Casual': ['lifestyle', 'everyday', 'street', 'streetwear'],
      'Training': ['cross-training', 'gym', 'workout', 'fitness'],
      'Running Shoes': ['jogging', 'road running', 'trail running', 'runners'],
      'Basketball': ['hoops', 'bball'],
      'Hiking': ['trail', 'outdoor', 'trekking'],
    },
  })
  category: string;
}

// "lifestyle"      -> "Casual"         (synonym match)
// "cross-training" -> "Training"       (synonym match)
// "bball"          -> "Basketball"     (synonym match)
// "joging"         -> "Running Shoes"  (fuzzy matches synonym "jogging")
// "baskeball"      -> "Basketball"     (fuzzy match on the canonical value)
```

Synonyms are checked **before** fuzzy matching, making them fast and deterministic. They're the right tool for known alternate terms, abbreviations, and industry jargon. Fuzzy matching is the fallback for unexpected typos.

> **Without validation classes:** You'd write a function with a switch statement mapping known synonyms, then a separate fuzzy-match helper with Levenshtein, then wire them together with if/else for each field. Every new supplier term means a code change. With `@CoerceFromSet`, the synonym map is data, not code -- and it's declared right on the field it applies to.

---

## Step 3: CatalogContext -- Runtime Value Sets

Hardcoded arrays work for prototyping, but the real FireKicks catalog lives in the database. Categories, brands, and subcategories change over time -- new ones get added, old ones get retired. You need to load the valid values at runtime and pass them into the validation pipeline.

### Define the Context Type

Create a `CatalogContext` interface in the shared type package so it's available to the bundle, GUI, and backend:

**`packages/catalog-types/src/context.ts`**:

```typescript
export interface CatalogContext {
  categories: string[];
  subcategories: string[];
  brands: string[];
  categorySynonyms: Record<string, string[]>;
  brandSynonyms: Record<string, string[]>;
}
```

### Use Context in Decorators

Update the `SupplierProductDraft` class to pull its match sets from context instead of hardcoded arrays. The `@CoerceFromSet` decorator accepts a function that receives the context object and returns the candidate array:

**`packages/catalog-types/src/validators/SupplierProductDraft.ts`** (updated fields):

```typescript
import {
  CoerceFromSet,
  CoerceTrim,
  CoerceCase,
  ValidateRequired,
  DerivedFrom,
  Staging,
} from '@firebrandanalytics/shared-utils/validation';
import type { CatalogContext } from '../context.js';

class SupplierProductDraft {
  @ValidateRequired()
  @DerivedFrom([
    '$.product_name',
    '$.productInfo.name',
    '$.PRODUCT_NAME',
  ])
  @CoerceTrim()
  @CoerceCase('title')
  @Staging()
  product_name: string;

  @ValidateRequired()
  @DerivedFrom([
    '$.category',
    '$.productInfo.category',
    '$.CATEGORY',
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.categories,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.7,
      synonyms: {
        // Static fallback synonyms -- always available even without DB synonyms
        'Casual': ['lifestyle', 'everyday', 'street'],
        'Training': ['cross-training', 'gym', 'workout'],
        'Running Shoes': ['jogging', 'runners'],
        'Basketball': ['hoops', 'bball'],
        'Hiking': ['trail', 'trekking'],
      },
    }
  )
  @Staging()
  category: string;

  @DerivedFrom([
    '$.subcategory',
    '$.productInfo.subcategory',
    '$.SUBCATEGORY',
  ])
  @CoerceTrim()
  @CoerceCase('lower')
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.subcategories,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.6,  // More lenient -- subcategories vary widely
    }
  )
  @Staging()
  subcategory: string;

  @ValidateRequired()
  @DerivedFrom([
    '$.brand',
    '$.productInfo.brand',
    '$.BRAND',
  ])
  @CoerceTrim()
  @CoerceFromSet<CatalogContext>(
    (ctx) => ctx.brands,
    {
      strategy: 'fuzzy',
      fuzzyThreshold: 0.7,
    }
  )
  @Staging()
  brand: string;

  // --- Price fields unchanged from Part 3 ---

  @DerivedFrom(['$.base_cost', '$.pricing.wholesale', '$.WHOLESALE_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  @Staging()
  base_cost: number;

  @DerivedFrom(['$.msrp', '$.pricing.retail', '$.RETAIL_PRICE'])
  @CoerceParse('currency', { locale: 'en-US', allowNonString: true })
  @ValidateRange(0.01)
  @Staging()
  msrp: number;
}
```

The key change: `@CoerceFromSet(() => CATEGORIES, ...)` became `@CoerceFromSet<CatalogContext>((ctx) => ctx.categories, ...)`. The decorator extracts the candidate array from whatever context object is passed at runtime.

### Pass Context at Validation Time

When creating the validator, pass the context object through the `options` parameter:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';
import type { CatalogContext } from '../context.js';

const factory = new ValidationFactory();

const catalogContext: CatalogContext = {
  categories: ['Running Shoes', 'Basketball', 'Hiking', 'Casual', 'Training'],
  subcategories: ["Men's", "Women's", "Unisex", "Kids"],
  brands: ['Nike Inc.', 'Adidas AG', 'New Balance', 'Puma SE', 'Reebok'],
  categorySynonyms: {},
  brandSynonyms: {},
};

const draft = await factory.create(
  SupplierProductDraft,
  rawSupplierPayload,
  { context: catalogContext }  // <-- Context is available to every decorator
);
```

The context is available to every `@CoerceFromSet` decorator in the class. When a new category is added to the database, the validator automatically picks it up without any code changes.

---

## Step 4: DAS Integration

The hardcoded `catalogContext` above is fine for testing, but in production the values come from the FireKicks database. The agent bundle queries the Data Access Service (DAS) to load canonical values at intake time.

### Set Up the DAS Client

If you haven't already configured a DAS client, create one:

**`apps/catalog-bundle/src/das-client.ts`**:

```typescript
import { DataAccessClient } from '@firebrandanalytics/data-access-client';

const FF_DATA_SERVICE_URL =
  process.env.FF_DATA_SERVICE_URL || 'http://localhost:8080';

export const dasClient = new DataAccessClient({
  serviceUrl: FF_DATA_SERVICE_URL,
});
```

The client handles authentication automatically via the platform's function identity headers (`X-Function-Name`, `X-Function-Namespace`). No API keys needed.

### Build CatalogContext from Live Data

Create a helper that loads the canonical values from the FireKicks database:

**`apps/catalog-bundle/src/catalog-context.ts`**:

```typescript
import { logger } from '@firebrandanalytics/ff-agent-sdk';
import { dasClient } from './das-client.js';
import type { CatalogContext } from '@catalog-intake/catalog-types';

export async function loadCatalogContext(): Promise<CatalogContext> {
  logger.info('[CatalogContext] Loading canonical values from DAS');

  const [categories, subcategories, brands, synonymRows] = await Promise.all([
    dasClient.explainSQL('firekicks', {
      sql: 'SELECT DISTINCT name FROM categories ORDER BY name',
    }),
    dasClient.explainSQL('firekicks', {
      sql: 'SELECT DISTINCT name FROM subcategories ORDER BY name',
    }),
    dasClient.explainSQL('firekicks', {
      sql: 'SELECT DISTINCT display_name FROM brands ORDER BY display_name',
    }),
    dasClient.explainSQL('firekicks', {
      sql: `SELECT c.name AS canonical, s.term AS synonym
            FROM category_synonyms s
            JOIN categories c ON c.id = s.category_id`,
    }),
  ]);

  // Build the synonym map: { "Casual": ["lifestyle", "everyday"], ... }
  const categorySynonyms: Record<string, string[]> = {};
  for (const row of synonymRows.rows ?? []) {
    const canonical = row.canonical as string;
    const synonym = row.synonym as string;
    if (!categorySynonyms[canonical]) {
      categorySynonyms[canonical] = [];
    }
    categorySynonyms[canonical].push(synonym);
  }

  const ctx: CatalogContext = {
    categories: (categories.rows ?? []).map((r) => r.name as string),
    subcategories: (subcategories.rows ?? []).map((r) => r.name as string),
    brands: (brands.rows ?? []).map((r) => r.display_name as string),
    categorySynonyms,
    brandSynonyms: {},  // Add brand synonyms when needed
  };

  logger.info('[CatalogContext] Loaded', {
    categories: ctx.categories.length,
    subcategories: ctx.subcategories.length,
    brands: ctx.brands.length,
    synonymEntries: Object.keys(ctx.categorySynonyms).length,
  });

  return ctx;
}
```

### Use CatalogContext in the Intake Bot

Update `CatalogIntakeBot` to load the catalog context before validation:

**`apps/catalog-bundle/src/bots/CatalogIntakeBot.ts`** (updated section):

```typescript
import { loadCatalogContext } from '../catalog-context.js';

// Inside the bot's processing logic:
async processSubmission(rawPayload: unknown) {
  // Load canonical values from the live catalog
  const catalogContext = await loadCatalogContext();

  // Validate with catalog context
  const draft = await this.factory.create(
    SupplierProductDraft,
    rawPayload,
    { context: catalogContext }
  );

  return draft;
}
```

The `loadCatalogContext()` call runs four SQL queries in parallel via `Promise.all`, so the DAS round-trip adds minimal latency. For high-volume intake, you could cache the context and refresh it periodically -- but for now, loading fresh on each submission ensures you're always matching against the latest catalog.

---

## Step 5: Confidence Scoring

Not all fuzzy matches are equally reliable. A match with a score of 0.95 is almost certainly correct. A match with 0.72 is a guess. The validation pipeline needs to distinguish between these cases so humans only review the uncertain ones.

### Three Confidence Tiers

| Score Range | Tier | Action |
|------------|------|--------|
| > 0.9 | High confidence | Auto-accept. The match is almost certainly correct. |
| 0.7 -- 0.9 | Medium confidence | Flag for review. The match is plausible but uncertain. |
| < 0.7 | Low confidence | `CoercionAmbiguityError`. No match is reliable enough. |

The `fuzzyThreshold` in `@CoerceFromSet` controls the low-confidence cutoff. Matches below the threshold throw an error. The high/medium distinction is something you implement in the bot logic.

### Capturing Match Candidates

When a fuzzy match is ambiguous -- two candidates score within `ambiguityTolerance` of each other -- `@CoerceFromSet` throws a `CoercionAmbiguityError` with the candidate list:

```typescript
import {
  CoercionAmbiguityError,
} from '@firebrandanalytics/shared-utils/validation';

try {
  const draft = await factory.create(
    SupplierProductDraft,
    { product_name: 'Test', category: 'sport', brand: 'Nike' },
    { context: catalogContext }
  );
} catch (error) {
  if (error instanceof CoercionAmbiguityError) {
    console.log(error.field);       // "category"
    console.log(error.inputValue);  // "sport"
    console.log(error.candidates);
    // [
    //   { value: 'Running Shoes', score: 0.42 },
    //   { value: 'Training', score: 0.38 }
    // ]
    // Both below threshold AND close to each other -- ambiguous
  }
}
```

### Controlling Ambiguity Tolerance

By default, candidates within `0.1` of each other's score are considered ambiguous. Tighten it for fields where a wrong match is costly:

```typescript
@CoerceFromSet<CatalogContext>(
  (ctx) => ctx.categories,
  {
    strategy: 'fuzzy',
    fuzzyThreshold: 0.7,
    ambiguityTolerance: 0.05,  // Stricter: only flag if scores are within 5%
  }
)
category: string;
```

For catalog intake, erring on the side of human review is safer -- a wrong category match is worse than a delayed import.

### Extracting Confidence from the Trace

The validation trace (from Part 5) captures what `@CoerceFromSet` did to each field, including the match score. Extract it in the bot to build a confidence report:

```typescript
import { ValidationFactory } from '@firebrandanalytics/shared-utils/validation';

const factory = new ValidationFactory();

const result = await factory.create(
  SupplierProductDraft,
  rawPayload,
  {
    context: catalogContext,
    engine: 'convergent',
    trace: true,
  }
);

// Extract match confidence from the trace
const trace = factory.getLastTrace();

interface FieldConfidence {
  field: string;
  originalValue: string;
  matchedValue: string;
  score: number;
  tier: 'high' | 'medium' | 'low';
  candidates?: Array<{ value: string; score: number }>;
}

const confidenceReport: FieldConfidence[] = [];

for (const entry of trace.entries) {
  if (entry.decorator === 'CoerceFromSet' && entry.matchScore !== undefined) {
    const tier = entry.matchScore > 0.9
      ? 'high'
      : entry.matchScore >= 0.7
        ? 'medium'
        : 'low';

    confidenceReport.push({
      field: entry.property,
      originalValue: entry.inputValue,
      matchedValue: entry.outputValue,
      score: entry.matchScore,
      tier,
      candidates: entry.candidates,
    });
  }
}

// Store with the entity for the GUI to display
// dto.data.confidenceReport = confidenceReport;
```

A typical confidence report looks like this:

```json
[
  {
    "field": "category",
    "originalValue": "baskeball",
    "matchedValue": "Basketball",
    "score": 0.89,
    "tier": "medium",
    "candidates": [
      { "value": "Basketball", "score": 0.89 },
      { "value": "Baseball", "score": 0.44 }
    ]
  },
  {
    "field": "brand",
    "originalValue": "nike",
    "matchedValue": "Nike Inc.",
    "score": 0.72,
    "tier": "medium"
  },
  {
    "field": "subcategory",
    "originalValue": "mens",
    "matchedValue": "Men's",
    "score": 0.80,
    "tier": "medium"
  }
]
```

The `"baskeball"` -> `"Basketball"` match at 0.89 is probably correct, but it's in the medium tier -- so it gets flagged for review. The reviewer can see `"Baseball"` was also considered (at 0.44) and confirm the match.

---

## Step 6: Update the GUI

The GUI needs to show match confidence so reviewers can focus on the uncertain fields. Update the product browser and intake form.

### Confidence Indicators in the Product Browser

Add color-coded confidence badges next to each fuzzy-matched field:

**`apps/catalog-gui/src/components/ConfidenceBadge.tsx`**:

```tsx
interface ConfidenceBadgeProps {
  score: number;
  tier: 'high' | 'medium' | 'low';
}

function ConfidenceBadge({ score, tier }: ConfidenceBadgeProps) {
  const colors = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800',
  };

  const labels = {
    high: 'Auto-matched',
    medium: 'Review',
    low: 'No match',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[tier]}`}>
      {labels[tier]} ({Math.round(score * 100)}%)
    </span>
  );
}
```

### Ambiguity Highlighting

When a field has multiple close candidates, show the alternatives so the reviewer can pick the right one:

**`apps/catalog-gui/src/components/AmbiguityPicker.tsx`**:

```tsx
interface Candidate {
  value: string;
  score: number;
}

interface AmbiguityPickerProps {
  field: string;
  currentValue: string;
  candidates: Candidate[];
  onSelect: (value: string) => void;
}

function AmbiguityPicker({
  field,
  currentValue,
  candidates,
  onSelect,
}: AmbiguityPickerProps) {
  return (
    <div className="border border-yellow-300 rounded-md p-3 bg-yellow-50">
      <p className="text-sm font-medium text-yellow-800">
        Ambiguous match for <code>{field}</code>
      </p>
      <p className="text-sm text-yellow-700 mt-1">
        Did you mean:
      </p>
      <div className="mt-2 space-y-1">
        {candidates.map((candidate) => (
          <button
            key={candidate.value}
            onClick={() => onSelect(candidate.value)}
            className={`block w-full text-left px-3 py-1.5 rounded text-sm
              ${candidate.value === currentValue
                ? 'bg-yellow-200 font-medium'
                : 'hover:bg-yellow-100'
              }`}
          >
            {candidate.value}
            <span className="text-yellow-600 ml-2">
              ({Math.round(candidate.score * 100)}%)
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Product Browser with Confidence

Wire the confidence report into the product detail view:

**`apps/catalog-gui/src/components/ProductDetail.tsx`** (updated section):

```tsx
import { ConfidenceBadge } from './ConfidenceBadge';
import { AmbiguityPicker } from './AmbiguityPicker';
import type { FieldConfidence } from '@catalog-intake/catalog-types';

interface ProductDetailProps {
  product: SupplierProduct;
  confidenceReport: FieldConfidence[];
  onFieldUpdate: (field: string, value: string) => void;
}

function ProductDetail({
  product,
  confidenceReport,
  onFieldUpdate,
}: ProductDetailProps) {
  // Index confidence by field name for easy lookup
  const confidenceByField = new Map(
    confidenceReport.map((c) => [c.field, c])
  );

  return (
    <div className="space-y-4">
      {/* Category field with confidence */}
      <div>
        <label className="text-sm font-medium text-gray-700">Category</label>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm">{product.category}</span>
          {confidenceByField.has('category') && (
            <ConfidenceBadge
              score={confidenceByField.get('category')!.score}
              tier={confidenceByField.get('category')!.tier}
            />
          )}
        </div>
        {/* Show ambiguity picker if there are close candidates */}
        {confidenceByField.get('category')?.candidates &&
         confidenceByField.get('category')!.candidates!.length > 1 && (
          <AmbiguityPicker
            field="category"
            currentValue={product.category}
            candidates={confidenceByField.get('category')!.candidates!}
            onSelect={(value) => onFieldUpdate('category', value)}
          />
        )}
      </div>

      {/* Brand field with confidence */}
      <div>
        <label className="text-sm font-medium text-gray-700">Brand</label>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm">{product.brand}</span>
          {confidenceByField.has('brand') && (
            <ConfidenceBadge
              score={confidenceByField.get('brand')!.score}
              tier={confidenceByField.get('brand')!.tier}
            />
          )}
        </div>
      </div>

      {/* Subcategory field with confidence */}
      <div>
        <label className="text-sm font-medium text-gray-700">Subcategory</label>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm">{product.subcategory}</span>
          {confidenceByField.has('subcategory') && (
            <ConfidenceBadge
              score={confidenceByField.get('subcategory')!.score}
              tier={confidenceByField.get('subcategory')!.tier}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

### Intake Form: Autocomplete from Catalog Context

The same catalog context that powers fuzzy matching can also power autocomplete in the intake form. Load the context once and use it for suggestions:

**`apps/catalog-gui/src/components/CatalogAutocomplete.tsx`**:

```tsx
import { useState, useMemo } from 'react';

interface CatalogAutocompleteProps {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
}

function CatalogAutocomplete({
  label,
  values,
  value,
  onChange,
}: CatalogAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query) return values;
    const lower = query.toLowerCase();
    return values.filter((v) => v.toLowerCase().includes(lower));
  }, [query, values]);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
      />
      {isOpen && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
          {filtered.map((item) => (
            <li
              key={item}
              onMouseDown={() => {
                setQuery(item);
                onChange(item);
                setIsOpen(false);
              }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Use it in the intake form by fetching the catalog context from the bundle's API:

```tsx
// In the intake form component:
const [catalogContext, setCatalogContext] = useState<CatalogContext | null>(null);

useEffect(() => {
  fetch('/api/catalog-context')
    .then((res) => res.json())
    .then(setCatalogContext);
}, []);

// In the form:
{catalogContext && (
  <>
    <CatalogAutocomplete
      label="Category"
      values={catalogContext.categories}
      value={formData.category}
      onChange={(v) => setFormData({ ...formData, category: v })}
    />
    <CatalogAutocomplete
      label="Brand"
      values={catalogContext.brands}
      value={formData.brand}
      onChange={(v) => setFormData({ ...formData, brand: v })}
    />
    <CatalogAutocomplete
      label="Subcategory"
      values={catalogContext.subcategories}
      value={formData.subcategory}
      onChange={(v) => setFormData({ ...formData, subcategory: v })}
    />
  </>
)}
```

Add the API endpoint in the bundle to expose the catalog context:

**`apps/catalog-bundle/src/agent-bundle.ts`** (add endpoint):

```typescript
import { loadCatalogContext } from './catalog-context.js';

// GET /api/catalog-context -- returns canonical values for autocomplete
app.get('/api/catalog-context', async (req, res) => {
  const ctx = await loadCatalogContext();
  res.json(ctx);
});
```

---

## Try It: Messy Supplier Data with Fuzzy Resolution

Here's the full flow from messy input to matched output:

**Input (from a sloppy supplier):**

```json
{
  "PRODUCT_NAME": "  Air Jordan 1 Retro High  ",
  "CATEGORY": "baskeball",
  "SUBCATEGORY": "mens",
  "BRAND": "nike",
  "WHOLESALE_PRICE": "$95.00",
  "RETAIL_PRICE": "$170.00"
}
```

**Output after validation:**

```json
{
  "product_name": "Air Jordan 1 Retro High",
  "category": "Basketball",
  "subcategory": "Men's",
  "brand": "Nike Inc.",
  "base_cost": 95,
  "msrp": 170
}
```

**Confidence report:**

| Field | Input | Matched To | Score | Tier |
|-------|-------|-----------|-------|------|
| category | `"baskeball"` | `"Basketball"` | 0.89 | Medium -- flagged for review |
| subcategory | `"mens"` | `"Men's"` | 0.80 | Medium -- flagged for review |
| brand | `"nike"` | `"Nike Inc."` | 0.72 | Medium -- flagged for review |

All three fuzzy-matched fields land in the medium tier. The reviewer sees green/yellow/red badges in the product browser, confirms the matches are correct, and approves the import. If any match were wrong, they'd click the ambiguity picker to select the correct value.

---

## What's Next

Supplier values now match your catalog, but you need more complex validation rules. Margins must be positive (MSRP > base cost). Size format depends on the product category -- numeric for running shoes, letter-based for casual. And products have nested variant arrays with their own validation constraints.

In [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md), you'll add conditional validation with `@If`/`@Else`, cross-field rules with `@ObjectRule` and `@CrossValidate`, and nested array validation with `@ValidatedClassArray`.

---

**Next:** [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md)

**Previous:** [Part 5: The Validation Trace](./part-05-validation-trace.md)
