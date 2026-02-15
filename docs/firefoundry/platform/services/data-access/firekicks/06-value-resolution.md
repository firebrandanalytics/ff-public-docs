# Part 6: Named Entity Resolution

When an AI agent encounters "Microsoft" in a user's question, the ontology (Part 3) resolves the *type* — is it a Vendor, Customer, or Bank? Named Entity Resolution (NER) resolves the *value* — matching "Microsoft" to the actual database row "MICROSOFT CORPORATION" despite spelling variations, abbreviations, and naming differences.

This part covers the value resolution system: value stores, fuzzy matching strategies, personalized scopes, and the learning loop that improves matching accuracy over time.

## The Problem

Database values are messy. Users say "Nike" but the database has "NIKE, INC." Users say "Microsft" (typo) but the database has "MICROSOFT CORP." Users say "MSFT" but the database has "MICROSOFT SERVICES LLC." Exact string matching fails in all these cases.

AI agents need fuzzy matching with ranked candidates:
- **Spelling variations** — "Adidas" vs "ADIDAS AG" vs "adidas Group"
- **Abbreviations** — "MSFT" vs "Microsoft Corporation"
- **Typos** — "Microsft" vs "Microsoft"
- **Partial names** — "Nike" vs "NIKE, INC."
- **Synonyms** — "AWS" vs "Amazon Web Services" vs "AMAZON.COM INC"

Named Entity Resolution provides a fuzzy matching engine that returns ranked candidates with confidence scores, letting the agent pick the best match or ask the user for clarification when ambiguous.

## Value Store Architecture

A value store is a searchable index of canonical values from a source database. The Data Access Service uses a two-table pattern:

### Value Table

The **value table** contains canonical rows from the source database. For a vendor value store querying `product_suppliers`, the value table might contain:

| rowid | supplier_id | supplier_name | country | lead_time_days |
|-------|-------------|---------------|---------|----------------|
| 1 | 101 | NIKE, INC. | USA | 45 |
| 2 | 102 | ADIDAS AG | Germany | 60 |
| 3 | 103 | PUMA SE | Germany | 55 |
| 4 | 104 | NEW BALANCE ATHLETICS | USA | 30 |

The value table is a snapshot of the source data, stored in the **scratch pad** (SQLite). It's refreshed on demand or on schedule.

### Search Table

The **search table** unpivots all matchable terms from the value table and adds fuzzy matching metadata:

| search_term | value_rowid | source_column | scope |
|-------------|-------------|---------------|-------|
| NIKE, INC. | 1 | supplier_name | primary |
| ADIDAS AG | 2 | supplier_name | primary |
| PUMA SE | 3 | supplier_name | primary |
| NEW BALANCE ATHLETICS | 4 | supplier_name | primary |
| MSFT | 1 | learned | user:bob |
| adidas | 2 | learned | system |

The `scope` column enables personalization:
- **primary**: Original values from the source database
- **system**: Learned synonyms promoted by consensus (3+ users confirmed)
- **user:X**: Personal synonyms for user X
- **team:X**: Team-level synonyms for team X

The search table is backed by an FTS5 (Full-Text Search) index for fast pre-filtering, with fuzzy scoring computed in a second pass.

### Data Storage Location

**Important:** Value data NEVER goes to PostgreSQL. Only value store *configurations* are saved to PostgreSQL (name, description, source query, schedule). The actual data — both the value table and search table — live in the **system scratch pad** (a SQLite database).

This keeps operational data separate from configuration and prevents the service's backend database from becoming a data warehouse.

## Create a Value Store

Value stores are created via the admin API. Let's create a store for FireKicks vendors:

> **Note:** Set up these variables for the examples:
> ```bash
> export DA_URL=http://localhost:8080
> export API_KEY=dev-api-key
> export IDENTITY=user:tutorial
> ```

```bash
curl -s -X POST "$DA_URL/admin/value-stores" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "vendors",
    "description": "Vendor name resolution for supply chain queries",
    "domain": "product",
    "entity_types": ["Vendor"],
    "connection": "firekicks",
    "source_query": "SELECT supplier_id, supplier_name, country, lead_time_days FROM product_suppliers",
    "match_columns": ["supplier_name"],
    "schedule": ""
  }' | jq
```

Response:
```json
{
  "name": "vendors",
  "description": "Vendor name resolution for supply chain queries",
  "domain": "product",
  "entity_types": ["Vendor"],
  "connection": "firekicks",
  "source_query": "SELECT supplier_id, supplier_name, country, lead_time_days FROM product_suppliers",
  "match_columns": ["supplier_name"],
  "schedule": "",
  "created_at": "2026-02-15T10:30:00Z",
  "updated_at": "2026-02-15T10:30:00Z"
}
```

### Configuration Fields

| Field | Type | Purpose |
|-------|------|---------|
| `name` | Text | Unique identifier for the value store (alphanumeric + underscore only) |
| `description` | Text | Human-readable description of what this store resolves |
| `domain` | Text | Business domain (ties to ontology domains) |
| `entity_types` | Text[] | Which entity types this store serves (ties to ontology) |
| `connection` | Text | Source database connection name |
| `source_query` | Text | SQL query to pull canonical values from the source database |
| `match_columns` | Text[] | Which columns from the query results to use for fuzzy matching |
| `schedule` | Text | Refresh schedule (e.g., `"daily:07:00"`) or empty for manual-only |

The `entity_types` field connects the value store to the ontology. When resolving values, the service uses the `entity_types` filter to search only relevant stores.

### List Value Stores

```bash
curl -s "$DA_URL/admin/value-stores" \
  -H "X-API-Key: $API_KEY" | jq
```

### Get a Specific Store

```bash
curl -s "$DA_URL/admin/value-stores/vendors" \
  -H "X-API-Key: $API_KEY" | jq
```

### Update a Value Store

```bash
curl -s -X PUT "$DA_URL/admin/value-stores/vendors" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description",
    "match_columns": ["supplier_name", "country"],
    "schedule": "daily:07:00"
  }' | jq
```

### Delete a Value Store

```bash
curl -s -X DELETE "$DA_URL/admin/value-stores/vendors" \
  -H "X-API-Key: $API_KEY"
```

This deletes both the configuration and the data tables in the scratch pad.

## Refresh (Populate)

Creating a value store config doesn't populate data. You must trigger a **refresh** to run the source query and build the value/search tables.

### Manual Refresh

```bash
curl -s -X POST "$DA_URL/admin/value-stores/vendors/refresh" \
  -H "X-API-Key: $API_KEY" | jq
```

Response:
```json
{
  "store_name": "vendors",
  "rows_loaded": 47,
  "search_terms_created": 47,
  "started_at": "2026-02-15T10:35:00Z",
  "completed_at": "2026-02-15T10:35:02Z"
}
```

### What Happens During Refresh

1. **Execute source query**: The service runs `source_query` against the `connection` database
2. **Create value table**: Results are stored in the scratch pad as `{name}_values` (e.g., `vendors_values`)
3. **Unpivot match columns**: For each row and each column in `match_columns`, a search term is created
4. **Build search table**: All terms are inserted into `{name}_search` with `scope=primary` and `source_column` metadata
5. **Create FTS5 index**: An FTS5 table `{name}_fts` is created for fast pre-filtering

If the value store already has data, refresh **replaces** it (drops and recreates the tables). This ensures the value store stays in sync with the source database.

### Scheduled Refresh

If `schedule` is set (e.g., `"daily:07:00"`), the service will automatically refresh the value store at the specified time. The schedule format is `{frequency}:{time}` where:
- `frequency`: `daily`, `weekly`, `monthly`
- `time`: 24-hour format like `07:00`

This keeps value stores synchronized with source databases without manual intervention.

## Resolve Values

The `/v1/resolve-values` endpoint performs bulk Named Entity Resolution. It accepts multiple queries and returns ranked candidates for each term.

```bash
curl -s -X POST "$DA_URL/v1/resolve-values" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      {"term": "Nike", "entity_types": ["Vendor"]},
      {"term": "Adids", "entity_types": ["Vendor"]},
      {"term": "MSFT", "entity_types": ["Vendor"]}
    ],
    "max_candidates": 5,
    "min_score": 0.3
  }' | jq
```

### Request Fields

| Field | Type | Purpose |
|-------|------|---------|
| `domain` | Text | Optional domain filter (searches only stores with matching domain) |
| `queries` | Array | List of terms to resolve |
| `queries[].term` | Text | The value to match (e.g., "Nike", "MSFT") |
| `queries[].entity_types` | Text[] | Entity types to search (filters to stores with matching types) |
| `queries[].exclude_values` | Text[] | Optional: exclude specific canonical values from results |
| `max_candidates` | Integer | Maximum candidates to return per query (default: 10) |
| `min_score` | Float | Minimum fuzzy match score (0-1 scale, default: 0.1) |

### Response Structure

```json
{
  "results": [
    {
      "term": "Nike",
      "by_entity_type": {
        "Vendor": {
          "candidates": [
            {
              "row": {
                "supplier_id": 101,
                "supplier_name": "NIKE, INC.",
                "country": "USA",
                "lead_time_days": 45
              },
              "matched_term": "NIKE, INC.",
              "matched_column": "supplier_name",
              "score": 0.95,
              "strategy": "prefix",
              "source": "primary"
            }
          ]
        }
      }
    },
    {
      "term": "Adids",
      "by_entity_type": {
        "Vendor": {
          "candidates": [
            {
              "row": {
                "supplier_id": 102,
                "supplier_name": "ADIDAS AG",
                "country": "Germany",
                "lead_time_days": 60
              },
              "matched_term": "ADIDAS AG",
              "matched_column": "supplier_name",
              "score": 0.82,
              "strategy": "levenshtein",
              "source": "primary"
            }
          ]
        }
      }
    },
    {
      "term": "MSFT",
      "by_entity_type": {
        "Vendor": {
          "candidates": []
        }
      }
    }
  ]
}
```

### Candidate Fields

Each candidate contains:
- **row**: The complete value row from the value table (all columns from source query)
- **matched_term**: Which search term matched (e.g., "NIKE, INC." or a learned synonym)
- **matched_column**: Which column the term came from (e.g., "supplier_name", "dba_name")
- **score**: Fuzzy match confidence (0-1 scale)
- **strategy**: Which matching strategy produced the highest score (see Matching Strategies below)
- **source**: The scope of the matched term ("primary", "system", "user:bob", "team:finance")

The `row` field contains the full database row, so the agent has all context needed to build queries — not just the matched name, but also IDs, categories, and other attributes.

## Matching Strategies

The fuzzy matcher uses six strategies with different weights. For each candidate, all strategies compute a score, and the best strategy is reported along with a composite score.

| Strategy | Weight | Description | Example |
|----------|--------|-------------|---------|
| `prefix` | 500 | One string is a prefix of the other | "Nike" matches "NIKE, INC." |
| `levenshtein` | 400 | Edit distance within 40% of string length | "Adids" matches "ADIDAS" (1 edit, 16% distance) |
| `initials` | 400 | Position-weighted initials matching | "NB" matches "New Balance" |
| `reverse_initials` | 300 | Acronym detection | "MSFT" matches "Microsoft Corporation" |
| `words` | 200 | Jaccard similarity on word sets | "New Balance Athletics" matches "New Balance" |
| `phonetics` | 100 | Phonetic code similarity | "Microsft" matches "Microsoft" (same phonetics) |

### How the Composite Score Works

Each strategy produces a weighted score. The final score is a normalized composite:
1. **Best strategy dominance**: The highest-scoring strategy contributes most of the weight
2. **Multi-signal bonus**: Other matching strategies add a small bonus
3. **Normalization**: Final score is 0-1 scale

This means a strong prefix match (e.g., "Nike" → "NIKE, INC.") scores higher than a weak multi-strategy match (several low signals).

### Matching Implementation

All matching functions are implemented as SQLite custom functions registered at startup:
- `ff_match_score(candidate, input)` — composite score + strategy
- `ff_levenshtein(a, b)` — edit distance
- `ff_prefix_score(input, candidate)` — prefix match score
- `ff_initials(s)` — extract initials from string
- `ff_phonetic(s)` — generate phonetic code
- `ff_word_jaccard(a, b)` — word set Jaccard similarity

This allows the resolution query to compute fuzzy scores entirely in SQL, avoiding round-trip latency.

## The Learning Loop

When an AI agent resolves a value and the user confirms the match, the system records the term as a **learned synonym**. Future resolutions will use the learned term, improving accuracy over time.

### Confirm a Match

```bash
curl -s -X POST "$DA_URL/v1/confirm-match" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:bob" \
  -H "Content-Type: application/json" \
  -d '{
    "term": "MSFT",
    "value_row_id": 1,
    "store_name": "vendors",
    "scope": "user:bob"
  }' | jq
```

Response:
```json
{
  "status": "confirmed"
}
```

### Request Fields

| Field | Type | Purpose |
|-------|------|---------|
| `term` | Text | The user's input term (e.g., "MSFT") |
| `value_row_id` | Integer | The rowid of the matched value row |
| `store_name` | Text | Which value store this applies to |
| `scope` | Text | The scope for this synonym (see Scope Rules below) |

### Scope Rules

The `scope` field determines who can see the learned synonym:

| Scope | Visibility | How to Set |
|-------|-----------|-----------|
| `user:X` | Only user X sees it | Caller sets `scope: "user:X"` or omits (defaults to caller identity) |
| `team:X` | All members of team X see it | Caller sets `scope: "team:X"` |
| `system` | Everyone sees it | **Cannot be set directly** — must be earned via promotion |
| `primary` | Original source data | **Cannot be set directly** — comes from refresh |

**Important restrictions:**
- You **cannot** set `scope: "system"` or `scope: "primary"` directly via `/v1/confirm-match`
- `scope` must start with `user:` or `team:`
- If omitted, the service derives `scope` from `X-On-Behalf-Of` as `user:{identity}`

### Automatic Promotion

When **3 or more distinct users** confirm the same term→value mapping, the system automatically promotes it to **system scope**. This makes the synonym visible to all users.

For example:
1. User Alice confirms `"MSFT" → rowid 1` with `scope: "user:alice"`
2. User Bob confirms `"MSFT" → rowid 1` with `scope: "user:bob"`
3. User Carol confirms `"MSFT" → rowid 1` with `scope: "user:carol"`
4. **System auto-promotes**: A new row is inserted with `scope: "system"`

Now all users see "MSFT" as a synonym for the vendor at rowid 1, even if they haven't personally confirmed it.

The promotion threshold (3 users) is a constant in the code (`DefaultPromotionThreshold`). It can be changed by modifying the service configuration.

### Idempotency

Confirming the same `(term, value_row_id, scope)` tuple multiple times is idempotent — the service checks if the row already exists and returns success without inserting a duplicate.

## Personalized Scopes

Scopes enable different users to have different synonyms for the same value store. This is useful when abbreviations or nicknames are context-dependent.

### Example: Same Abbreviation, Different Vendors

User Bob works with Microsoft frequently and uses "MS" as shorthand:
```bash
curl -s -X POST "$DA_URL/v1/confirm-match" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:bob" \
  -H "Content-Type: application/json" \
  -d '{
    "term": "MS",
    "value_row_id": 1,
    "store_name": "vendors",
    "scope": "user:bob"
  }'
```

User Alice works with Morgan Stanley and uses "MS" for them:
```bash
curl -s -X POST "$DA_URL/v1/confirm-match" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:alice" \
  -H "Content-Type: application/json" \
  -d '{
    "term": "MS",
    "value_row_id": 47,
    "store_name": "vendors",
    "scope": "user:alice"
  }'
```

Now when resolving "MS":
- Bob sees Microsoft (rowid 1) ranked highest
- Alice sees Morgan Stanley (rowid 47) ranked highest

### Scope Hierarchy

The resolution query searches scopes in priority order:
1. **user:{caller}**: Personal synonyms for the current user
2. **team:{caller's teams}**: Team-level synonyms (if the identity includes team membership)
3. **system**: Promoted synonyms (consensus across multiple users)
4. **primary**: Original values from the source database

Higher-priority scopes are searched first. If a term matches a user-scoped synonym, that match is ranked higher than a system or primary match, even if the fuzzy score is lower. This ensures personalized synonyms take precedence.

### Multi-Scope Identities

The `X-On-Behalf-Of` header supports comma-separated scopes to represent a user's full membership context:

```
X-On-Behalf-Of: user:bob,team:finance,team:sales
```

The resolution query will search all three scopes (`user:bob`, `team:finance`, `team:sales`) plus `system` and `primary`.

## Agent Workflow

Here's how an AI agent uses Named Entity Resolution end-to-end:

### Step 1: User asks a question

**User:** "Show me sales for Nike and Adidas this quarter."

### Step 2: Resolve entity types

The agent queries the ontology (see [Part 3](./03-ontology.md)) to determine that "Nike" and "Adidas" are Vendors, not Customers or Banks.

```bash
# Ontology tells agent: "Nike" → Vendor entity type
```

### Step 3: Resolve values via NER

```bash
curl -s -X POST "$DA_URL/v1/resolve-values" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      {"term": "Nike", "entity_types": ["Vendor"]},
      {"term": "Adidas", "entity_types": ["Vendor"]}
    ],
    "max_candidates": 3,
    "min_score": 0.5
  }' | jq
```

Response shows:
- "Nike" → `supplier_name: "NIKE, INC."` (score: 0.95, supplier_id: 101)
- "Adidas" → `supplier_name: "ADIDAS AG"` (score: 0.93, supplier_id: 102)

### Step 4: Build query with resolved values

The agent now knows the canonical database values and can build an accurate AST query:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "supplier_name" } } },
      {
        "expr": { "function": { "name": "round", "args": [
          { "cast": { "expr": { "function": { "name": "sum", "args": [{
            "binary": { "op": "BINARY_OP_MUL",
              "left": { "column": { "column": "quantity" } },
              "right": { "column": { "column": "unit_price" } }
            }
          }] } }, "typeName": "numeric" } },
          { "literal": { "numberValue": 2 } }
        ] } },
        "alias": "sales"
      }
    ],
    "from": { "table": { "table": "order_items" } },
    "joins": [{
      "type": "JOIN_INNER",
      "table": { "table": "products" },
      "on": { "binary": { "op": "BINARY_OP_EQ",
        "left": { "column": { "table": "order_items", "column": "product_id" } },
        "right": { "column": { "table": "products", "column": "product_id" } }
      } }
    }, {
      "type": "JOIN_INNER",
      "table": { "table": "product_suppliers" },
      "on": { "binary": { "op": "BINARY_OP_EQ",
        "left": { "column": { "table": "products", "column": "supplier_id" } },
        "right": { "column": { "table": "product_suppliers", "column": "supplier_id" } }
      } }
    }],
    "where": {
      "in": {
        "expr": { "column": { "table": "product_suppliers", "column": "supplier_id" } },
        "values": [
          { "literal": { "numberValue": 101 } },
          { "literal": { "numberValue": 102 } }
        ]
      }
    },
    "groupBy": [{ "expr": { "column": { "column": "supplier_name" } } }]
  }
}
```

The agent used the resolved `supplier_id` values (101, 102) to filter — not fragile string matching on supplier names.

### Step 5: Optional — Confirm matches

If the agent uses these matches in a final report, it can confirm them to improve future resolutions:

```bash
curl -s -X POST "$DA_URL/v1/confirm-match" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"term": "Nike", "value_row_id": 1, "store_name": "vendors"}'

curl -s -X POST "$DA_URL/v1/confirm-match" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -d '{"term": "Adidas", "value_row_id": 2, "store_name": "vendors"}'
```

Next time the user says "Nike," the agent will see a learned synonym in addition to the fuzzy match, improving confidence.

## Combining with Ontology

Named Entity Resolution complements the ontology (see [Part 3](./03-ontology.md)). The ontology resolves *types*, and NER resolves *values*:

| Layer | Resolves | Example |
|-------|----------|---------|
| Ontology | Entity types and concepts | "Nike" → Vendor entity type, "revenue" → calculation rule |
| NER | Canonical values from data | "Nike" → `supplier_name: "NIKE, INC."`, `supplier_id: 101` |

The ontology's `entity_types` field maps to value stores via the `entity_types` configuration:
- Ontology says: `"Nike"` → `Vendor` entity type
- NER searches: value stores where `entity_types` contains `"Vendor"`
- NER returns: canonical row from `vendors` value store

When the agent includes `domain` in the resolve request, only value stores matching that domain are searched, narrowing the search space and improving accuracy.

### Example Integration

1. **User asks:** "Show me purchases from Microsoft this year."
2. **Ontology resolution:** "Microsoft" → `Vendor` entity type in `finance` domain
3. **NER resolution:** Search `domain: "finance"`, `entity_types: ["Vendor"]` → finds `vendors` value store
4. **Fuzzy match:** "Microsoft" matches `"MICROSOFT CORP"` (score: 0.97, supplier_id: 42)
5. **Query generation:** Agent builds AST with `WHERE supplier_id = 42`

The ontology provides semantic understanding (what is Microsoft?), and NER provides data grounding (which database row is Microsoft?).

## Advanced: Multiple Match Columns

A value store can match on multiple columns. For example, if vendors have both an official name and a "doing business as" (DBA) name:

```bash
curl -s -X POST "$DA_URL/admin/value-stores" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "vendors",
    "domain": "finance",
    "entity_types": ["Vendor"],
    "connection": "firekicks",
    "source_query": "SELECT supplier_id, supplier_name, dba_name, country FROM product_suppliers",
    "match_columns": ["supplier_name", "dba_name"]
  }'
```

After refresh, the search table contains terms from both columns:

| search_term | value_rowid | source_column | scope |
|-------------|-------------|---------------|-------|
| NIKE, INC. | 1 | supplier_name | primary |
| JUST DO IT LLC | 1 | dba_name | primary |
| ADIDAS AG | 2 | supplier_name | primary |
| THREE STRIPES GMBH | 2 | dba_name | primary |

Now resolving "JUST DO IT LLC" matches rowid 1 (Nike), and the `matched_column` field indicates it came from `dba_name`.

This is useful when entities have multiple names, codes, or identifiers that users might reference.

## Advanced: Excluding Values

Sometimes an agent wants to exclude specific values from results (e.g., after the user rejects a candidate). Use `exclude_values`:

```bash
curl -s -X POST "$DA_URL/v1/resolve-values" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: $IDENTITY" \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      {
        "term": "MS",
        "entity_types": ["Vendor"],
        "exclude_values": ["MORGAN STANLEY"]
      }
    ],
    "max_candidates": 5
  }'
```

The resolution query will skip any rows where the matched search term is "MORGAN STANLEY." This is useful in conversational workflows where the agent iterates with the user to disambiguate.

## Troubleshooting

### No Candidates Returned

**Symptom:** Resolve request returns empty `candidates` array.

**Possible causes:**
1. **Value store not refreshed** — Run `/admin/value-stores/{name}/refresh`
2. **Entity type mismatch** — Check that `entity_types` in the request matches the value store config
3. **Min score too high** — Lower `min_score` (try 0.1 or 0.2)
4. **Term too different from values** — Try a more complete term or check for typos

### Low Match Scores

**Symptom:** Candidates returned but scores are below 0.5.

**Possible causes:**
1. **Short terms** — Single-letter abbreviations don't match well; confirm them to build learned synonyms
2. **Multiple word differences** — "New Balance" vs "New Balance Athletics Inc" may score lower than expected
3. **Strategy mismatch** — Check the `strategy` field; if it's `phonetics` or `words`, consider confirming the match to promote it

**Solution:** Use the learning loop. Confirm low-scoring matches that are correct, and the agent will rank them higher in the future.

### Multiple Users, No Promotion

**Symptom:** 3+ users confirmed a term, but it's not promoted to `system` scope.

**Possible causes:**
1. **Different value_row_id** — Users must confirm the **same** term→value mapping (same rowid)
2. **Scope is team, not user** — Promotion counts distinct `user:` scopes only, not `team:` scopes
3. **Threshold not met** — Check logs for promotion messages; threshold is 3 by default

**Solution:** Verify all users confirmed the same `value_row_id`. Check the `vendors_search` table in the scratch pad to see current scopes.

## Performance Considerations

### Pre-filtering with FTS5

The resolution query uses FTS5 (Full-Text Search) for fast pre-filtering before computing fuzzy scores. This keeps resolution fast even with thousands of values.

The query flow:
1. **FTS5 MATCH**: Find all terms that contain any word from the input (fast, indexed)
2. **Fuzzy scoring**: Compute `ff_match_score()` for pre-filtered candidates (CPU-intensive but small set)
3. **Ranking**: Sort by score, apply `min_score` threshold, limit to `max_candidates`

This means resolution scales well up to ~100K values per store. Beyond that, consider partitioning value stores by domain or entity subtype.

### Bulk Resolution

Always batch multiple terms into a single request when possible. Sending 10 terms in one request is faster than 10 sequential requests because:
- Single scratch pad connection
- Single FTS5 index access
- Reduced HTTP round-trip overhead

The service supports up to 1000 queries per request.

### Refresh Duration

Refresh time depends on:
- Source query execution time (reading from the source database)
- Number of rows returned
- Number of match columns (more columns = more search terms)

For large value stores (10K+ rows), consider:
- Indexing the source table's columns used in the query
- Running refresh during off-peak hours
- Using scheduled refresh (not blocking requests)

## Next Steps

You've completed the value resolution system. Here's what to explore next:

- **[Part 5: Querying](./05-querying.md)** — See how agents build queries using resolved values
- **[Reference](../reference.md)** — Full API specification for value store and resolution endpoints
- **[Part 7: CSV Upload](#)** — *(Coming soon)* Bulk-load value stores from CSV files

The combination of ontology (type resolution) and NER (value resolution) gives AI agents semantic understanding of both concepts and data, enabling accurate natural-language-to-SQL translation even with messy real-world databases.
