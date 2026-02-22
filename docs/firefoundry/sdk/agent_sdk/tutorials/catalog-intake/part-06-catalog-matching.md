# Part 6: Catalog Matching & Context

A supplier sends `"runing"` but your catalog only has `"running"`. Another sends `"bball"` and you need to figure out if that's `"basketball"` or `"baseball"`. Your validation pipeline from Parts 3-5 handles required fields, type coercion, range checks, and tracing -- but none of that helps when the supplier's free-text values don't match your canonical taxonomy.

This part bridges that gap: fuzzy matching against the real product catalog, with runtime context from DAS so the valid values stay current without code changes.

> **Prerequisite:** Complete [Part 5: The Validation Trace](./part-05-validation-trace.md). You should have a working pipeline with trace capture and `@Staging`.

---

## The Problem: Messy Values

Here's what suppliers actually send versus what the FireKicks catalog expects:

| Supplier Sends | Catalog Has | Why It Fails |
|---------------|-------------|--------------|
| `"runing"` | `"running"` | Typo (missing letter) |
| `"bball"` | `"basketball"` | Abbreviation |
| `"lifestyle"` | `"casual"` | Completely different word, same meaning |
| `"cross-training"` | `"training"` | Alternate terminology |
| `"baskeball"` | `"basketball"` | Transposed letters |

The `@CoerceCase` and `@CoerceTrim` decorators you already have handle casing and whitespace. But they can't fix typos, resolve abbreviations, or map industry jargon to your taxonomy. You need fuzzy matching -- and the set of valid values needs to come from the live catalog, not a hardcoded array that goes stale.

---

## @CoerceFromSet with Fuzzy Matching

The `@CoerceFromSet` decorator matches an input value against a candidate set. Start with a hardcoded set to understand the mechanics:

```typescript
@CoerceFromSet(['running', 'basketball', 'hiking', 'casual'], {
  fuzzy: true,
  threshold: 0.7,
  synonyms: { 'bball': 'basketball', 'jogging': 'running' },
})
category!: string;
```

Three things happen when a value hits this decorator:

1. **Synonym check** (fast, deterministic): `"bball"` matches the synonym map and resolves to `"basketball"` immediately. No fuzzy matching needed.
2. **Fuzzy match** (Levenshtein distance): `"runing"` doesn't match any synonym, so the decorator computes edit distance against every candidate. `"running"` scores ~0.86 -- above the 0.7 threshold -- so it's accepted.
3. **Rejection**: `"xyz"` scores below 0.7 against everything. The decorator throws a validation error.

Synonyms are checked first because they're deterministic. `"bball"` always means `"basketball"`, regardless of what other candidates exist. Fuzzy matching is the fallback for unexpected typos the synonym map doesn't cover.

The `threshold` controls how lenient the matching is. At `0.7`, the input must be at least 70% similar to a candidate. That catches common typos (`"baskeball"` -> `"basketball"` at ~0.89) without producing false positives (`"hat"` won't match `"hiking"` at 0.33).

---

## CatalogContext -- Runtime Context from DAS

Hardcoded arrays work for prototyping, but the FireKicks catalog changes -- new categories get added, old brands get retired. You need the valid values to come from the database at validation time.

### Define the context type

```typescript
// packages/catalog-types/src/context.ts
export interface CatalogContext {
  categories: string[];
  subcategories: string[];
  brands: string[];
  categorySynonyms: Record<string, string[]>;
  brandSynonyms: Record<string, string[]>;
}
```

### Load it from DAS

```typescript
import type { CatalogContext } from '@catalog-intake/catalog-types';

export async function loadCatalogContext(dasClient: DataAccessClient): Promise<CatalogContext> {
  const [categories, subcategories, brands] = await Promise.all([
    dasClient.explainSQL('firekicks', {
      sql: 'SELECT DISTINCT name FROM categories ORDER BY name',
    }),
    dasClient.explainSQL('firekicks', {
      sql: 'SELECT DISTINCT name FROM subcategories ORDER BY name',
    }),
    dasClient.explainSQL('firekicks', {
      sql: 'SELECT DISTINCT display_name FROM brands ORDER BY display_name',
    }),
  ]);

  return {
    categories: (categories.rows ?? []).map((r) => r.name as string),
    subcategories: (subcategories.rows ?? []).map((r) => r.name as string),
    brands: (brands.rows ?? []).map((r) => r.display_name as string),
    categorySynonyms: {},
    brandSynonyms: {},
  };
}
```

### Wire it into validation

Instead of a static array, the decorator pulls its candidate set from context:

```typescript
@CoerceFromSet<CatalogContext>(
  (ctx) => ctx.categories,   // <-- function, not array
  {
    fuzzy: true,
    threshold: 0.7,
    synonyms: {
      'bball': 'basketball',
      'jogging': 'running',
      'lifestyle': 'casual',
    },
  }
)
category!: string;
```

At validation time, pass the context through the factory:

```typescript
const context = await loadCatalogContext(dasClient);
const factory = new ValidationFactory();

const draft = await factory.create(
  SupplierProductDraft,
  rawPayload,
  { context }
);
```

Now when someone adds a new category to the database, the validator picks it up automatically on the next submission. No code change, no redeployment.

---

## Confidence Scoring

Not every fuzzy match is equally reliable. `"runing"` -> `"running"` at 0.86 is probably right. `"sport"` -> `"running"` at 0.42 is a guess. You need the pipeline to distinguish between these so humans only review the uncertain ones.

### Emitting confidence in the trace

Add `emitConfidence: true` to get match scores in the validation trace:

```typescript
@CoerceFromSet<CatalogContext>(
  (ctx) => ctx.categories,
  {
    fuzzy: true,
    threshold: 0.7,
    emitConfidence: true,
  }
)
category!: string;
```

The trace entry for this field now includes the match details:

```json
{
  "property": "category",
  "decorator": "CoerceFromSet",
  "before": "runing",
  "after": "running",
  "metadata": {
    "matchScore": 0.86,
    "matchType": "fuzzy",
    "candidates": [
      { "value": "running", "score": 0.86 },
      { "value": "training", "score": 0.57 }
    ]
  }
}
```

### Three confidence tiers

Use the score to bucket matches into tiers:

| Score | Tier | Action |
|-------|------|--------|
| > 0.9 | High | Auto-accept. Almost certainly correct. |
| 0.7 - 0.9 | Medium | Flag for review. Plausible but uncertain. |
| < 0.7 | Low | Rejected by `threshold`. No reliable match. |

Extract these from the trace in your bot logic:

```typescript
const trace = factory.getLastTrace();

for (const entry of trace.entries) {
  if (entry.decorator === 'CoerceFromSet' && entry.metadata?.matchScore) {
    const score = entry.metadata.matchScore as number;
    const tier = score > 0.9 ? 'high' : score >= 0.7 ? 'medium' : 'low';

    console.log(`${entry.property}: "${entry.before}" -> "${entry.after}" (${tier}, ${score})`);
  }
}
```

Output:

```
category: "runing" -> "running" (medium, 0.86)
brand: "nike" -> "Nike Inc." (medium, 0.72)
subcategory: "mens" -> "Men's" (medium, 0.80)
```

All three land in the medium tier -- flagged for review. A match like `"basketball"` -> `"basketball"` at 1.0 would sail through as high confidence.

### Ambiguous matches

When two candidates score close to each other, the match is ambiguous. `"sport"` might match `"running"` at 0.42 and `"training"` at 0.38 -- neither is confident, and they're close together. Configure `ambiguityTolerance` to control when this triggers:

```typescript
@CoerceFromSet<CatalogContext>(
  (ctx) => ctx.categories,
  {
    fuzzy: true,
    threshold: 0.7,
    ambiguityTolerance: 0.05,  // flag if top two candidates are within 5%
  }
)
category!: string;
```

When an ambiguous match is detected, `@CoerceFromSet` throws a `CoercionAmbiguityError` with the candidate list, so the reviewer can pick the right one.

---

## GUI Updates

The GUI needs three updates to surface match confidence to reviewers.

### Confidence indicators on the product browser

Color-coded badges next to each fuzzy-matched field:

```tsx
function ConfidenceBadge({ score, tier }: { score: number; tier: string }) {
  const colors: Record<string, string> = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800',
  };

  const labels: Record<string, string> = {
    high: 'Auto-matched',
    medium: 'Review',
    low: 'No match',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[tier]}`}>
      {labels[tier]} ({Math.round(score * 100)}%)
    </span>
  );
}
```

Green for auto-accepted matches, yellow for "a human should check this," red for failed matches.

### Ambiguity highlighting

When a field has close candidates, show the alternatives so the reviewer can pick:

```tsx
function AmbiguityPicker({ field, candidates, onSelect }: {
  field: string;
  candidates: Array<{ value: string; score: number }>;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="border border-yellow-300 rounded-md p-3 bg-yellow-50">
      <p className="text-sm font-medium text-yellow-800">
        Ambiguous match for <code>{field}</code> -- did you mean:
      </p>
      <div className="mt-2 space-y-1">
        {candidates.map((c) => (
          <button
            key={c.value}
            onClick={() => onSelect(c.value)}
            className="block w-full text-left px-3 py-1.5 rounded text-sm hover:bg-yellow-100"
          >
            {c.value} <span className="text-yellow-600 ml-2">({Math.round(c.score * 100)}%)</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Autocomplete on the intake form

The same catalog context that powers fuzzy matching can power autocomplete. Load the context once and use it for suggestions as the user types:

```tsx
function CatalogAutocomplete({ label, values, value, onChange }: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query) return values;
    const lower = query.toLowerCase();
    return values.filter((v) => v.toLowerCase().includes(lower));
  }, [query, values]);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
        onFocus={() => setIsOpen(true)}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
      />
      {isOpen && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
          {filtered.map((item) => (
            <li
              key={item}
              onMouseDown={() => { setQuery(item); onChange(item); setIsOpen(false); }}
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

Fetch the context from the bundle's `/api/catalog-context` endpoint and pass `catalogContext.categories`, `catalogContext.brands`, etc. as the `values` prop. The autocomplete and the fuzzy matcher are powered by the same data source, so they always agree on what's valid.

---

## What's Next

Supplier values now match your catalog, but you need more than field-level validation. Margins must be positive (MSRP > base cost). Size format depends on the product category. And products have nested variant arrays with their own constraints.

In [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md), you'll add conditional validation, cross-field rules, and nested array validation.

---

**Next:** [Part 7: Business Rules & Nested Variants](./part-07-rules-variants.md)

**Previous:** [Part 5: The Validation Trace](./part-05-validation-trace.md)
