# Regex Pattern Library

This is a curated library of tested regex patterns for use with the Data Access Service AST's `regex_match` expression. These patterns are designed for data validation, filtering, and quality checks across database queries.

**How patterns are used**: When you include a `regex_match` expression in an AST query, the service emits the pattern as a bind parameter — not as inline SQL. This means you never need to worry about SQL escaping in your patterns. The serializer handles per-dialect differences automatically:

| Database | Serialized As | Example |
|----------|---------------|---------|
| PostgreSQL | `column ~ $1` | `"email" ~ $1` |
| MySQL | `column REGEXP ?` | `` `email` REGEXP ? `` |
| SQLite | `column REGEXP ?` | `"email" REGEXP ?` |
| SQL Server | `column LIKE` (no native regex) | Requires `PATINDEX` or CLR — see dialect notes |
| Oracle | `REGEXP_LIKE(column, :1)` | `REGEXP_LIKE("email", :1)` |
| Snowflake | `column RLIKE ?` | `"email" RLIKE ?` |
| Databricks | `column RLIKE ?` | `` `email` RLIKE ? `` |

**AST format**: The `regex_match` expression takes a column reference and a pattern string. The pattern is passed as a bind parameter:

```json
{
  "where": {
    "regex": {
      "expr": { "column": { "column": "email" } },
      "pattern": "^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$"
    }
  },
  "params": []
}
```

The pattern value is automatically added as a bind parameter by the serializer — you do not include it in the `params` array yourself.

## Dialect Compatibility Notes

Before using these patterns, be aware of key differences between regex engines:

| Feature | PostgreSQL | MySQL | SQLite |
|---------|-----------|-------|--------|
| Engine | POSIX ERE | ICU / Henry Spencer | None (requires extension) |
| Case sensitivity | Case-sensitive by default; use `~*` for insensitive | Case-insensitive by default; use `BINARY` for sensitive | Depends on extension |
| Anchors `^` / `$` | Supported | Supported | Supported (with extension) |
| `\d`, `\w`, `\s` | Not supported (use `[0-9]`, `[A-Za-z0-9_]`, `[[:space:]]`) | Supported in MySQL 8+ (ICU) | Depends on extension |
| `{n,m}` quantifiers | Supported | Supported | Supported (with extension) |
| Lookahead/lookbehind | Not supported | Supported in MySQL 8+ (ICU) | Depends on extension |
| POSIX classes `[:alpha:]` | Supported | Not supported | Not supported |

**Recommendation**: All patterns in this library use the POSIX ERE compatible subset — character classes like `[0-9]` and `[A-Za-z]` instead of `\d` and `[[:alpha:]]`. This ensures they work across PostgreSQL, MySQL 8+, and SQLite (with the REGEXP extension loaded).

---

## 1. Email and Contact

### email_basic

Matches standard email addresses. Validates the general structure but does not enforce RFC 5322 exhaustively.

**Pattern**: `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`

| Matches | Does Not Match |
|---------|---------------|
| `alice@example.com` | `alice@` |
| `bob.smith+tag@company.co.uk` | `@example.com` |
| `user123@sub.domain.org` | `alice @example.com` (space) |
| `first.last@domain.io` | `alice@.com` |

**Dialect notes**: Works on all three Tier 1 databases without modification. MySQL is case-insensitive by default, which is actually desirable for email matching.

**AST example** — find customers with invalid email addresses:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "customer_id" } } },
      { "expr": { "column": { "column": "email" } } }
    ],
    "from": { "table": { "table": "customers" } },
    "where": {
      "unary": {
        "op": "UNARY_OP_NOT",
        "operand": {
          "regex": {
            "expr": { "column": { "column": "email" } },
            "pattern": "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"
          }
        }
      }
    }
  }
}
```

### phone_us

Matches US phone numbers in common formats: `(555) 123-4567`, `555-123-4567`, `5551234567`, `+1-555-123-4567`.

**Pattern**: `^(\+?1[-. ]?)?(\(?[0-9]{3}\)?[-. ]?)?[0-9]{3}[-. ]?[0-9]{4}$`

| Matches | Does Not Match |
|---------|---------------|
| `(555) 123-4567` | `123-4567` (no area code when prefix present) |
| `555-123-4567` | `+44 20 7946 0958` (UK number) |
| `+1-555-123-4567` | `555-123-456` (too short) |
| `5551234567` | `(555) 123-45678` (too long) |

**Dialect notes**: No dialect differences. The pattern uses only basic character classes and quantifiers.

### phone_international_e164

Matches E.164 international phone numbers: a `+` followed by 7 to 15 digits (no spaces or dashes).

**Pattern**: `^\+[0-9]{7,15}$`

| Matches | Does Not Match |
|---------|---------------|
| `+14155551234` | `14155551234` (no plus) |
| `+442071234567` | `+1-415-555-1234` (has dashes) |
| `+8613800138000` | `+123456` (too short) |

**Dialect notes**: No dialect differences.

---

## 2. Financial

### currency_usd

Matches US dollar amounts with optional dollar sign, commas, and cents.

**Pattern**: `^\$?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]{2})?$`

| Matches | Does Not Match |
|---------|---------------|
| `$1,234.56` | `$1,23.56` (bad comma grouping) |
| `1234.56` | `$1,234.5` (one decimal place) |
| `$0.99` | `1,234,56` (comma as decimal) |
| `$1,000,000.00` | `$-100.00` (negative) |

**Dialect notes**: The `$` at the start of the pattern is a literal character, not an anchor, because it follows `^`. No dialect issues.

### currency_amount_general

Matches numeric amounts with optional thousands separators and decimal places. Currency-symbol agnostic.

**Pattern**: `^-?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]{1,4})?$`

| Matches | Does Not Match |
|---------|---------------|
| `1,234.56` | `1,23.56` (bad grouping) |
| `-500.00` | `1.23456` (too many decimals) |
| `1,000,000` | `1,,000` (double comma) |
| `0.5` | `.50` (no leading digit) |

**Dialect notes**: No dialect differences.

### credit_card_masked

Matches masked credit card numbers where only the last 4 digits are visible. Common masking formats: `****-****-****-1234`, `XXXX-XXXX-XXXX-1234`, `************1234`.

**Pattern**: `^([*X]{4}[-. ]?){3}[0-9]{4}$`

| Matches | Does Not Match |
|---------|---------------|
| `****-****-****-1234` | `4111-1111-1111-1111` (unmasked) |
| `XXXX XXXX XXXX 5678` | `****-****-1234` (too short) |
| `************9012` | `****-****-****-12` (incomplete) |

**Dialect notes**: No dialect differences.

### percentage

Matches percentage values: integer or decimal, with optional `%` sign.

**Pattern**: `^-?[0-9]+(\.[0-9]+)?%?$`

| Matches | Does Not Match |
|---------|---------------|
| `99.5%` | `%50` (sign before number) |
| `100` | `abc%` |
| `-3.14%` | `50%%` (double sign) |
| `0.01` | `.5%` (no leading digit) |

**Dialect notes**: No dialect differences.

---

## 3. Date and Time

### date_iso8601

Matches ISO 8601 date format: `YYYY-MM-DD`.

**Pattern**: `^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`

| Matches | Does Not Match |
|---------|---------------|
| `2025-01-15` | `01-15-2025` (US format) |
| `2024-12-31` | `2025-13-01` (month 13) |
| `2000-02-29` | `2025-00-15` (month 00) |
| `1999-06-01` | `2025-1-5` (unpadded) |

**Dialect notes**: No dialect differences. Note that this pattern validates format only — it does not reject impossible dates like `2025-02-30`. For true date validation, use CAST or database date functions.

### date_us

Matches US date format: `MM/DD/YYYY` or `MM-DD-YYYY`, with optional leading zeros.

**Pattern**: `^(0?[1-9]|1[0-2])[/-](0?[1-9]|[12][0-9]|3[01])[/-][0-9]{4}$`

| Matches | Does Not Match |
|---------|---------------|
| `01/15/2025` | `2025-01-15` (ISO format) |
| `1/5/2025` | `13/01/2025` (month 13) |
| `12-31-2024` | `01/15/25` (two-digit year) |

**Dialect notes**: No dialect differences.

### timestamp_iso8601

Matches ISO 8601 timestamps: `YYYY-MM-DDThh:mm:ss` with optional fractional seconds and timezone.

**Pattern**: `^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$`

| Matches | Does Not Match |
|---------|---------------|
| `2025-01-15T09:30:00Z` | `2025-01-15 09:30:00` (space separator) |
| `2025-01-15T09:30:00.123Z` | `2025-01-15T25:00:00Z` (hour 25) |
| `2025-01-15T09:30:00-05:00` | `2025-01-15T09:30` (missing seconds) |
| `2025-01-15T09:30:00.123456+00:00` | `2025-13-15T09:30:00Z` (month 13) |

**Dialect notes**: No dialect differences.

**AST example** — find records with ISO timestamp values in a text column:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "event_id" } } },
      { "expr": { "column": { "column": "event_timestamp" } } }
    ],
    "from": { "table": { "table": "audit_log" } },
    "where": {
      "regex": {
        "expr": { "column": { "column": "event_timestamp" } },
        "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$"
      }
    }
  }
}
```

---

## 4. Identifiers

### uuid_v4

Matches UUID version 4 (RFC 4122) in lowercase or uppercase, with hyphens.

**Pattern**: `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`

| Matches | Does Not Match |
|---------|---------------|
| `550e8400-e29b-41d4-a716-446655440000` | `550e8400e29b41d4a716446655440000` (no hyphens) |
| `6BA7B810-9DAD-41D2-80B4-00C04FD430C8` | `550e8400-e29b-51d4-a716-446655440000` (version 5) |
| `f47ac10b-58cc-4372-a567-0e02b2c3d479` | `not-a-uuid-at-all` |

**Dialect notes**: PostgreSQL and MySQL are both fine. On MySQL, the match is case-insensitive by default, which works well here since UUIDs can be either case. If you need case-sensitive matching on MySQL, use `BINARY column REGEXP pattern`.

### uuid_any

Matches any UUID format (versions 1-5), with hyphens.

**Pattern**: `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`

| Matches | Does Not Match |
|---------|---------------|
| `550e8400-e29b-11d4-a716-446655440000` (v1) | `550e8400-e29b-61d4-a716-446655440000` (version 6) |
| `6ba7b810-9dad-31d2-80b4-00c04fd430c8` (v3) | `00000000-0000-0000-0000-000000000000` (nil UUID, version 0) |
| `f47ac10b-58cc-4372-a567-0e02b2c3d479` (v4) | `not-a-valid-uuid` |

**Dialect notes**: Same as uuid_v4.

### ssn_masked

Matches US Social Security Numbers in masked format where only the last 4 digits are visible: `***-**-1234` or `XXX-XX-1234`.

**Pattern**: `^[*X]{3}-[*X]{2}-[0-9]{4}$`

| Matches | Does Not Match |
|---------|---------------|
| `***-**-1234` | `123-45-6789` (unmasked) |
| `XXX-XX-5678` | `***-***-1234` (wrong grouping) |
| | `***-**-123` (too short) |

**Dialect notes**: No dialect differences.

### zip_code_us

Matches US ZIP codes: 5-digit or ZIP+4 format.

**Pattern**: `^[0-9]{5}(-[0-9]{4})?$`

| Matches | Does Not Match |
|---------|---------------|
| `90210` | `9021` (too short) |
| `10001-1234` | `90210-12` (incomplete +4) |
| `00501` | `ABCDE` |
| `99999-9999` | `123456` (too long) |

**Dialect notes**: No dialect differences.

**AST example** — find customers with valid ZIP codes:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "customer_id" } } },
      { "expr": { "column": { "column": "name" } } },
      { "expr": { "column": { "column": "zip_code" } } }
    ],
    "from": { "table": { "table": "customers" } },
    "where": {
      "regex": {
        "expr": { "column": { "column": "zip_code" } },
        "pattern": "^[0-9]{5}(-[0-9]{4})?$"
      }
    }
  }
}
```

### ip_address_v4

Matches IPv4 addresses: four octets (0-255) separated by dots.

**Pattern**: `^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$`

| Matches | Does Not Match |
|---------|---------------|
| `192.168.1.1` | `256.1.1.1` (octet > 255) |
| `10.0.0.0` | `192.168.1` (only 3 octets) |
| `255.255.255.255` | `192.168.1.1.1` (5 octets) |
| `0.0.0.0` | `192.168.01.1` matches (leading zeros allowed) |

**Dialect notes**: No dialect differences.

### ip_address_v6_abbreviated

Matches common IPv6 address formats. This is a simplified pattern that matches the most common representations (full, abbreviated with `::`, and mixed IPv4-mapped). A fully RFC-compliant IPv6 regex is impractically long for database use.

**Pattern**: `^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^([0-9a-fA-F]{1,4}:)*:([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$|^::$`

| Matches | Does Not Match |
|---------|---------------|
| `2001:0db8:85a3:0000:0000:8a2e:0370:7334` | `192.168.1.1` (IPv4) |
| `fe80::1` | `2001:db8::85a3::1` (double `::`) |
| `::` (loopback shorthand) | `GHIJ:0db8:85a3::7334` (invalid hex) |
| `::1` | `12345::1` (group too long) |

**Dialect notes**: The alternation (`|`) works on all three Tier 1 databases. The pattern is necessarily simplified — for strict RFC 4291 validation, use application-level code.

---

## 5. Text Patterns

### url_http

Matches HTTP and HTTPS URLs with optional path, query string, and fragment.

**Pattern**: `^https?://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]+)?(/[A-Za-z0-9_.~:/?#[@!$&'()*+,;=%-]*)?$`

| Matches | Does Not Match |
|---------|---------------|
| `https://example.com` | `ftp://files.example.com` (wrong scheme) |
| `http://sub.domain.co.uk/path?q=1` | `example.com` (no scheme) |
| `https://localhost:8080/api/v1` | `https://` (no host) |
| `https://example.com/path#section` | `not a url at all` |

**Dialect notes**: No dialect differences.

### hashtag

Matches social-media-style hashtags: `#` followed by alphanumeric characters and underscores.

**Pattern**: `#[A-Za-z][A-Za-z0-9_]{0,138}`

| Matches (within text) | Does Not Match |
|---------|---------------|
| `#sale` | `# sale` (space after hash) |
| `#BlackFriday2025` | `#123` (starts with digit) |
| `#new_arrivals` | `#` (hash only) |

**Dialect notes**: This pattern is not anchored with `^`/`$` — it is designed for searching within text columns, not for full-value validation. To match an entire value, add `^` and `$` anchors.

### mention

Matches @-mention style references: `@` followed by a username (alphanumeric plus underscores and hyphens).

**Pattern**: `@[A-Za-z][A-Za-z0-9_-]{0,38}`

| Matches (within text) | Does Not Match |
|---------|---------------|
| `@alice` | `@ alice` (space after @) |
| `@user-name` | `@123` (starts with digit) |
| `@Team_Lead` | `@` (@ only) |

**Dialect notes**: Same as hashtag — not anchored. Add `^`/`$` for full-value matching.

### quoted_string_double

Matches double-quoted strings, including escaped quotes inside.

**Pattern**: `"([^"\\]|\\.)*"`

| Matches (within text) | Does Not Match |
|---------|---------------|
| `"hello world"` | `"unclosed` |
| `"she said \"hi\""` | `'single quotes'` |
| `""` (empty quoted string) | `"line1\nline2"` depends on engine |

**Dialect notes**: Backslash escaping in patterns varies. On PostgreSQL, ensure `standard_conforming_strings` is `on` (default since PG 9.1). On MySQL, backslashes in patterns are interpreted by both the SQL parser and the regex engine, so you may need double-escaping in raw SQL — but since the Data Access Service passes patterns as bind parameters, this is handled automatically.

**AST example** — find product descriptions containing quoted text:

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "product_id" } } },
      { "expr": { "column": { "column": "description" } } }
    ],
    "from": { "table": { "table": "products" } },
    "where": {
      "regex": {
        "expr": { "column": { "column": "description" } },
        "pattern": "\"([^\"\\\\]|\\\\.)*\""
      }
    }
  }
}
```

Note the double-escaping in the JSON string: `\\\\` in JSON becomes `\\` in the actual pattern, which matches a literal backslash.

---

## 6. Data Quality

### empty_or_whitespace

Matches values that are empty strings or contain only whitespace characters (spaces, tabs, newlines).

**Pattern**: `^[[:space:]]*$`

| Matches | Does Not Match |
|---------|---------------|
| `` (empty string) | `hello` |
| `   ` (spaces) | ` hello ` (has content) |
| (tab characters) | `0` |

**Dialect notes**:
- **PostgreSQL**: `[[:space:]]` is a POSIX character class — fully supported.
- **MySQL**: POSIX classes are not supported in MySQL's regex engine. Use `^[ \t\r\n]*$` instead. Since MySQL 8 uses ICU, `\\s` also works: `^\\s*$`.
- **SQLite**: Depends on the regex extension. Most extensions support POSIX classes.

**Cross-database alternative**: `^[ ]*$` if you only need to match spaces (not tabs/newlines).

### numeric_string

Matches strings that contain only a numeric value: optional sign, digits, optional decimal point.

**Pattern**: `^-?[0-9]+(\.[0-9]+)?$`

| Matches | Does Not Match |
|---------|---------------|
| `123` | `12.34.56` (multiple dots) |
| `-456.78` | `$100` (currency symbol) |
| `0.001` | `1,000` (comma separator) |
| `0` | `12a` (letter) |

**Dialect notes**: No dialect differences.

**AST example** — find rows where a text column actually contains numeric data (useful for data profiling):

```json
{
  "select": {
    "columns": [
      { "expr": { "column": { "column": "field_value" } } },
      { "expr": { "function": { "name": "count", "args": [{ "star": {} }] } }, "alias": "row_count" }
    ],
    "from": { "table": { "table": "raw_import" } },
    "where": {
      "regex": {
        "expr": { "column": { "column": "field_value" } },
        "pattern": "^-?[0-9]+(\\.[0-9]+)?$"
      }
    },
    "groupBy": [{ "expr": { "column": { "column": "field_value" } } }],
    "orderBy": [{ "expr": { "column": { "column": "row_count" } }, "dir": "SORT_DESC" }],
    "limit": 20
  }
}
```

### alphanumeric_only

Matches strings that contain only letters (upper and lower case) and digits. No spaces, punctuation, or special characters.

**Pattern**: `^[A-Za-z0-9]+$`

| Matches | Does Not Match |
|---------|---------------|
| `ABC123` | `ABC 123` (space) |
| `hello` | `hello!` (punctuation) |
| `42` | `hello_world` (underscore) |
| `ProductSKU001` | `` (empty string) |

**Dialect notes**: No dialect differences.

### alphanumeric_with_separators

Matches strings with letters, digits, and common separators (hyphens, underscores, spaces). Useful for validating codes, SKUs, and identifiers that allow limited punctuation.

**Pattern**: `^[A-Za-z0-9][A-Za-z0-9 _-]*[A-Za-z0-9]$`

| Matches | Does Not Match |
|---------|---------------|
| `FK-12345678` | `-start-with-dash` |
| `PROD_001` | `end-with-dash-` |
| `Order 42` | `has@special` |
| `A1` | `X` (single char — use `^[A-Za-z0-9]+$` for that) |

**Dialect notes**: No dialect differences.

### not_null_not_empty

Matches values that contain at least one non-whitespace character. This is the inverse of `empty_or_whitespace` — use it to filter out blank values.

**Pattern**: `[^ \t\r\n]`

| Matches | Does Not Match |
|---------|---------------|
| `hello` | `` (empty string) |
| ` x ` (has content) | `   ` (only spaces) |
| `0` | (tab/newline only) |

**Dialect notes**: Not anchored — matches if any non-whitespace character exists anywhere in the value. Works across all Tier 1 databases. For MySQL, `[^ \\t\\r\\n]` or `\\S` (MySQL 8+ ICU) also works.

---

## Pattern Quick Reference

| Name | Pattern | Category |
|------|---------|----------|
| `email_basic` | `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$` | Email & Contact |
| `phone_us` | `^(\+?1[-. ]?)?(\(?[0-9]{3}\)?[-. ]?)?[0-9]{3}[-. ]?[0-9]{4}$` | Email & Contact |
| `phone_international_e164` | `^\+[0-9]{7,15}$` | Email & Contact |
| `currency_usd` | `^\$?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]{2})?$` | Financial |
| `currency_amount_general` | `^-?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]{1,4})?$` | Financial |
| `credit_card_masked` | `^([*X]{4}[-. ]?){3}[0-9]{4}$` | Financial |
| `percentage` | `^-?[0-9]+(\.[0-9]+)?%?$` | Financial |
| `date_iso8601` | `^[0-9]{4}-(0[1-9]\|1[0-2])-(0[1-9]\|[12][0-9]\|3[01])$` | Date & Time |
| `date_us` | `^(0?[1-9]\|1[0-2])[/-](0?[1-9]\|[12][0-9]\|3[01])[/-][0-9]{4}$` | Date & Time |
| `timestamp_iso8601` | See [full pattern above](#timestamp_iso8601) | Date & Time |
| `uuid_v4` | `^[0-9a-fA-F]{8}-...-[0-9a-fA-F]{12}$` | Identifiers |
| `uuid_any` | `^[0-9a-fA-F]{8}-...-[0-9a-fA-F]{12}$` | Identifiers |
| `ssn_masked` | `^[*X]{3}-[*X]{2}-[0-9]{4}$` | Identifiers |
| `zip_code_us` | `^[0-9]{5}(-[0-9]{4})?$` | Identifiers |
| `ip_address_v4` | `^((25[0-5]\|2[0-4][0-9]\|[01]?[0-9][0-9]?)\.){3}...` | Identifiers |
| `ip_address_v6_abbreviated` | See [full pattern above](#ip_address_v6_abbreviated) | Identifiers |
| `url_http` | `^https?://[A-Za-z0-9]...` | Text Patterns |
| `hashtag` | `#[A-Za-z][A-Za-z0-9_]{0,138}` | Text Patterns |
| `mention` | `@[A-Za-z][A-Za-z0-9_-]{0,38}` | Text Patterns |
| `quoted_string_double` | `"([^"\\]\|\\.)*"` | Text Patterns |
| `empty_or_whitespace` | `^[[:space:]]*$` | Data Quality |
| `numeric_string` | `^-?[0-9]+(\.[0-9]+)?$` | Data Quality |
| `alphanumeric_only` | `^[A-Za-z0-9]+$` | Data Quality |
| `alphanumeric_with_separators` | `^[A-Za-z0-9][A-Za-z0-9 _-]*[A-Za-z0-9]$` | Data Quality |
| `not_null_not_empty` | `[^ \t\r\n]` | Data Quality |

## Tips for AI Agents

1. **Always anchor patterns** with `^` and `$` when validating entire column values. Without anchors, `[0-9]+` matches `abc123def` because it finds digits *within* the string.

2. **Use `[0-9]` instead of `\d`** for cross-database compatibility. The shorthand `\d` is not supported in PostgreSQL's POSIX regex engine.

3. **Patterns are bind parameters** — the service handles all escaping. You never need to double-escape backslashes for SQL. You only double-escape for JSON encoding (e.g., `\\d` in a JSON string becomes `\d` in the actual pattern).

4. **Combine patterns with AND/OR logic** using the AST's `binary` expression nodes:

```json
{
  "where": {
    "binary": {
      "op": "BINARY_OP_AND",
      "left": {
        "regex": {
          "expr": { "column": { "column": "email" } },
          "pattern": "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"
        }
      },
      "right": {
        "regex": {
          "expr": { "column": { "column": "zip_code" } },
          "pattern": "^[0-9]{5}(-[0-9]{4})?$"
        }
      }
    }
  }
}
```

5. **For negation** (find rows that do NOT match), wrap the `regex` expression in a `unary` NOT:

```json
{
  "unary": {
    "op": "UNARY_OP_NOT",
    "operand": {
      "regex": {
        "expr": { "column": { "column": "phone" } },
        "pattern": "^\\+[0-9]{7,15}$"
      }
    }
  }
}
```

6. **MySQL case sensitivity**: MySQL's `REGEXP` is case-insensitive by default. If you need case-sensitive matching (e.g., to distinguish `ABC` from `abc`), the agent should use a `BINARY` cast or the `REGEXP_LIKE(col, pattern, 'c')` function instead of the AST `regex_match` node. For most data quality patterns, case-insensitive matching is fine or even preferable.

7. **Performance**: Regex matching cannot use indexes. For large tables, combine regex filters with indexed column filters (equality, range) to reduce the scan set first, then apply the regex pattern on the narrowed result.
