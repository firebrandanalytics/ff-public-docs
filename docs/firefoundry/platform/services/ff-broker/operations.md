# FF Broker — Operations for App Builders

How to enable and configure the broker for your app, verify your bundle can reach it, the limits to design around, and how to troubleshoot from the caller's side.

## Enabling the Broker

The broker is part of `firefoundry-core` and is **enabled by default**:

```yaml
# firefoundry-core values
ff-broker:
  enabled: true
```

Your environment administrator installs and upgrades it. What your app team configures is:

| What | How |
|------|-----|
| Provider credentials | `ff-cli env broker-secret add <env> --key <NAME> --value <key> -y` |
| Model pools | `ff-cli env broker-config create <env> -f <pool>.json` (or `POST /api/config/setup`) |
| Bundle → broker connection | `LLM_BROKER_HOST` / `LLM_BROKER_PORT` in your bundle's Helm values |
| Advanced routing features (capacity limits, quotas, QoS, sticky routing) | Requested from your environment administrator; see [Concepts](./concepts.md#environment-level-routing-features) |

Keep pool names identical across your environments (dev, staging, production) so the same bundle image runs everywhere.

## Configuring Your Bundle

```yaml
# helm/values.local.yaml (agent bundle)
configMap:
  data:
    LLM_BROKER_HOST: "firefoundry-core-ff-broker"
    LLM_BROKER_PORT: "50051"
```

If your bundle runs in a different namespace from `firefoundry-core`, use the fully qualified host, e.g. `firefoundry-core-ff-broker.<namespace>.svc.cluster.local`. The port must match the broker Service's gRPC port, which is `50051` in a default install — check with `kubectl get svc -n <env> firefoundry-core-ff-broker`.

## Configuration Changes

The broker caches model pool configuration. After you create or change a pool, allow up to about **five minutes** before requests use the new configuration (or ask your administrator to restart the broker). New pools that return `NOT_FOUND` right after creation usually just need this interval.

## Verifying

```bash
# 1. Broker pod is running
kubectl get pods -n ff-test -l app.kubernetes.io/name=ff-broker

# 2. HTTP health
kubectl port-forward -n ff-test svc/firefoundry-core-ff-broker 3000:3000
curl http://localhost:3000/health
# {"status":"ok",...}

# 3. Your pool exists
ff-cli env broker-config show ff-test --model-group gemini_completion

# 4. A real completion through the pool
kubectl port-forward -n ff-test svc/firefoundry-core-ff-broker 50051:50051
ff-brk complete --port 50051 -m gemini_completion -l health-check --msg "ping"
```

Then call an endpoint in your bundle that runs a bot, and confirm the call appears in the Console or via `ff-telemetry-read`.

## Limits and Behavior to Design Around

- **Failover only within a pool.** A single-deployment pool has none. Use two or more deployments for user-facing work.
- **Non-retryable errors come straight back.** Invalid requests and content-filter rejections are not retried on another deployment.
- **Model hint is not a pin.** The `model` field doesn't guarantee which model answers; control that through pool membership.
- **Embeddings use numeric group IDs.** Look the ID up per environment rather than hard-coding it, or pass it in via configuration.
- **Images are returned by reference.** Generated images live in the environment's blob storage; your code receives blob IDs/keys, not bytes.
- **Capacity and quota rejections are immediate.** When the environment has capacity limits or quotas enabled, excess calls fail with `RESOURCE_EXHAUSTED` instead of waiting. Bound your parallelism and retry with exponential backoff.
- **Config propagation delay.** Pool changes can take up to ~5 minutes to apply.
- **Internal only.** The broker isn't exposed outside the cluster by default; call it from bundles or through a port-forward.

## Troubleshooting

### `MockBrokerClient` in bundle logs

The SDK didn't find broker settings and fell back to a mock client. Set `LLM_BROKER_HOST` and `LLM_BROKER_PORT` in the bundle's values file, redeploy, and restart the pod if the image tag didn't change.

### Bot calls hang or time out

Usually a wrong `LLM_BROKER_PORT`. Confirm the broker Service port (`50051` by default) and match it. The broker speaks gRPC on that port; an HTTP request to it will not work. See also [Local Development Troubleshooting](../../../local-development/troubleshooting.md).

### `NOT_FOUND` for a model pool

- Check the exact pool name: `ff-cli env broker-config list` / `show`.
- A pool created moments ago may not be routable yet (see [Configuration Changes](#configuration-changes)).
- Embedding calls need the pool's numeric ID, not its name.

### `PERMISSION_DENIED` or provider auth errors

The provider key referenced by the pool's `env_var_name` is missing or wrong. Re-add it with `ff-cli env broker-secret add` using the exact key name, and ask your administrator to restart the broker if the value doesn't take effect.

### Frequent `RESOURCE_EXHAUSTED`

- Provider rate limits: add deployments (other regions/providers) to the pool.
- Environment capacity limits or quotas: reduce concurrent calls from your bundle, spread batch work over time, or ask your administrator to raise limits for your workload.

### Unexpected model in responses

Failover or load spreading picked another deployment in the pool. If you need one specific model, make it the only member of a dedicated pool.

### Slow responses

Check per-call latency and time-to-first-token in telemetry. Consider a faster model in a separate pool for latency-sensitive steps, and stream responses to users rather than waiting for completion.

## Related

- [Overview](./README.md)
- [Getting Started](./getting-started.md)
- [Reference](./reference.md)
- [ff-brk CLI](../../../sdk/cli-tools/ff-brk.md)
- [ff-telemetry-read CLI](../../../sdk/cli-tools/ff-telemetry-read.md)
