# Web Search — Operations

Enabling the Web Search Service for your app, the settings an app team may change, limits to design around, and caller-side troubleshooting.

## Enabling the Web Search Service

The Web Search Service is a component of the `firefoundry-core` Helm chart and is disabled by default. It needs a search provider API key. The current provider is the [Brave Search API](https://brave.com/search/api/).

```yaml
websearch-service:
  enabled: true
  secret:
    data:
      BRAVE_API_KEY: "your-brave-api-key"
```

Keep the key in your environment's secret management, not in a values file in source control. The component also needs a database credential when it is installed; your environment administrator provides it.

Once enabled, bundles in the cluster reach the service at `http://firefoundry-core-websearch-service:8080`. It is not exposed outside the cluster by default.

## Settings You May Change

These go under `websearch-service.configMap.data`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `SEARCH_DEFAULT_LIMIT` | `10` | Results per page when the caller doesn't send `limit` |
| `SEARCH_DEFAULT_SAFE_SEARCH` | `moderate` | SafeSearch level when the caller doesn't send `safeSearch` (`off`, `moderate`, `strict`) |
| `BRAVE_TIMEOUT_MS` | `5000` | How long the service waits for the provider before returning `TIMEOUT` |
| `LOG_LEVEL` | `info` | Service log verbosity (`debug`, `info`, `warn`, `error`) |

The service reads these at startup, so restart it after a change.

## Verifying Access from a Bundle

1. `GET /ready` from inside the cluster (or through a port-forward) should succeed. Not-ready usually means a missing or invalid provider key or no outbound network access.
2. Run `GET /v1/search?q=test&limit=1`. A result confirms the provider key works.
3. Send an `X-Request-ID` and check it comes back in `meta.requestId`.

## Limits and Behavior to Design Around

- **Query length**: 1–500 characters.
- **Page size**: 1–50 results per request. Page with `offset` and stop when `hasMore` is `false`.
- **Estimates**: `totalResults` and `pagination.total` are provider estimates, not exact counts.
- **Latency**: every search is a round trip to an external provider, bounded by `BRAVE_TIMEOUT_MS`. Run independent searches in parallel, and cap searches per user request.
- **Provider quotas and cost**: your provider plan's rate limits and pricing apply. Bursty agent loops can hit provider limits, which show up as errors with HTTP 502 or `RATE_LIMITED` (429).
- **Page fetching**: up to 20 URLs per batch and 60 seconds per fetch. `dynamic` rendering and screenshots are slower than `static` fetches.
- **Outbound access**: the service must be able to reach the provider and any pages you fetch over HTTPS.
- **Logging**: searches (query, parameters, result count, timing) are logged by the service for debugging and usage analysis. Don't put secrets or personal data in queries.

## Troubleshooting

**`/ready` fails or every search fails**
- Check that the provider API key is set and valid.
- Check that the cluster allows outbound HTTPS to the provider.
- Ask your environment administrator to check the service's database connection.

**HTTP 502 errors**
- The provider rejected or failed the request. Check that the key is valid and your provider plan has quota left.
- Retry a limited number of times with backoff.

**`TIMEOUT` (504)**
- The provider was slow. Retry, or ask for `BRAVE_TIMEOUT_MS` to be raised if it happens often.

**`RATE_LIMITED` (429)**
- Too many requests. Add backoff and a per-request search budget, and run fewer searches in parallel.

**`VALIDATION_ERROR` (400)**
- Check `error.details`. Common causes are an empty query, a query longer than 500 characters, or `limit` outside 1–50.

**Empty results**
- The query may be too restrictive. Drop `exactPhrases`, `sites.include`, or `fileTypes` and retry.
- `safeSearch=strict` can remove relevant results.
- A short `freshness` window (`day`) may exclude everything.

**Finding a specific search**
- Send `X-Request-ID` with every search and log it in your bundle. Give that ID to your environment administrator when you ask them to look up the service's logs.
