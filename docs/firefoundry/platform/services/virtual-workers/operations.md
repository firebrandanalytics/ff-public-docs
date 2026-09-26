# Virtual Worker Manager — Operations for App Builders

How to get VWM enabled for your app, the few settings an app team cares about, how to verify it works, the limits to design around, and caller-side troubleshooting.

## Enabling VWM

VWM is an optional service in `firefoundry-core` and is **disabled by default**:

```yaml
# firefoundry-core values
virtual-worker-manager:
  enabled: true
```

Before your app can start sessions, your environment administrator also provides:

- **CLI credentials** for the engines your workers use (for example, a Claude Code token), stored in the environment for VWM to hand to workspaces.
- **VW-capable runtime images** in a registry the cluster can pull from.
- **Git access** for your knowledge-base and session repositories, if they are private.
- **MCP Gateway and Skills Service**, if your workers use platform tools or skills. VWM has no skill store of its own; workers read [Skills Service](../skills-service/README.md) skills through the gateway (see [Concepts — Skills](./concepts.md#skills)).

Once VWM is running, your app team manages its own **runtimes and workers** through the [Admin API](./reference.md#admin-api) (see [Getting Started](./getting-started.md)).

## Settings an App Team May Ask For

These are VWM settings (in `virtual-worker-manager.configMap.data`) that change what your app experiences. Ask your administrator if the defaults don't fit your workload.

| Setting | Default | Effect |
|---------|---------|--------|
| `SESSION_INACTIVITY_MINUTES` | `15` | Idle time before a session is suspended (it resumes on the next request) |
| `DEFAULT_PVC_SIZE` | `10Gi` | Disk space for each session's workspace — raise it for large repositories or data files |

Per-worker settings you control directly: `timeout` (maximum session duration, default 3600 s), `autoLearn`, `cliType`, `modelConfig`, `mcpServers`, and the knowledge-base repository.

## Pointing Your Bundle at VWM

Use the in-cluster address when creating the SDK client:

```typescript
const client = new VWMClient({ baseUrl: 'http://firefoundry-core-virtual-worker-manager:8080' });
```

If your bundle runs in another namespace, use `http://firefoundry-core-virtual-worker-manager.<namespace>.svc.cluster.local:8080`. Keep the URL in your bundle's configuration rather than hard-coding it.

## Verifying

```bash
kubectl port-forward -n ff-test svc/firefoundry-core-virtual-worker-manager 8095:8080

curl http://localhost:8095/health     # liveness: 200
curl http://localhost:8095/ready      # 200 when VWM's dependencies are reachable, 503 otherwise
curl http://localhost:8095/admin/runtimes
curl http://localhost:8095/admin/workers
```

Then run a one-prompt smoke test: create a session for a worker, wait for `active`, send a short prompt, and end the session (see [Getting Started — REST API](./getting-started.md#step-4-alternative-use-the-rest-api-directly)).

## Limits and Behavior to Design Around

| Behavior | Detail |
|----------|--------|
| Session start-up | New sessions are `pending` while a container starts and repositories are cloned. Poll for `active` (the SDK does this) and reuse sessions for related prompts. |
| Idle suspension | Sessions suspend after the inactivity window and resume on the next request, with a short delay. |
| Maximum session duration | The worker's `timeout` (default 3600 s). Long jobs should be split across sessions or use a longer worker timeout. |
| Prompt timeout | Set `timeout` per prompt; long agentic tasks can take many minutes. Prefer streaming for user-facing work. |
| Conversation resume | Claude Code, Cursor and OpenCode continue the CLI conversation across prompts; with Codex, restate context or reference files. The Gemini CLI has been retired: new or updated workers can't use `gemini`. |
| Parallel prompts | Sub-sessions share one filesystem — avoid writing the same files from parallel prompts. |
| Knowledge base writes | Read-only during a session except `learnings/`; changes go to a per-session branch for review. |
| Access | Internal to the cluster by default. |

## Troubleshooting

### Session stays `pending`

The workspace container can't start. Common causes: the runtime's `vwImage` can't be pulled, CLI credentials are missing, or the session repository can't be cloned (wrong URL/branch or no access). Check the runtime and worker configuration, then ask your administrator to check the workspace container's events and logs.

### `404` "Worker not found" / SDK can't resolve the worker

Worker names are case-sensitive. List them with `GET /admin/workers` and make sure the SDK points at the same VWM instance.

### `409` "Session is not active"

The session was ended or is not yet active. Poll `GET /sessions/:id` until `active`, or start a new session. In the SDK, don't use a `VWSession` after calling `end()`.

### `400` Validation Error

Read the `details` array — it names the invalid field (for example an unsupported `cliType`).

### `503` from `/ready`

VWM is running but one of its dependencies is unavailable. New sessions will fail until it recovers; report it to your administrator.

### Streaming ends with no final response

The SSE stream closed without a `complete` event (the SDK reports `[No response received]`). Check whether the prompt timed out or was aborted, and look at the session's telemetry for that request.

### Worker can't use platform tools

Check the worker's `mcpServers` entry points at the MCP Gateway for your namespace, and that the gateway is enabled. See [MCP Gateway](../mcp-gateway/README.md).

### Learnings or code changes missing

Changes are pushed to per-session branches when the session **ends**. Make sure your app ends sessions (`DELETE /sessions/:id` or `session.end()`), and look for the session branch rather than the base branch.

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [Virtual Worker SDK Feature Guide](../../../sdk/agent_sdk/feature_guides/virtual-worker-sdk.md)
