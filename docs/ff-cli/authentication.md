# Authentication

The `auth` commands in `ff-cli` handle authentication for FireFoundry services such as the private npm registry.

## Overview

Before installing `@firebrandanalytics` packages via `pnpm install`, you must exchange your FireFoundry license for an npm registry token. The `auth npm` command automates this process.

## auth npm Command

Exchange a FireFoundry license for an npm registry token.

### Basic Usage

```bash
# Exchange license for npm token (non-interactive)
ff-cli auth npm -y

# Verify the token was written
grep firebrandanalytics ~/.npmrc
```

### What It Does

1. **Discovers your license** using the resolution order below
2. **Exchanges the license** for an npm token with the FireFoundry license service
3. **Writes the token** to `~/.npmrc` for the `@firebrandanalytics` scope

After running this command, `pnpm install` (or `npm install`) can resolve `@firebrandanalytics` packages from the private registry.

### License Discovery Order

When the `--license` flag is not provided, `ff-cli` searches for a license in this order:

1. `license` field in the active profile (`~/.ff/profiles`)
2. `*.jwt` files in the current working directory (interactive selection if multiple)
3. `*.jwt` files in `~/.ff/` directory (auto-used if single, interactive if multiple)

### Command Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompts |

### Examples

**Standard usage (recommended):**

Place your license JWT in `~/.ff/` and run:

```bash
ff-cli auth npm -y
```

**In a CI/CD pipeline:**

```bash
ff-cli auth npm -y
pnpm install
```

### When to Run

You need to run `ff-cli auth npm` in these situations:

- **First time setup** - Before the first `pnpm install` in a FireFoundry project
- **Token expiry** - If `pnpm install` fails with a 401 or 403 error for `@firebrandanalytics` packages
- **New machine** - When setting up a new development environment

### Troubleshooting

**Problem:** `pnpm install` fails with authentication errors after running `auth npm`

```bash
Error: 401 Unauthorized - GET https://npm.pkg.github.com/@firebrandanalytics%2fff-agent-sdk
```

**Solution:** Re-run the auth command and verify the token:

```bash
ff-cli auth npm -y
grep firebrandanalytics ~/.npmrc
```

**Problem:** No license found

```bash
Error: No license found. Provide --license or place a .jwt file in ~/.ff/
```

**Solution:** Ensure your license JWT is in `~/.ff/` or provide the path explicitly:

```bash
ff-cli auth npm -y --license ./path/to/license.jwt
```

## Related Commands

- **[Profile Management](profiles.md)** - Profiles can store license paths for automatic discovery
- **[Cluster Init](cluster-management.md)** - Also uses license discovery for registry credentials
