# Test Harness Service — Operations

Deployment, configuration, health checks, scaling, security, monitoring, and troubleshooting for the Test Harness Service 0.1.0.

## Deployment

### Helm

There is **no Helm chart** for the Test Harness Service in the FireFoundry chart repository yet, and the service is not a sub-chart of `firefoundry-core`. Until a chart is published, deploy it from the container image built from the service repository, using a plain Kubernetes Deployment and Service such as the example below.

### Container Image

The repository's `Dockerfile` is a two-stage build on `node:20-alpine`:

- **Build stage** installs dependencies with pnpm and compiles TypeScript. The service depends on private `@firebrandanalytics` packages, so the build needs a GitHub token with package read access, passed as the `GITHUB_TOKEN` build argument.
- **Runtime stage** copies the compiled `dist/`, `node_modules/`, and `package.json`, runs as the non-root user `app` (UID/GID `1001`), creates a writable `/app/logs`, exposes port **8080**, and starts `node dist/index.js`.
- A Docker `HEALTHCHECK` calls `http://localhost:8080/health` every 30 seconds.

```bash
docker build --build-arg GITHUB_TOKEN="$GITHUB_TOKEN" -t test-harness-service:0.1.0 .
```

> **Set `PORT=8080` in containers.** The application's built-in default port is `3004`, but the image exposes and health-checks `8080`. Without `PORT=8080` the Docker health check fails and your Kubernetes probes must target `3004` instead.

> **Set `NODE_ENV=production` in shared environments.** The default, `development`, seeds four sample suites on every start and includes internal error messages in 500 responses.

### Example Kubernetes Manifest

An illustrative manifest; adjust names, namespace, image reference, and labels to your environment.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-harness-service
spec:
  replicas: 1            # must stay at 1 in 0.1.0 (in-memory state)
  selector:
    matchLabels:
      app: test-harness-service
  template:
    metadata:
      labels:
        app: test-harness-service
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
      containers:
        - name: test-harness-service
          image: <your-registry>/test-harness-service:0.1.0
          ports:
            - containerPort: 8080
          env:
            - name: PORT
              value: "8080"
            - name: NODE_ENV
              value: production
            - name: LOG_LEVEL
              value: info
            - name: ADMIN_API_KEY
              valueFrom:
                secretKeyRef:
                  name: test-harness-service
                  key: admin-api-key
          livenessProbe:
            httpGet: { path: /health, port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 30
          readinessProbe:
            httpGet: { path: /ready, port: 8080 }
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: test-harness-service
spec:
  selector:
    app: test-harness-service
  ports:
    - port: 8080
      targetPort: 8080
```

Clients inside the cluster then reach the service at `http://test-harness-service.<namespace>.svc.cluster.local:8080`. From a workstation:

```bash
kubectl port-forward -n <namespace> svc/test-harness-service 8080:8080
curl -s http://localhost:8080/health
```

### Database Migrations

The repository ships Flyway-style SQL migrations (`V1__test_suites.sql` through `V6__scheduled_runs.sql`) that create `test_suites`, `test_cases`, `test_runs`, `test_results`, `test_assertions`, and `scheduled_runs` with foreign keys that cascade on delete. **Version 0.1.0 does not use a database**, so you do not need to apply them to run the service. They define the schema for the PostgreSQL persistence layer that is in development.

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_ENV` | `development` | Use `production` outside local development |
| `PORT` | `3004` | Set to `8080` when running the container image |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SERVICE_NAME` | `test-harness-service` | Reported by `/` and `/status` |
| `ADMIN_API_KEY` | *(unset)* | Protects `/admin/*`; store it in a Kubernetes Secret |

The following are validated at startup but not used by 0.1.0: `PG_DATABASE`, `PG_POOL_MAX`, `PG_POOL_MIN`, `BOT_ENDPOINT_BASE_URL`, `TEST_EXECUTION_TIMEOUT_MS`, `TEST_EXECUTION_CONCURRENCY`. See the [Reference](./reference.md#configuration) for defaults. A `.env` file in the working directory is loaded automatically when present.

Invalid values stop the service at startup with `Configuration validation failed` followed by the offending fields.

## Health Checks

| Endpoint | Use | Response |
|----------|-----|----------|
| `GET /health` | Liveness | `200 { "status": "healthy", "timestamp": ... }` while the process is serving HTTP |
| `GET /ready` | Readiness | `200 { "ready": true }` |
| `GET /status` | Diagnostics | Service name, version, uptime in seconds, and `NODE_ENV` |

Both probes report healthy as long as the HTTP server is up; 0.1.0 has no downstream dependencies to check.

## Scaling

- **Run exactly one replica.** All suites, cases, runs, results, and schedules are held in the memory of a single process. With more than one replica, requests are load-balanced across pods that each hold different data, and a run created on one pod cannot be executed on another.
- **Data does not survive restarts.** A pod restart, rollout, or eviction clears all test definitions and history. Keep your suite definitions in source control (for example, as a script of `curl` calls or JSON fixtures) and re-create them after a restart.
- **Execution is synchronous.** `POST /api/runs/{id}/execute` and `POST /api/suites/{id}/run` hold the request open until every case is evaluated. With simulated execution this is fast; allow for longer client timeouts once live invocation ships.

## Security

- **`/api/*` is unauthenticated in 0.1.0.** Anyone who can reach the service can create, modify, and delete suites. Expose it only inside the cluster (ClusterIP Service, no Ingress) and restrict access with NetworkPolicies to the namespaces of the console, CI runners, or operators that need it.
- **Always set `ADMIN_API_KEY` in shared environments.** When unset, `/admin/*` is open and each call logs `Admin API accessed without ADMIN_API_KEY configured (dev mode)`. Supply the key via `X-API-Key` or `Authorization: Bearer`.
- **Use `NODE_ENV=production`** so 500 responses do not include internal error messages and sample data is not seeded.
- **Non-root container.** The image runs as UID 1001; keep `runAsNonRoot: true` in your pod security context.
- **Do not bake tokens into images.** The `GITHUB_TOKEN` build argument is needed only at build time; use a CI secret and avoid publishing intermediate build layers.
- Test inputs and recorded responses are stored verbatim. Avoid putting real customer data or credentials in `input_message` or `expected` values.

## Monitoring

The service logs JSON-structured events through the FireFoundry shared logger. Useful messages to alert or dashboard on:

| Log message | Meaning |
|-------------|---------|
| `Service listening on port <n>` | Startup completed |
| `Test run completed` (`runId`, `passed`, `failed`, `skipped`, `durationMs`) | A run finished; chart pass rates from these fields |
| `Test run cancelled` | A run was cancelled |
| `Request error` (`error`, `path`, `method`) | An error reached the error handler (mapped to 400/409, otherwise 500) |
| `Admin API accessed without ADMIN_API_KEY configured (dev mode)` | Admin endpoints are unprotected |
| `Seeding development mock data` | The pod is running with `NODE_ENV=development` |
| `Received SIGTERM, initiating graceful shutdown` | Pod is stopping |

`GET /admin/stats` returns totals of suites, runs, and schedules and is a cheap way to confirm that data is present (and to detect an unexpected restart, when totals drop to zero).

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| All suites and runs disappeared | Pod restarted; storage is in-memory in 0.1.0 | Re-create suites from your source-controlled definitions |
| Four unexpected suites (Order Flow, Customer Support, Data Analysis, Onboarding) appear | `NODE_ENV` is `development` (the default), which seeds sample data | Set `NODE_ENV=production` |
| Container marked unhealthy by Docker, or probes fail on 8080 | `PORT` not set; the app listens on 3004 | Set `PORT=8080` |
| Service exits at startup with `Invalid configuration` | An environment variable has an invalid value (e.g. `LOG_LEVEL=trace`, non-numeric `PORT`) | Fix the value; the preceding log line lists the failing fields |
| Results do not reflect what the bundle actually answers | 0.1.0 evaluates a simulated response (`Simulated response for: <input>`), not the bundle's answer | Expected in this release; see [Concepts](./concepts.md#current-release-vs-in-development) |
| `status_code` / `latency_under` assertions always pass | These are placeholders in 0.1.0 | Expected; they will be enforced by the live execution engine |
| Assertion fails with `Unknown assertion type` | Misspelled type, or a type that is still in development (e.g. `result_bot`, `levenshtein`) | Use one of the implemented types listed in the [Reference](./reference.md#assertion-types) |
| Different results or 404s for the same ID on repeated calls | More than one replica is running | Scale to one replica |
| `409` when deleting a suite | The suite has an enabled schedule | `PATCH /api/schedules/{id}` with `{"enabled": false}` or delete the schedule, then retry |
| `409 Cannot execute run in status: completed` | Runs can execute only once | Create a new run, or use `POST /api/suites/{id}/run` |
| Scheduled suite never runs | Schedules are not triggered automatically in 0.1.0 | Trigger runs from CI or a Kubernetes CronJob calling `POST /api/suites/{id}/run` |
| `500` on a POST with a body | Malformed JSON request body | Validate the JSON and send `Content-Type: application/json` |
| `401 Unauthorized` on `/admin/stats` | Wrong or missing key | Send `X-API-Key: <key>` or `Authorization: Bearer <key>` |
| Image build fails resolving `@firebrandanalytics/*` packages | No or invalid `GITHUB_TOKEN` build argument | Pass a token with GitHub Packages read access |

## Related

- [Test Harness Service Overview](./README.md)
- [Reference](./reference.md)
- [Platform Services Overview](../README.md)
