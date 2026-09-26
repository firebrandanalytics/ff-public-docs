# Code Sandbox — Operations

Enabling the Code Sandbox for your app, making databases available to executed code, limits to design around, and caller-side troubleshooting.

## Enabling the Code Sandbox

The Code Sandbox is a component of the `firefoundry-core` Helm chart. Turn it on in your environment's values:

```yaml
code-sandbox:
  enabled: true
```

Once enabled, bundles in the cluster reach it at `http://firefoundry-core-code-sandbox:3000`. It is not exposed outside the cluster by default.

### API key

If your environment administrator sets an API key for the sandbox, callers must send it in the `x-api-key` header. Get the value from your administrator and give it to your bundle as a secret (for example an environment variable such as `SANDBOX_API_KEY`). Never put it in prompts or generated code.

## Making Databases Available

Each database that executed code can use is configured once for the environment, under a **name**. Requests refer to the database by that name, and the code sees it as `dbs.<name>`.

For most database types, the connection string goes in the sandbox's secret values as `<NAME>_CONNECTION_STRING`:

```yaml
code-sandbox:
  secret:
    data:
      ANALYTICS_CONNECTION_STRING: "postgresql://readonly_user:<password>@db-host:5432/analytics?ssl=true"
```

With that setting, a request can include `{ "name": "analytics", "type": "postgres" }`.

Recommendations:

- **Use a dedicated, least-privilege database user.** Generated code can run any SQL that user is allowed to run. For analytics, use a read-only user limited to the schemas the app needs.
- **Keep connection strings in secrets**, for example through your environment's secret management, not in plain values files checked into source control.
- **Name databases for what they mean to the app** (`analytics`, `warehouse`), and use the same names in your prompts so the LLM writes `dbs.analytics` correctly.

### Databricks

Databricks connections use these settings, also under `code-sandbox.secret.data`, instead of a connection string:

| Setting | Purpose |
|---------|---------|
| `DATABRICKS_HOST` | Databricks workspace hostname |
| `DATABRICKS_HTTP_PATH` | SQL warehouse HTTP path |
| `DATABRICKS_CLIENT_ID` | Azure AD app (service principal) client ID |
| `DATABRICKS_CLIENT_SECRET` | Azure AD app secret |
| `DATABRICKS_TENANT_ID` | Azure tenant ID |
| `DATABRICKS_CATALOG` | Default catalog |
| `DATABRICKS_PORT` | Port (typically 443) |
| `DATABRICKS_DRIVER` | ODBC driver name |

If you don't manage your environment's values yourself, ask your environment administrator to add the database for you.

## Verifying Access from a Bundle

1. From inside the cluster (or through a port-forward), `GET /health` should return `OK`.
2. Run a trivial `finance` request with no databases (see [Getting Started](./getting-started.md#step-2-run-simple-code)). This confirms the API key and the harness.
3. Run a `SELECT 1` against each configured database name. This confirms the connection settings and network access to the database.

## Limits and Behavior to Design Around

- **Stateless requests**: nothing persists between requests. Send all inputs with each request.
- **Execution time**: runs are bounded by a timeout. Keep queries selective and split large analyses into several smaller runs.
- **Memory**: compilation and data processing run in memory. Aggregate in SQL and use `LIMIT` rather than pulling whole tables into the sandbox.
- **Libraries**: only the [bundled libraries](./concepts.md#available-libraries) are available. Imports of anything else fail at compile time.
- **Rate limiting**: the sandbox rate-limits callers. Back off and retry when a request is rejected for rate.
- **No automatic idempotency**: a retried request runs the code again (see [Concepts](./concepts.md#retries-and-idempotency)).

## Troubleshooting

**Compilation errors**
- Check that the code exports the harness entry point: `analyze` for `finance`, `run` for `sql`.
- Check TypeScript syntax. Compilation is strict.
- Check for imports of libraries the sandbox doesn't include.
- In a generate-and-run loop, send the `errors` array back to the bot that wrote the code.

**`dbs.<name>` is undefined, or a database connection fails**
- The request's `databases` array must include that name, and the name must be configured for the environment.
- For connection-string databases, check the `<NAME>_CONNECTION_STRING` value with your environment administrator.
- Confirm the database accepts connections from the cluster.
- For Databricks, check the client ID, secret, and tenant ID.

**Authentication failures**
- Send `x-api-key` with the value your environment configures, and check that your bundle's secret matches it.

**Timeouts**
- Make the queries more selective, or break the work into smaller runs.
- Use streaming to see whether the time is going to compilation or execution.

**Out of memory**
- Reduce the data volume the code loads. Aggregate in SQL and process in batches.
