# Part 7: CSV Upload & Ad-Hoc Data

Sometimes the data you need isn't in a database — it's in a spreadsheet, an export, or a CSV file. The Data Access Service lets you upload CSV files directly into scratch pads, making them instantly queryable alongside your database data. This enables ad-hoc analysis workflows where external data is joined with live database queries.

## Upload a CSV File

The Data Access Service provides an admin endpoint for uploading CSV files directly into scratch pads:

```
POST /admin/scratch/{identity}/upload?table={name}
Content-Type: multipart/form-data
```

Let's walk through uploading a sample CSV file containing regional sales targets:

```bash
# Create a sample CSV for demonstration
cat > /tmp/regional_targets.csv << 'EOF'
region,q4_target,q4_actual,variance_pct
Northeast,2500000,2750000,10.0
Southeast,1800000,1650000,-8.3
Midwest,2000000,2100000,5.0
West,3000000,3200000,6.7
Pacific,1200000,1150000,-4.2
EOF

# Upload to your scratch pad
curl -s -X POST "$DA_URL/admin/scratch/user:tutorial/upload?table=regional_targets" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@/tmp/regional_targets.csv"
```

The service responds with metadata about the upload:

```json
{
  "identity": "user:tutorial",
  "table": "regional_targets",
  "rows": 5,
  "columns": ["region", "q4_target", "q4_actual", "variance_pct"],
  "truncated": false,
  "filename": "regional_targets.csv"
}
```

The CSV is now loaded into the `regional_targets` table in your scratch pad, ready to query.

## Query Uploaded Data

Once uploaded, the CSV data is available in your scratch pad just like any other table. Query it using the `scratch:user:tutorial` connection:

```bash
curl -s -X POST "$DA_URL/v1/connections/scratch:user:tutorial/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:tutorial" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [{"expr": {"star": {}}}],
      "from": {"table": {"table": "regional_targets"}},
      "orderBy": [{"expr": {"column": {"column": "variance_pct"}}, "dir": "SORT_DESC"}]
    }
  }' | jq
```

Response:

```json
{
  "columns": ["region", "q4_target", "q4_actual", "variance_pct"],
  "rows": [
    ["Northeast", "2500000", "2750000", "10.0"],
    ["West", "3000000", "3200000", "6.7"],
    ["Midwest", "2000000", "2100000", "5.0"],
    ["Pacific", "1200000", "1150000", "-4.2"],
    ["Southeast", "1800000", "1650000", "-8.3"]
  ],
  "rowCount": 5
}
```

The uploaded CSV is now just another queryable table in your scratch pad.

## Join Uploaded Data with Database Queries

The real power of CSV uploads comes from combining them with live database data. Using staged queries, you can pull data from your database, then join it with uploaded CSV data in the scratch pad.

Let's create a mapping table for regional sales analysis:

```bash
# Upload a region mapping CSV
cat > /tmp/region_mapping.csv << 'EOF'
state,region
CA,West
OR,West
WA,Pacific
NY,Northeast
MA,Northeast
FL,Southeast
GA,Southeast
IL,Midwest
OH,Midwest
EOF

curl -s -X POST "$DA_URL/admin/scratch/user:tutorial/upload?table=region_mapping" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@/tmp/region_mapping.csv" | jq
```

Now use a staged query to pull sales by state from FireKicks, then join with your region mapping:

```bash
curl -s -X POST "$DA_URL/v1/connections/scratch:user:tutorial/staged-query" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:tutorial" \
  -H "Content-Type: application/json" \
  -d '{
    "stages": [
      {
        "name": "state_sales",
        "connection": "firekicks",
        "query": {
          "select": {
            "columns": [
              {"expr": {"column": {"column": "state"}}, "alias": "state"},
              {"expr": {"fn": {"name": "SUM", "args": [{"column": {"table": "orders", "column": "total_amount"}}]}}, "alias": "total_sales"}
            ],
            "from": {"table": {"table": "orders"}},
            "groupBy": [{"column": {"column": "state"}}]
          }
        }
      },
      {
        "name": "regional_rollup",
        "query": {
          "select": {
            "columns": [
              {"expr": {"column": {"table": "rm", "column": "region"}}, "alias": "region"},
              {"expr": {"fn": {"name": "SUM", "args": [{"column": {"table": "ss", "column": "total_sales"}}]}}, "alias": "actual_sales"},
              {"expr": {"fn": {"name": "COUNT", "args": [{"column": {"table": "ss", "column": "state"}}]}}, "alias": "states"}
            ],
            "from": {
              "join": {
                "left": {"table": {"table": "state_sales", "alias": "ss"}},
                "right": {"table": {"table": "region_mapping", "alias": "rm"}},
                "on": {
                  "eq": {
                    "left": {"column": {"table": "ss", "column": "state"}},
                    "right": {"column": {"table": "rm", "column": "state"}}
                  }
                }
              }
            },
            "groupBy": [{"column": {"table": "rm", "column": "region"}}],
            "orderBy": [{"expr": {"column": {"column": "actual_sales"}}, "dir": "SORT_DESC"}]
          }
        }
      }
    ]
  }' | jq
```

The first stage pulls state-level sales from FireKicks. The second stage joins that result with your uploaded region mapping and aggregates by region. All processing happens in the scratch pad.

Now join with your targets to see performance against plan:

```bash
curl -s -X POST "$DA_URL/v1/connections/scratch:user:tutorial/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:tutorial" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [
        {"expr": {"column": {"table": "rr", "column": "region"}}, "alias": "region"},
        {"expr": {"column": {"table": "rt", "column": "q4_target"}}, "alias": "target"},
        {"expr": {"column": {"table": "rr", "column": "actual_sales"}}, "alias": "actual"},
        {"expr": {
          "binary": {
            "op": "OP_MUL",
            "left": {
              "binary": {
                "op": "OP_DIV",
                "left": {
                  "binary": {
                    "op": "OP_SUB",
                    "left": {"column": {"table": "rr", "column": "actual_sales"}},
                    "right": {"column": {"table": "rt", "column": "q4_target"}}
                  }
                },
                "right": {"column": {"table": "rt", "column": "q4_target"}}
              }
            },
            "right": {"literal": {"number": 100}}
          }
        }, "alias": "variance_pct"}
      ],
      "from": {
        "join": {
          "left": {"table": {"table": "regional_rollup", "alias": "rr"}},
          "right": {"table": {"table": "regional_targets", "alias": "rt"}},
          "on": {
            "eq": {
              "left": {"column": {"table": "rr", "column": "region"}},
              "right": {"column": {"table": "rt", "column": "region"}}
            }
          }
        }
      },
      "orderBy": [{"expr": {"column": {"column": "variance_pct"}}, "dir": "SORT_DESC"}]
    }
  }' | jq
```

This query joins:
- Live database data (FireKicks sales by state)
- Uploaded reference data (state-to-region mapping)
- Uploaded planning data (regional targets)

All in a single query. This is the core value proposition of CSV uploads: bringing external data into the same query space as your databases.

## System-Level Uploads

Scratch pads are per-identity by default, but you can also upload to the `system` scratch pad for shared reference data available to all users:

```bash
# Upload exchange rates for company-wide use
cat > /tmp/exchange_rates.csv << 'EOF'
currency,rate_to_usd,last_updated
EUR,1.08,2025-01-15
GBP,1.27,2025-01-15
JPY,0.0067,2025-01-15
CAD,0.74,2025-01-15
EOF

curl -s -X POST "$DA_URL/admin/scratch/system/upload?table=exchange_rates" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@/tmp/exchange_rates.csv" | jq
```

Now any user can reference this data:

```bash
curl -s -X POST "$DA_URL/v1/connections/scratch:system/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:tutorial" \
  -H "Content-Type: application/json" \
  -d '{
    "select": {
      "columns": [{"expr": {"star": {}}}],
      "from": {"table": {"table": "exchange_rates"}}
    }
  }' | jq
```

Use system-level uploads for:
- Company-wide reference data (exchange rates, product hierarchies, etc.)
- Shared lookup tables
- Standard dimension mappings

Use identity-level uploads (`user:*`) for:
- User-specific analysis data
- Temporary ad-hoc uploads
- Private data that shouldn't be shared

## Using Uploads with Value Stores

CSV uploads integrate with the value resolution system from Part 6. Instead of pulling canonical values from a database, you can upload a CSV of valid values and use it for NER matching.

Example workflow:

```bash
# Upload canonical product categories
cat > /tmp/categories.csv << 'EOF'
canonical_name,aliases
Running Shoes,"running,runners,run shoes"
Basketball Shoes,"basketball,hoops,bball shoes"
Training Shoes,"training,cross-training,gym shoes"
Casual Sneakers,"casual,lifestyle,sneakers"
EOF

curl -s -X POST "$DA_URL/admin/scratch/system/upload?table=product_categories" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@/tmp/categories.csv"

# Now create a value store that references this uploaded data
curl -s -X PUT "$DA_URL/admin/stores/product_category" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "scratch:system",
    "source_query": "SELECT canonical_name, aliases FROM product_categories",
    "value_column": "canonical_name",
    "metadata_columns": ["aliases"],
    "similarity_threshold": 0.65
  }'
```

This pattern is especially useful for reference data that lives in spreadsheets maintained by business users rather than in databases.

## Limits and Behavior

Understanding CSV upload constraints and behavior:

**Size and Row Limits**
- Max file size: 50MB (configurable via `SCRATCH_MAX_UPLOAD_SIZE`)
- Max rows: 100,000 (default, configurable via `SCRATCH_MAX_ROWS`)
- Files exceeding these limits return an error

**Schema Handling**
- All columns are imported as TEXT type
- SQLite handles type affinity automatically (numeric strings work in math operations)
- First row must be headers
- Empty cells become NULL values

**Table Behavior**
- Uploading to the same table name overwrites previous data (idempotent)
- Each identity has its own namespace — different users can have tables with the same name
- Table names are case-sensitive
- Valid table names: alphanumeric plus underscore, must start with letter

**Character Encoding**
- Files must be UTF-8 encoded
- CSV format follows RFC 4180 (quoted fields, escaped quotes, etc.)

## Agent Workflow

CSV uploads enable powerful AI agent workflows:

**Step 1: User provides data**
```
User: "Here's our Q4 targets by region (pastes CSV data)"
```

**Step 2: Agent uploads to scratch pad**
```bash
# Agent writes CSV to temp file and uploads
curl -X POST "$DA_URL/admin/scratch/user:alice/upload?table=q4_targets" \
  -H "X-API-Key: $API_KEY" \
  -F "file=@/tmp/user_data.csv"
```

**Step 3: Agent queries uploaded data alongside database**
```bash
# Agent uses staged query to join uploaded targets with live sales data
curl -X POST "$DA_URL/v1/connections/scratch:user:alice/staged-query" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:alice" \
  -d '{
    "stages": [
      {"name": "sales", "connection": "firekicks", "query": {...}},
      {"name": "comparison", "query": {...}}
    ]
  }'
```

**Step 4: Agent saves results for further analysis**
```bash
# Agent saves joined results as a new scratch pad table
curl -X POST "$DA_URL/v1/connections/scratch:user:alice/query-ast" \
  -H "X-API-Key: $API_KEY" \
  -H "X-On-Behalf-Of: user:alice" \
  -d '{
    "insert": {
      "table": "target_analysis",
      "query": {"select": {...}}
    }
  }'
```

The scratch pad becomes a conversational workspace where uploaded data, database queries, and intermediate results all coexist.

## Next Steps

This completes the FireKicks tutorial series. You've learned:

- **Part 1**: Basic connectivity and catalog exploration
- **Part 2**: Advanced querying with AST and SQL
- **Part 3**: Cross-database joins with staged queries
- **Part 4**: Semantic layer with stored definitions
- **Part 5**: Scratch pads for intermediate results
- **Part 6**: Value resolution and entity extraction
- **Part 7**: CSV uploads for ad-hoc analysis

Continue exploring:

- [Data Access Service Overview](../../overview.md) - Architecture and design principles
- [Concepts](../../concepts.md) - Deep dive into core abstractions
- [API Reference](../../reference.md) - Complete endpoint documentation

For production use, review:
- Authentication and authorization patterns
- Connection configuration for your databases
- Scratch pad lifecycle management
- Performance tuning for large datasets
