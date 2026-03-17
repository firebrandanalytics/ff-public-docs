# Data Access Service — Data Wrangling

## Overview

The Data Wrangling subsystem is a Go-native validation and transformation pipeline built into the Data Access Service. It processes tabular data through a sequence of deterministic rules defined in a `WrangleSpec` — a JSON-serializable format compatible with the TypeScript validation library's `WrangleSpec` format (deterministic rules only).

Wrangling sits in the DAS ingestion pipeline: raw data enters (via inline JSON, CSV upload, or scratch pad), passes through column-level rules (type coercion, trimming, case normalization, currency parsing, fuzzy matching, pattern validation), and exits as clean, validated rows ready for downstream use.

### When to Use Wrangling

- **CSV cleanup on upload**: Normalize messy vendor files before loading into scratch pads
- **Data prep for AI agents**: Clean data before it enters entity graph or analytical workflows
- **Batch validation**: Validate large datasets against a schema, collecting per-row errors
- **Fuzzy matching**: Resolve misspelled categories, brand names, or product codes against canonical sets via NER value stores

### Relationship to TypeScript Validation Library

The Go wrangling engine implements the **deterministic subset** of the TypeScript `@firebrandanalytics/shared-utils` validation library. Both share the same `WrangleSpec` JSON format and column rule semantics. The Go engine does not support AI-powered transforms (`@AITransform`, `@AIValidate`, `@AISpellCheck`) — those require the TypeScript library with broker integration.

For the TypeScript validation library and `compileWrangleSpec()`, see the [Validation Library docs](../../sdk/utils/validation/) and the [Catalog Intake Tutorial Part 12](../../sdk/agent_sdk/tutorials/catalog-intake/part-12-data-wrangling.md).

---

## WrangleSpec Format

A `WrangleSpec` is a JSON object with three fields:

```json
{
  "name": "VendorCatalogCleanup",
  "engine": "single-pass",
  "columns": {
    "product_id": { "type": "string", "trim": true, "case": "upper", "required": true },
    "product_name": { "type": "string", "trim": true, "case": "title", "length": [2, 100] },
    "unit_price": { "type": "number", "parse": "currency", "format": "0.00", "range": [0, 100000] },
    "category": { "type": "string", "trim": true, "fuzzyMatch": { "category": "product_categories", "threshold": 0.6 } },
    "in_stock": { "type": "boolean", "default": false }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name for the spec |
| `engine` | string | No | `"single-pass"` or `"convergent"` (default: `"convergent"`) |
| `columns` | object | Yes | Map of column name → `ColumnSpec` rules |

### Engine Modes

- **`single-pass`**: Each row is processed once through the rule pipeline. Use for straightforward cleanup where rules are independent.
- **`convergent`** (default): The engine re-runs the pipeline until the row stabilizes (no changes between iterations) or reaches 10 iterations. Use when rules have dependencies — e.g., `copyFrom` fills a column that a subsequent `fuzzyMatch` resolves.

---

## ColumnSpec Reference

Each column in the spec accepts the following properties, applied in a deterministic order:

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"string"` \| `"number"` \| `"boolean"` \| `"date"` | Coerce value to target type |
| `required` | `boolean` | Reject null/undefined/empty values |
| `trim` | `boolean` | Strip leading/trailing whitespace |
| `case` | `"lower"` \| `"upper"` \| `"title"` | Normalize string casing |
| `pattern` | `string` | Regex pattern validation (fails if value doesn't match) |
| `range` | `[min, max]` | Numeric range bounds (either bound can be `null`) |
| `length` | `[min, max]` | String length bounds (either bound can be `null`) |
| `default` | `any` | Value to use when the field is missing or empty |
| `parse` | `"currency"` | Pre-coercion parsing: strips `$€£¥₹₽₩` symbols, thousand separators, parenthesized negatives |
| `format` | `string` | Post-coercion output formatting (requires `type: "number"` or `type: "date"`) |
| `copyFrom` | `string` | Copy value from another column when this column is empty |
| `derivedFrom` | `object` | Compute value from a template string with `{column_name}` substitutions |
| `fuzzyMatch` | `object` | NER-backed fuzzy matching against a value store category |

### Rule Application Order

Rules are applied to each column in this fixed order:

1. **copyFrom** — fill from another column when empty
2. **derivedFrom** — compute from template
3. **default** — fill missing values
4. **required** — reject empty values (short-circuits on failure)
5. **parse** — pre-coercion parsing (e.g., currency stripping)
6. **type** — coerce to target type
7. **trim** — strip whitespace
8. **case** — normalize casing
9. **format** — output formatting
10. **pattern** — regex validation
11. **range** — numeric range validation
12. **length** — string length validation
13. **fuzzyMatch** — NER fuzzy matching

### Type Coercion Details

**String**: Any value is converted to its string representation.

**Number**: Strings are parsed as float64. Booleans convert to `1`/`0`. Empty strings fail.

**Boolean**: Accepts `true`/`false`, `yes`/`no`, `on`/`off`, `y`/`n`, `t`/`f`, `1`/`0` (case-insensitive). Non-zero numbers are `true`.

**Date**: Parses common date formats and normalizes to RFC3339:
- `2006-01-02T15:04:05Z07:00` (RFC3339)
- `2006-01-02T15:04:05`
- `2006-01-02 15:04:05`
- `2006-01-02`
- `01/02/2006`, `1/2/2006`
- `Jan 2, 2006`, `January 2, 2006`
- `02-Jan-2006`

### Currency Parsing

When `parse: "currency"` is set, the engine strips currency symbols (`$`, `€`, `£`, `¥`, `₹`, `₽`, `₩`), removes thousand separators (commas followed by digits), and handles parenthesized negatives — `(1,234.56)` becomes `-1234.56`. The result is parsed as `float64`.

### Format Strings

For `type: "number"`:
- `"0.00"` → 2 decimal places
- `"0.0"` → 1 decimal place
- `"0"` → integer (rounds)

For `type: "date"`:
- `"YYYY-MM-DD"` → `2006-01-02`
- `"MM/DD/YYYY"` → `01/02/2006`
- `"DD/MM/YYYY"` → `02/01/2006`
- `"RFC3339"` → full RFC3339 timestamp

### DerivedFrom

Computes a column value by substituting `{column_name}` placeholders in a template string:

```json
{
  "full_name": {
    "derivedFrom": {
      "template": "{first_name} {last_name}",
      "columns": ["first_name", "last_name"]
    }
  }
}
```

`derivedFrom` and `copyFrom` are mutually exclusive on the same column.

### FuzzyMatch

Resolves values against a NER value store category using Levenshtein distance:

```json
{
  "category": {
    "fuzzyMatch": {
      "category": "product_categories",
      "threshold": 0.6,
      "column": "name"
    }
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `category` | string | Yes | — | NER value store name |
| `threshold` | number | No | `0.6` | Minimum similarity score (0–1) |
| `column` | string | No | First match column | Which column in the value store to match against |

The resolver queries the NER value store's scratch pad table for candidate values, computes Levenshtein similarity (case-insensitive), and replaces the value with the best match above the threshold. If no match meets the threshold, a validation error is recorded.

---

## API Endpoints

All wrangling endpoints require admin API key authentication via `X-API-Key` header.

### Inline Wrangle

Process rows with an inline spec.

```
POST /admin/wrangle
Content-Type: application/json
```

**Request:**

```json
{
  "spec": {
    "name": "CleanContacts",
    "engine": "single-pass",
    "columns": {
      "name": { "type": "string", "trim": true, "case": "title", "required": true },
      "email": { "type": "string", "trim": true, "case": "lower" }
    }
  },
  "rows": [
    { "name": "  JOHN DOE  ", "email": "  John@Example.COM  " },
    { "name": "", "email": "missing@name.com" }
  ]
}
```

**Response** (`200 OK`):

```json
{
  "rows": [
    {
      "data": { "name": "John Doe", "email": "john@example.com" },
      "errors": [],
      "valid": true
    },
    {
      "data": { "name": "", "email": "missing@name.com" },
      "errors": [{ "column": "name", "rule": "required", "message": "value is required" }],
      "valid": false
    }
  ],
  "total_rows": 2,
  "valid_rows": 1,
  "error_rows": 1,
  "iterations": 1
}
```

### Scratch Pad Wrangle

Read from a scratch pad table, wrangle, and write clean results to a new table.

```
POST /admin/wrangle/scratch/{identity}
Content-Type: application/json
```

**Request:**

```json
{
  "spec": { "name": "CleanVendorData", "columns": { ... } },
  "source_table": "raw_vendor_upload",
  "output_table": "clean_vendor_data"
}
```

If `output_table` is omitted, it defaults to `{source_table}_wrangled`.

Only valid rows (no errors) are written to the output table.

**Response** (`200 OK`):

```json
{
  "spec": "CleanVendorData",
  "identity": "user:alice",
  "source_table": "raw_vendor_upload",
  "output_table": "clean_vendor_data",
  "total_rows": 100,
  "valid_rows": 95,
  "error_rows": 5,
  "errors": [
    { "row": 3, "column": "email", "rule": "pattern", "message": "value does not match pattern ...", "value": "bad-email" }
  ]
}
```

### CSV Upload + Wrangle

Upload a CSV file and wrangle it in one step. Supports three spec resolution modes.

```
POST /admin/wrangle/csv
Content-Type: multipart/form-data
```

**Form fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `file` | Yes | CSV file upload |
| `spec` | One of three | Inline JSON WrangleSpec |
| `spec_id` | One of three | ID of a stored spec |
| `template` | One of three | ID of a built-in template |
| `identity` | No | Scratch pad identity to save results |
| `output_table` | No | Table name for scratch pad output (default: `"wrangled"`) |

Exactly one of `spec`, `spec_id`, or `template` must be provided.

**Example with CLI:**

```bash
# Using a built-in template
curl -X POST http://localhost:8080/admin/wrangle/csv \
  -H "x-api-key: $API_KEY" \
  -F file=@contacts.csv \
  -F template=contacts

# Using a stored spec, saving to scratch pad
curl -X POST http://localhost:8080/admin/wrangle/csv \
  -H "x-api-key: $API_KEY" \
  -F file=@vendor_catalog.csv \
  -F spec_id=vendor-cleanup \
  -F identity=user:alice \
  -F output_table=clean_catalog
```

If `identity` is provided, valid rows are saved to the scratch pad and the response includes `identity` and `output_table`. If `identity` is omitted, the full `WrangleResult` (all rows with data and errors) is returned inline.

---

## Spec Storage

Specs can be persisted in a dedicated SQLite database (`_wrangle_specs.db`) for reuse across requests.

### List Specs

```
GET /admin/wrangle/specs
```

**Response:**

```json
{
  "specs": [
    {
      "id": "vendor-cleanup",
      "name": "Vendor Catalog Cleanup",
      "columns": 8,
      "engine": "single-pass",
      "created_at": "2026-03-10T14:30:00Z",
      "updated_at": "2026-03-12T09:15:00Z"
    }
  ],
  "count": 1,
  "templates": ["address-normalize", "contacts", "financial-transactions", "product-inventory"]
}
```

The response includes both stored spec summaries and available built-in template IDs.

### Save Spec

```
POST /admin/wrangle/specs
Content-Type: application/json
```

**Request:**

```json
{
  "id": "vendor-cleanup",
  "spec": {
    "name": "Vendor Catalog Cleanup",
    "engine": "single-pass",
    "columns": {
      "sku": { "type": "string", "trim": true, "case": "upper", "required": true },
      "name": { "type": "string", "trim": true, "case": "title" }
    }
  }
}
```

IDs that conflict with built-in template names are rejected (409 Conflict). Saving with an existing ID updates the spec (upsert).

**Response** (`201 Created`):

```json
{ "id": "vendor-cleanup", "name": "Vendor Catalog Cleanup", "columns": 2 }
```

### Get Spec

```
GET /admin/wrangle/specs/{id}
```

**Response** (`200 OK`):

```json
{
  "id": "vendor-cleanup",
  "spec": { "name": "Vendor Catalog Cleanup", "engine": "single-pass", "columns": { ... } },
  "created_at": "2026-03-10T14:30:00Z",
  "updated_at": "2026-03-12T09:15:00Z"
}
```

### Delete Spec

```
DELETE /admin/wrangle/specs/{id}
```

**Response** (`200 OK`):

```json
{ "deleted": "vendor-cleanup" }
```

---

## Built-in Templates

Four built-in templates cover common data cleaning patterns. Use them directly via `template` in the CSV wrangle endpoint, or retrieve them as starting points for custom specs.

### List Templates

```
GET /admin/wrangle/templates
```

### Get Template

```
GET /admin/wrangle/templates/{id}
```

### Available Templates

#### `contacts`

Name/email/phone normalization for contact lists.

| Column | Type | Rules |
|--------|------|-------|
| `first_name` | string | trim, title case, required |
| `last_name` | string | trim, title case, required |
| `email` | string | trim, lowercase, email pattern validation |
| `phone` | string | trim, phone character pattern validation |
| `company` | string | trim |
| `title` | string | trim, title case |

#### `financial-transactions`

Date formatting, currency parsing, and amount validation for financial data.

| Column | Type | Rules |
|--------|------|-------|
| `date` | date | required, format: YYYY-MM-DD |
| `description` | string | trim, required |
| `amount` | number | required, parse: currency, format: 0.00 |
| `currency` | string | trim, uppercase, default: USD, length: 3 |
| `category` | string | trim, title case |
| `reference` | string | trim |
| `account_number` | string | trim, length: 4–34 |
| `balance` | number | parse: currency, format: 0.00, range: ≥ 0 |

#### `product-inventory`

SKU normalization, quantity/price validation for inventory data.

| Column | Type | Rules |
|--------|------|-------|
| `sku` | string | trim, uppercase, required |
| `product_name` | string | trim, title case, required |
| `category` | string | trim, title case |
| `quantity` | number | required, range: ≥ 0 |
| `unit_price` | number | required, parse: currency, format: 0.00, range: ≥ 0.01 |
| `supplier` | string | trim |
| `location` | string | trim, uppercase |
| `status` | string | trim, lowercase, default: active |

#### `address-normalize`

Street/city title case, state uppercase, ZIP pattern validation for US addresses.

| Column | Type | Rules |
|--------|------|-------|
| `street` | string | trim, title case, required |
| `city` | string | trim, title case, required |
| `state` | string | trim, uppercase, length: 2 |
| `postal_code` | string | trim, required, pattern: `^\d{5}(-\d{4})?$` |
| `country` | string | trim, uppercase, default: US, length: 2–3 |

---

## Pipeline Pattern

A typical wrangling pipeline through DAS:

```
Source DB ──→ DAS Query ──→ Scratch Pad (raw) ──→ Wrangle ──→ Scratch Pad (clean)
                                                     │
CSV Upload ─────────────────────────────────────────→ │
```

### Example: Upload, Wrangle, Query

```bash
# 1. Upload a messy CSV to scratch pad
ff-da upload -i user:analyst -t raw_vendors -f vendors.csv

# 2. Wrangle using a stored spec, output to clean table
curl -X POST http://localhost:8080/admin/wrangle/scratch/user:analyst \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "spec": { "name": "VendorCleanup", "engine": "single-pass", "columns": { ... } },
    "source_table": "raw_vendors",
    "output_table": "clean_vendors"
  }'

# 3. Query the clean data
ff-da query -c scratch:user:analyst -s "SELECT * FROM clean_vendors WHERE category = 'Electronics'"
```

### Example: CSV Upload + Wrangle in One Step

```bash
# Upload CSV with built-in template, save to scratch pad
curl -X POST http://localhost:8080/admin/wrangle/csv \
  -H "x-api-key: $API_KEY" \
  -F file=@transactions.csv \
  -F template=financial-transactions \
  -F identity=user:analyst \
  -F output_table=clean_transactions
```

---

## Error Handling

The wrangling engine collects errors per-row and per-column. A row with any error is marked `valid: false`. Invalid rows are excluded from scratch pad output but still appear in the inline response.

Each error includes:

| Field | Description |
|-------|-------------|
| `column` | Column name where the error occurred |
| `rule` | Rule that failed: `required`, `type`, `parse`, `pattern`, `range`, `length`, `format`, `fuzzyMatch` |
| `message` | Human-readable error description |
| `value` | The original value that failed (when applicable) |

A `required` failure short-circuits — no further rules are checked for that column on that row.

---

## Related

- [Data Access Service Overview](./README.md)
- [Validation Library (TypeScript)](../../sdk/utils/validation/)
- [Catalog Intake Part 12: Data Wrangling](../../sdk/agent_sdk/tutorials/catalog-intake/part-12-data-wrangling.md)
- [NER Value Resolution](./firekicks/06-value-resolution.md)
- [CSV Upload](./firekicks/07-csv-upload.md)
