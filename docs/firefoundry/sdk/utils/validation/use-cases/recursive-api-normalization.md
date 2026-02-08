# Recursive API Normalization

Normalize deeply nested third-party API responses with inconsistent key casing, extra whitespace, and variable structure.

---

## The Problem

A third-party API returns responses where the same conceptual field appears under different key names depending on the endpoint, API version, or even the time of day. One response spells it `"firstName"`, the next uses `"First_Name"`, and a third returns `"FIRST_NAME"`. String values arrive padded with whitespace. Nested objects -- addresses, contact info, metadata -- exhibit the same inconsistencies at every level of depth.

Writing manual normalization for this means recursive traversal code, per-field conditionals, and a growing library of ad-hoc key maps for every integration. When the API adds a new nesting level or renames a field, the traversal breaks silently and bad data propagates downstream.

What you want is a declarative description of the *desired* shape that tolerates key-name chaos at the source and normalizes string values automatically at every nesting level.

## The Strategy

**Class-level matching strategy with targeted and recursive normalization.** Combine `@MatchingStrategy` for tolerant key lookup with `@DefaultTransforms` for blanket string cleaning and `@ValidatedClass` for nested sub-structures.

| Aspect | Approach |
|--------|----------|
| Key lookup | `@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })` at the class level -- matches `"First_Name"`, `"FIRST_NAME"`, and `"firstName"` to the `firstName` property without mutating the input |
| String cleaning | `@DefaultTransforms({ string: TrimStyle })` trims all string properties by default; per-property `@CoerceCase` stacks on top |
| Nested normalization | `@ValidatedClass(Address)` and `@ValidatedClass(ContactInfo)` run the same decorator pipeline on known sub-objects |
| Deep blanket normalization | `@RecursiveKeys()` / `@RecursiveValues()` for unknown or dynamically-shaped nested structures where defining individual classes is impractical |

## Architecture

```
           Inconsistent API Response
          { "First_Name": "  JANE  ",
            "LAST NAME": "  DOE  ",
            "ADDRESS": { "STREET_address": "  123 MAIN  ", ... } }
                         |
                         v
          +-----------------------------+
          |     @MatchingStrategy       |
          |  (fuzzy key lookup,         |
          |   case-insensitive)         |
          +-----------------------------+
                         |
                         v
          +-----------------------------+
          |     @DefaultTransforms      |
          |  (trim all string values)   |
          +-----------------------------+
                         |
            +------------+------------+
            |                         |
            v                         v
    scalar properties          nested objects
    @CoerceCase('lower')       @ValidatedClass(Address)
    @ValidatePattern(...)      @ValidatedClass(ContactInfo)
            |                         |
            |                  same pipeline recursively
            |                         |
            +------------+------------+
                         |
                         v
             Clean, Consistent Output
          { firstName: "jane",
            lastName: "doe",
            address: { street: "123 main", ... } }
```

## Implementation

### 1. Define a reusable trim style

```typescript
import {
  ValidationFactory,
  ValidatedClass,
  MatchingStrategy,
  DefaultTransforms,
  ManageAll,
  CoerceTrim,
  CoerceCase,
  ValidateRequired,
  ValidatePattern,
  RecursiveKeys,
  RecursiveValues,
  Copy,
} from '@firebrandanalytics/shared-utils/validation';

/** Applied automatically to every string property via @DefaultTransforms. */
class TrimStyle {
  @CoerceTrim()
  value!: string;
}
```

### 2. Define nested validated classes

Each nested class gets its own `@MatchingStrategy` so it tolerates inconsistent keys independently.

```typescript
@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class Address {
  @CoerceCase('lower')
  @ValidateRequired()
  street!: string;

  @CoerceCase('lower')
  @ValidateRequired()
  city!: string;

  @CoerceCase('upper')
  state!: string;

  @ValidatePattern(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code')
  zipCode!: string;
}

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class ContactInfo {
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
  email!: string;

  @CoerceTrim()
  phone!: string;
}
```

### 3. Define the top-level API response class

```typescript
@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class APICustomer {
  @CoerceCase('lower')
  @ValidateRequired()
  firstName!: string;

  @CoerceCase('lower')
  @ValidateRequired()
  lastName!: string;

  @ValidatedClass(Address)
  address!: Address;

  @ValidatedClass(ContactInfo)
  contactInfo!: ContactInfo;

  @CoerceCase('lower')
  accountType!: string;
}
```

### 4. Run the pipeline

```typescript
const factory = new ValidationFactory();

const messyApiResponse = {
  'First_Name':  '  JANE  ',
  '  LAST NAME ': '  DOE  ',
  'ADDRESS': {
    'STREET_address': '  123 MAIN ST  ',
    'City':           '  SPRINGFIELD  ',
    'STATE':          '  il  ',
    'Zip_Code':       '62701',
  },
  'Contact_Info': {
    'E_MAIL':  '  JANE.DOE@EXAMPLE.COM  ',
    'PHONE':   '  (555) 123-4567  ',
  },
  'account_TYPE': '  PREMIUM  ',
};

const customer = await factory.create(APICustomer, messyApiResponse);

console.log(customer.firstName);             // "jane"
console.log(customer.lastName);              // "doe"
console.log(customer.address.street);        // "123 main st"
console.log(customer.address.city);          // "springfield"
console.log(customer.address.state);         // "IL"
console.log(customer.address.zipCode);       // "62701"
console.log(customer.contactInfo.email);     // "jane.doe@example.com"
console.log(customer.contactInfo.phone);     // "(555) 123-4567"
console.log(customer.accountType);           // "premium"
```

**Line-by-line breakdown:**

1. **`@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })`** at the class level means property lookups tolerate key variations. `"First_Name"` fuzzy-matches the `firstName` property. `"STREET_address"` fuzzy-matches `street`. The raw input object is never mutated.

2. **`@DefaultTransforms({ string: TrimStyle })`** ensures every string property is trimmed before any per-property decorators run. `"  JANE  "` becomes `"JANE"` before `@CoerceCase('lower')` turns it into `"jane"`.

3. **`@ValidatedClass(Address)`** tells the factory to run the `Address` class's own decorator pipeline on the nested object. Because `Address` has its own `@MatchingStrategy`, keys like `"STREET_address"` and `"Zip_Code"` are matched tolerantly within that scope.

4. **`@ManageAll()`** auto-sources every declared property from the input. Without it, each property would need an explicit `@Copy()`.

## What to Observe

Running the [companion example](../examples/recursive-api-normalization.ts) produces output like this:

```
=== Recursive API Normalization ===

--- Messy API Response ---
  First_Name     : "  JANE  "
  LAST NAME      : "  DOE  "
  ADDRESS        : { STREET_address: "  123 MAIN ST  ", City: "  SPRINGFIELD  ", ... }
  Contact_Info   : { E_MAIL: "  JANE.DOE@EXAMPLE.COM  ", PHONE: "  (555) 123-4567  " }
  account_TYPE   : "  PREMIUM  "

--- After Normalization ---
  firstName      : "jane"
  lastName       : "doe"
  address.street : "123 main st"
  address.city   : "springfield"
  address.state  : "IL"
  address.zipCode: "62701"
  contactInfo.email: "jane.doe@example.com"
  contactInfo.phone: "(555) 123-4567"
  accountType    : "premium"
```

| Field | Transformation | What to watch for |
|-------|---------------|-------------------|
| `firstName` | Fuzzy key match + trim + lowercase | `"First_Name"` matches `firstName` at ~0.78 similarity; lowering the threshold below 0.7 risks false matches with similarly-named keys |
| `address.street` | Nested fuzzy key match + trim + lowercase | `"STREET_address"` matches `street`; the nested `@MatchingStrategy` runs independently |
| `address.state` | Trim + uppercase | `"  il  "` becomes `"IL"` -- uppercase for state codes while other fields go lowercase |
| `address.zipCode` | Trim + pattern validation | The `@ValidatePattern` catches malformed ZIP codes even after trimming |
| `contactInfo.email` | Nested fuzzy match + trim + lowercase + pattern | `"E_MAIL"` matches `email`; the pattern check runs after normalization |

## Variations

### 1. Using @RecursiveKeys for blanket key normalization

When you do not know the shape of the nested data (e.g., arbitrary metadata), use `@RecursiveKeys()` to normalize all keys at every depth without defining nested classes.

```typescript
@RecursiveKeys()
@CoerceCase('lower')
@CoerceTrim()
class DynamicPayload {
  @Copy()
  data!: Record<string, unknown>;
}

// Input: { "  SOME_Key  ": { "  NESTED_KEY  ": "value" } }
// Output keys: { "some_key": { "nested_key": "value" } }
```

This is simpler but less targeted -- every key in the entire tree is lowercased and trimmed, including keys you might want to preserve.

### 2. Combining class-level and property-level matching strategies

Set a lenient class-level strategy and override specific properties that need stricter matching.

```typescript
@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.6 })
@ManageAll()
class FlexibleRecord {
  @CoerceTrim()
  description!: string;       // uses class-level threshold (0.6)

  @MatchingStrategy('exact')  // override: require exact key match
  @CoerceTrim()
  id!: string;                // only matches "id", not "ID" or "identifier"

  @MatchingStrategy({ strategy: 'fuzzy', threshold: 0.9 })
  @CoerceTrim()
  legalName!: string;         // stricter fuzzy threshold for legal fields
}
```

### 3. Performance tradeoffs: targeted vs recursive

| Approach | When to use | Trade-off |
|----------|-------------|-----------|
| `@ValidatedClass` per nested object | You know the shape of nested data at design time | More boilerplate, but each level has its own validation rules and error messages |
| `@RecursiveKeys()` / `@RecursiveValues()` | Unknown or highly dynamic nested structures (metadata, config blobs) | Less code, but applies the same transform everywhere -- no per-level validation |
| Hybrid | Top-level fields use `@ValidatedClass`; a `metadata` catch-all uses `@RecursiveValues()` | Best of both: structure where you need it, flexibility where you do not |

```typescript
@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@ManageAll()
class HybridRecord {
  @ValidatedClass(Address)
  address!: Address;           // targeted normalization with validation

  @RecursiveValues()
  @CoerceTrim()
  @CoerceCase('lower')
  metadata!: Record<string, unknown>;  // blanket normalization
}
```

### 4. Handling arrays of nested objects

When the API returns arrays of nested objects, use `@ValidatedClassArray` to normalize each element.

```typescript
import { ValidatedClassArray } from '@firebrandanalytics/shared-utils/validation';

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class OrderItem {
  @CoerceCase('upper')
  sku!: string;

  @CoerceCase('lower')
  productName!: string;

  @CoerceType('number')
  quantity!: number;
}

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@ManageAll()
class OrderResponse {
  @CoerceTrim()
  orderId!: string;

  @ValidatedClassArray(OrderItem)
  items!: OrderItem[];
}

// Input: { "ORDER_ID": " PO-123 ", "Items": [
//   { "SKU": " wid-001 ", "Product_Name": " WIDGET ", "QTY": "5" },
//   { "sku": " gad-002 ", "product_name": " GADGET ", "quantity": "10" }
// ]}
// Each element in the items array is independently normalized through OrderItem.
```

## See Also

- [Conceptual Guide](../concepts.md) -- Decorator pipeline model, context decorators, class-level canonicalization
- [API Reference](../validation-library-reference.md) -- Full `@MatchingStrategy`, `@RecursiveKeys`, `@ValidatedClass` signatures
- [Advanced Guide -- Matching Strategies](../validation-library-advanced.md) -- Threshold tuning, ambiguity handling, class vs property scope
- [LLM Output Canonicalization (use case)](./llm-output-canonicalization.md) -- Single-level normalization with `@CoerceTrim`, `@CoerceCase`, `@CoerceType`
- [Fuzzy Inventory Matching (use case)](./fuzzy-inventory-matching.md) -- `@CoerceFromSet` for matching values against known catalogs
- [Runnable example](../examples/recursive-api-normalization.ts) -- Self-contained TypeScript program you can execute with `npx tsx`
