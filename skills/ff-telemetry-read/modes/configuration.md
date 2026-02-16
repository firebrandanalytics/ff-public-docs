# ff-telemetry-read Configuration

Configuration reference for the ff-telemetry-read CLI tool. **Load this file only when troubleshooting connection issues.**

Under normal operation, the tool auto-configures from environment variables or a `.env` file in the current working directory. The AI should not need to set these values.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PG_SERVER` | Azure Postgres server name (creates host: `<server>.postgres.database.azure.com`) | Yes* |
| `PG_HOST` | Direct PostgreSQL host (alternative to `PG_SERVER`) | Yes* |
| `PG_PORT` | PostgreSQL port (default: 5432) | No |
| `PG_PASSWORD` | Password for fireread user | Yes |
| `PG_DATABASE` | Default database name | Yes |
| `PG_SSL_DISABLED` | Set to disable SSL | No |
| `FF_TELEMETRY_DATABASE` | Override database name | No |
| `FF_TELEMETRY_SCHEMA` | Schema name (default: `brk_tracking`) | No |

*Either `PG_SERVER` or `PG_HOST` is required.

## Configuration Sources

The tool loads configuration in this order (later sources override earlier):

1. **Default values** (port 5432, schema `brk_tracking`)
2. **`.env` file** in current working directory
3. **Environment variables**
4. **Command-line flags** (highest priority)

## .env File Format

```bash
# .env file in project root

# Option 1: Azure Postgres (PG_SERVER auto-constructs the host)
PG_SERVER=myserver
PG_PASSWORD=your-password-here
PG_DATABASE=firefoundry

# Option 2: Direct host (for non-Azure or local Postgres)
# PG_HOST=localhost
# PG_PORT=5432
# PG_PASSWORD=your-password-here
# PG_DATABASE=firefoundry

# Optional overrides
# FF_TELEMETRY_DATABASE=custom_db
# FF_TELEMETRY_SCHEMA=custom_schema
# PG_SSL_DISABLED=true
```

## Host Resolution

The tool resolves the PostgreSQL host as follows:

1. If `PG_HOST` is set → use it directly
2. If `PG_SERVER` is set → construct `<server>.postgres.database.azure.com`
3. Otherwise → error

**Examples:**

```bash
# Azure: PG_SERVER=myserver
# Resolves to: myserver.postgres.database.azure.com

# Direct: PG_HOST=localhost
# Uses: localhost
```

## Command-Line Flags

These override environment variables:

| Flag | Equivalent Env Var |
|------|-------------------|
| `--host <host>` | `PG_HOST` |
| `--port <port>` | `PG_PORT` |
| `--database <db>` | `PG_DATABASE` / `FF_TELEMETRY_DATABASE` |
| `--schema <schema>` | `FF_TELEMETRY_SCHEMA` |
| `--password <pass>` | `PG_PASSWORD` |

**Note:** For security, prefer environment variables or `.env` file over command-line flags for passwords.

## Troubleshooting

### Check Current Configuration

```bash
# See which env vars are set (mask password)
env | grep -E "^PG_|^FF_TELEMETRY" | sed 's/PASSWORD=.*/PASSWORD=***/'

# Check if .env file exists
cat .env | grep -E "^PG_|^FF_TELEMETRY" | sed 's/PASSWORD=.*/PASSWORD=***/'
```

### Test Connectivity

```bash
# Test with psql (if available)
PGPASSWORD=$PG_PASSWORD psql -h ${PG_HOST:-${PG_SERVER}.postgres.database.azure.com} -U fireread -d $PG_DATABASE -c "SELECT 1"

# Test with the tool
ff-telemetry-read broker recent --limit 1
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Host required" | Neither `PG_HOST` nor `PG_SERVER` set | Set one in .env |
| "password authentication failed" | Wrong password or user | Verify `PG_PASSWORD` |
| "database does not exist" | Wrong database name | Check `PG_DATABASE` |
| "relation does not exist" | Wrong schema or empty DB | Verify `FF_TELEMETRY_SCHEMA` |
| "Connection refused" | Host not reachable | Check network, firewall, SSL |
| "SSL required" | Azure requires SSL | Remove `PG_SSL_DISABLED` |
| "certificate verify failed" | SSL certificate issue | Check CA certificates |

### SSL Configuration

Azure Postgres requires SSL by default. Only set `PG_SSL_DISABLED=true` for local development databases.

```bash
# Azure (SSL required - default)
# Don't set PG_SSL_DISABLED

# Local development (no SSL)
PG_SSL_DISABLED=true
```

### Schema Verification

```bash
# Check if schema exists
PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -U fireread -d $PG_DATABASE -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'brk_tracking'"

# List tables in schema
PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -U fireread -d $PG_DATABASE -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'brk_tracking'"
```

## See Also

- [Main ff-telemetry-read skill](../SKILL.md) - Command reference
