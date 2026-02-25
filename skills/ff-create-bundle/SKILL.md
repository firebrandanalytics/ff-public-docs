---
name: ff-create-bundle
description: Scaffold and implement a FireFoundry agent bundle (SDK v4)
user_invocable: true
argument: bundle name (e.g. my-bot)
---

# Create a FireFoundry Agent Bundle

Scaffold a new agent bundle in an existing FireFoundry application monorepo, then implement it with custom endpoints using SDK v4 patterns.

## 1. Resolve context

Use the provided argument as the bundle name. If not provided, ask the user.

Determine if we're inside an existing application monorepo by checking for `package.json` with `"workspaces"` and a `turbo.json` at the current directory or a parent. If not in a monorepo, create one first:

```bash
ff-cli application create <app-name>
cd <app-name>
```

## 2. Scaffold the agent bundle

```bash
ff-cli agent-bundle create <bundle-name>
```

Expected output: Bundle created at `apps/<bundle-name>/` with `src/`, `Dockerfile`, `firefoundry.json`, `package.json`, `helm/values.local.yaml`, `AGENTS.md`.

## 3. Configure values

Edit `apps/<bundle-name>/helm/values.local.yaml`.

**Set the environment name** (the Kubernetes namespace where FireFoundry Core runs):

```yaml
global:
  environment: "<env-name>"  # your environment namespace (e.g. ff-dev)
```

**Add required environment variables** to `configMap.data`:

Get the database credentials from the shared resources:

```bash
# Get PG config
kubectl get configmap firefoundry-core-database-config -n <env-name> -o jsonpath='{.data}' | python3 -m json.tool

# Get PG passwords
kubectl get secret firefoundry-core-database-secret -n <env-name> -o jsonpath='{.data}' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(f'{k}={base64.b64decode(v).decode()}') for k,v in d.items()]"
```

Ensure these are all present in `configMap.data`:

```yaml
configMap:
  enabled: true
  data:
    # Database
    PG_HOST: firefoundry-core-postgresql
    PG_PORT: "5432"
    PG_DATABASE: firefoundry
    PG_SSL_DISABLED: "true"
    PG_SSL_MODE: disable
    # Entity service (SDK v4 — required for createEntityClient)
    REMOTE_ENTITY_SERVICE_URL: http://firefoundry-core-entity-service
    REMOTE_ENTITY_SERVICE_PORT: "8080"
    # Broker
    LLM_BROKER_HOST: firefoundry-core-ff-broker
    LLM_BROKER_PORT: "50051"
    # Other services
    CODE_SANDBOX_HOST: firefoundry-core-code-sandbox
    CODE_SANDBOX_PORT: "3000"
    CONTEXT_SERVICE_ADDRESS: http://firefoundry-core-context-service:50051
    # Runtime
    PORT: "3000"
    NODE_ENV: development
    CONSOLE_LOG_LEVEL: debug
    LOGGING_PROVIDER: none
    WEBSITE_HOSTNAME: dev
```

Add database passwords to `secret.data`:

```yaml
secret:
  enabled: true
  data:
    PG_PASSWORD: "<value from firefoundry-core-database-secret>"
    PG_INSERT_PASSWORD: "<value from firefoundry-core-database-secret>"
```

**Important**: `REMOTE_ENTITY_SERVICE_URL` and `REMOTE_ENTITY_SERVICE_PORT` are required for SDK v4's `createEntityClient()`. Without them, the bundle will fail to initialize.

## 4. Verify SDK dependencies

The scaffold pins current SDK versions. Verify `apps/<bundle-name>/package.json` has:

```json
{
  "dependencies": {
    "@firebrandanalytics/ff-agent-sdk": "^4.3.0",
    "@firebrandanalytics/shared-types": "^2.1.0"
  }
}
```

If you plan to add bots with structured output, also add:

```json
{
  "@firebrandanalytics/shared-utils": "^4.2.0",
  "zod": "^3.22.4"
}
```

## 5. Implement the bundle

Edit `apps/<bundle-name>/src/agent-bundle.ts`. The v4 pattern uses `createEntityClient` instead of `app_provider`, and the constructor DTO requires `application_id` and `type`:

```typescript
import {
  FFAgentBundle,
  ApiEndpoint,
  logger,
  createEntityClient,
} from "@firebrandanalytics/ff-agent-sdk";
import { <BundleName>Constructors } from "./constructors.js";

// Generate a UUID for your bundle (uuidgen or similar)
const APP_ID = "<your-app-uuid>";

export class <BundleName>AgentBundle extends FFAgentBundle<any> {
  private startedAt: string;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "<BundleName>",
        type: "agent_bundle",
        description: "<bundle description>",
      },
      <BundleName>Constructors,
      createEntityClient(APP_ID) as any
    );
    this.startedAt = new Date().toISOString();
  }

  override async init() {
    await super.init();
    logger.info("<BundleName> initialized!");
  }

  @ApiEndpoint({ method: "GET", route: "status" })
  async getStatus(): Promise<any> {
    return {
      status: "running",
      startedAt: this.startedAt,
      bundleName: "<bundle-name>",
    };
  }

  @ApiEndpoint({ method: "POST", route: "echo" })
  async echo(body: any = {}): Promise<any> {
    logger.info("Received request:", body);
    return { received: body, timestamp: new Date().toISOString() };
  }
}
```

### v4 constructor changes (breaking from v2)

- **`application_id`**: Required in the DTO. Use the same UUID as `id`.
- **`type: "agent_bundle"`**: Required in the DTO.
- **`createEntityClient(APP_ID)`**: Replaces `app_provider`. Uses `REMOTE_ENTITY_SERVICE_URL` env var to talk to entity-service. Cast to `any` because the generic types are complex.
- **`app_provider` is removed** in v4 — do not import it.

### Endpoint rules

- `@ApiEndpoint` routes are served under `/api/` prefix (e.g., route `"status"` becomes `/api/status`)
- POST endpoints receive `body` parameter, GET endpoints receive `query` parameter
- Return any JSON-serializable object
- Throw errors directly — the framework handles HTTP error responses

## 6. Register the application with entity-service

SDK v4 requires the application to exist in entity-service. The system application must also exist.

```bash
ff-cli application register <bundle-name> --namespace <env-name>
```

If the system application `a0000000-0000-0000-0000-000000000000` doesn't exist yet, register it first via the entity-service API:

```bash
# Port-forward to entity-service
kubectl port-forward -n <env-name> svc/firefoundry-core-entity-service 8080:8080 &

# Create system application (if not already present)
curl -s -X POST http://localhost:8080/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "id": "a0000000-0000-0000-0000-000000000000",
    "name": "System",
    "type": "system",
    "description": "System application"
  }'
```

The APP_ID in your code must match the application ID registered here.

## 7. Install dependencies and build

From the monorepo root:

```bash
pnpm install
pnpm run build
```

Both should succeed with no errors. If `pnpm install` fails with private npm package errors, check `.npmrc` for registry configuration — the FireFoundry packages are on GitHub npm and require authentication. Run `ff-cli auth npm` to configure access.

## 8. Next steps

The bundle is ready to build and deploy:

- Use `/ff-deploy-local` to build the Docker image, deploy to the cluster, and verify through Kong
- Use `/ff-add-bot` to add a bot with LLM integration
- Use `/ff-add-entity` to add domain entities
