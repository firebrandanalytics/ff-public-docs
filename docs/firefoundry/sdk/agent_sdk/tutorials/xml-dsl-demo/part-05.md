# Part 5: Ship It: xml-bundle-server and the Fleet Model

By the end of this part, you will understand how the four DSL files from this tutorial deploy to Kubernetes without any TypeScript code, no image builds, and no bundle-specific Docker image. The xml-bundle-server fleet model treats DSL files as configuration, not code.

**What you'll learn:**
- How Kubernetes ConfigMaps deliver DSL files to the xml-bundle-server container
- How `BUNDLE_PATH` tells the server where to find the bundle manifest at startup
- How `bootstrapFromBundleML()` resolves sibling files relative to the manifest path
- How liveness and readiness probes verify the bundle is healthy
- How the fleet model works: one image, many ConfigMaps, many independent bundles

---

## The Deployment Architecture

The xml-bundle-server fleet model is built on a single insight: the bundle is data, not code. The Docker image contains the server runtime. The ConfigMap contains the DSL files. To deploy a different bundle, replace the ConfigMap — no image rebuild, no code review, no CI pipeline for bundle logic.

```
firebrandanalytics/xml-bundle-server:latest
          │
          │  reads at startup
          ▼
  /config/bundle.bundleml           ← mounted from ConfigMap
  /config/analysis-workflow.agentml ← same ConfigMap
  /config/analyzer-bot.botml        ← same ConfigMap
  /config/analyzer-prompt.promptml  ← same ConfigMap (not loaded, included for completeness)
          │
          │  bootstrapFromBundleML() parses and registers all components
          ▼
  HTTP server running on :3000
```

## Step 1: The Kubernetes ConfigMap

The ConfigMap embeds all DSL files as string values under named keys. Each key becomes a filename when the ConfigMap is mounted as a volume.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: xml-dsl-demo-bundle
  namespace: ff-dev
data:
  bundle.bundleml: |
    <bundle id="558707ed-d548-4a68-a384-1bf18f6da676"
            name="XML DSL Content Analyzer"
            description="Zero-TypeScript content analysis bundle demonstrating all four FireFoundry XML DSLs">
      <config><port>3000</port></config>
      <constructors>
        <entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>
        <bot type="AnalyzerBot" ref="analyzer-bot.botml"/>
      </constructors>
      <!-- endpoints omitted for brevity — see bundle.bundleml in source -->
    </bundle>

  analysis-workflow.agentml: |
    <agent id="AnalysisWorkflow">
      <!-- full file contents -->
    </agent>

  analyzer-bot.botml: |
    <bot id="AnalyzerBot" name="AnalyzerBot" max-tries="2">
      <!-- full file contents -->
    </bot>

  analyzer-prompt.promptml: |
    <prompt-group>
      <!-- full file contents — included for documentation; not auto-loaded at runtime -->
    </prompt-group>
```

When this ConfigMap is mounted at `/config/`, Kubernetes creates four files in that directory: `bundle.bundleml`, `analysis-workflow.agentml`, `analyzer-bot.botml`, and `analyzer-prompt.promptml`. The xml-bundle-server reads `BUNDLE_PATH=/config/bundle.bundleml` and resolves all `ref` attributes relative to `/config/`.

The `<constructors>` block in `bundle.bundleml` uses relative `ref` paths for exactly this reason:

```xml
<constructors>
  <entity type="AnalysisWorkflow" ref="analysis-workflow.agentml"/>
  <bot type="AnalyzerBot" ref="analyzer-bot.botml"/>
</constructors>
```

`bootstrapFromBundleML()` joins `/config/` (the parent directory of `BUNDLE_PATH`) with each `ref` value to produce the full sibling paths `/config/analysis-workflow.agentml` and `/config/analyzer-bot.botml`. All four DSL files must be in the same directory for this resolution to work.

This is why all four DSL files must be in the same directory: `bootstrapFromBundleML()` resolves siblings by joining the parent directory of the manifest path with each `ref` value.

## Step 2: The Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: xml-dsl-demo-bundle
  namespace: ff-dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: xml-dsl-demo-bundle
  template:
    metadata:
      labels:
        app: xml-dsl-demo-bundle
    spec:
      containers:
        - name: xml-bundle-server
          image: firebrandanalytics/xml-bundle-server:latest
          ports:
            - containerPort: 3000
          env:
            - name: BUNDLE_PATH
              value: /config/bundle.bundleml
            - name: PG_SERVER
              valueFrom:
                configMapKeyRef:
                  name: xml-bundle-server-config
                  key: PG_SERVER
            - name: USE_REMOTE_ENTITY_CLIENT
              value: "true"
          volumeMounts:
            - name: bundle-config
              mountPath: /config
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
      volumes:
        - name: bundle-config
          configMap:
            name: xml-dsl-demo-bundle
---
apiVersion: v1
kind: Service
metadata:
  name: xml-dsl-demo-bundle
  namespace: ff-dev
spec:
  selector:
    app: xml-dsl-demo-bundle
  ports:
    - port: 3000
      targetPort: 3000
```

Key points in this manifest:

**`BUNDLE_PATH=/config/bundle.bundleml`**: The single required environment variable that tells the server where to start. Every sibling file is resolved relative to this path's directory (`/config/`).

**`volumeMounts` + `volumes`**: The ConfigMap named `xml-dsl-demo-bundle` is mounted as a directory at `/config`. Kubernetes populates the directory with one file per ConfigMap key.

**`livenessProbe` at `/health`**: The xml-bundle-server responds to `GET /health` with a 200 once the HTTP server is running. Kubernetes uses this to detect if the process has hung and should be restarted.

**`readinessProbe` at `/ready`**: The xml-bundle-server responds to `GET /ready` with a 200 once all components have been registered and the bundle is ready to serve traffic. During `bootstrapFromBundleML()`, the readiness endpoint returns 503 — Kubernetes will not send traffic to the pod until it returns 200.

## Step 3: Deploy with Helm

The bundle ships a Helm chart in `apps/xml-dsl-bundle/helm/`. The chart wraps the ConfigMap and Deployment manifests into parameterized templates.

```bash
# Deploy to the ff-dev namespace
helm install xml-dsl-demo ./apps/xml-dsl-bundle/helm \
  --namespace ff-dev \
  -f apps/xml-dsl-bundle/helm/values.yaml \
  -f apps/xml-dsl-bundle/helm/values.local.yaml

# Or use ff ops if configured in your cluster:
ff ops deploy -f apps/xml-dsl-bundle/helm/values.local.yaml
```

To deploy an isolated WS#22 clone (avoids colliding with a stable deployment in the same namespace):

```bash
helm install xml-dsl-demo-ws22 ./apps/xml-dsl-bundle/helm \
  --namespace ff-dev \
  -f apps/xml-dsl-bundle/helm/values.yaml \
  -f apps/xml-dsl-bundle/helm/values.local.yaml
```

The `values.local.yaml` file is empty by default (0 bytes). Add overrides there for local testing — for example, to pin the image tag or adjust replica count — without modifying the committed `values.yaml`.

## Step 4: Verify the Deployed Bundle

Once the pod reaches `Running` status and the readiness probe passes:

```bash
# Check pod status
kubectl get pods -n ff-dev -l app=xml-dsl-demo-bundle

# Wait for rollout to complete (readiness probe must pass first)
kubectl rollout status deployment/xml-dsl-demo-bundle -n ff-dev
```

To inspect the bundle's registered components, port-forward to the pod and open `http://localhost:3000/api/dsl-info` in your browser:

```bash
kubectl port-forward -n ff-dev deployment/xml-dsl-demo-bundle 3000:3000
```

Expected dsl-info response:
```json
{
  "bundle": "xml-dsl-content-analyzer",
  "dsls_loaded": ["PromptML", "BotML", "AgentML", "BundleML"],
  "deployment": "xml-bundle-server (zero TypeScript)"
}
```

## The Fleet Model in Practice

The value of this architecture becomes clear when you consider the full fleet: a single `xml-bundle-server` image serves every XML DSL bundle in the cluster. Each deployment differs only in which ConfigMap it mounts.

```
firebrandanalytics/xml-bundle-server:latest
    │
    ├── Deployment: xml-dsl-demo-bundle       → ConfigMap: xml-dsl-demo-bundle
    ├── Deployment: sentiment-analyzer-bundle  → ConfigMap: sentiment-analyzer-bundle
    ├── Deployment: document-tagger-bundle     → ConfigMap: document-tagger-bundle
    └── Deployment: classifier-bundle         → ConfigMap: classifier-bundle
```

To add a new endpoint to this bundle: edit `bundle.bundleml` in the ConfigMap, apply the updated ConfigMap with `kubectl apply`, and restart the deployment (`kubectl rollout restart`). No code review for the server. No Docker build. No image push.

To create a completely different bundle: write new DSL files, create a new ConfigMap, create a new Deployment pointing at the same image with the new ConfigMap. Total time from idea to deployed bundle: minutes.

## Run and Verify

Confirm the pod is running and the bundle is healthy:

```bash
# Verify pod status
kubectl get pods -n ff-dev -l app=xml-dsl-demo-bundle

# Confirm rollout completed (readinessProbe at /ready must pass)
kubectl rollout status deployment/xml-dsl-demo-bundle -n ff-dev
```

Expected: `deployment "xml-dsl-demo-bundle" successfully rolled out`.

Port-forward to the pod and open `http://localhost:3000/api/dsl-info` in your browser to confirm `bootstrapFromBundleML()` completed successfully:

```bash
kubectl port-forward -n ff-dev deployment/xml-dsl-demo-bundle 3000:3000
```

Expected: the browser displays `dsls_loaded: ["PromptML", "BotML", "AgentML", "BundleML"]`. A successful rollout means both `/health` (liveness) and `/ready` (readiness) returned 200 — the Kubernetes probes verified this automatically before the deployment completed.

---

**Tour complete.** You have traced the Content Analyzer from a docker run command through BundleML wiring, AgentML workflow orchestration, BotML LLM configuration, and Kubernetes ConfigMap deployment.

To go deeper:

- **[Advanced Patterns Tutorial](../../dsl/advanced-patterns-tutorial.md)** — conditionals, loops, mixins, entity orchestration, error handling in AgentML and PromptML
- **[BundleML Reference](../../dsl/reference/bundleml-reference.md)** — complete element and attribute reference
- **[AgentML Reference](../../dsl/reference/agentml-reference.md)** — all AgentML instructions documented
- **[BotML Reference](../../dsl/reference/botml-reference.md)** — full BotML attribute and element reference
- **[Getting Started Tutorial](../../dsl/getting-started-tutorial.md)** — build a bundle from scratch with all four DSLs
