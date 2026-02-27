# Part 4: BFF Layer & OIDC Authentication

In [Part 3](./part-03-consumer-gui.md) you built a Next.js frontend that calls the agent bundle directly from the browser — fine for local development, but not for production. In this part, you'll add an **Express backend** between the GUI and the bundle that handles:

- **OIDC login** via `@firebrandanalytics/app_backend_accelerator`
- **Session-based identity** — every API call carries the logged-in user's identity
- **Server-side proxy** — bundle URLs and API keys never reach the browser
- **Actor tracking** — the GUI displays who performed each action

**What you'll learn:**
- Using `FFExpressApp` and `FFRouteManager` from the app backend accelerator
- Writing `BaseController` subclasses that inject `actor_id` from the session
- Configuring dev mode (no auth) vs. production mode (OIDC)
- Updating the GUI to work with the BFF

**What you'll build:** A `crm-backend` Express app that sits between the GUI and the bundle.

---

## Architecture

```
┌──────────────────────────────────┐
│   CRM GUI (Next.js + React 19)  │
│   Port 3002                      │
└────────────┬─────────────────────┘
             │ fetch('/api/v1/...')
             ▼
┌──────────────────────────────────┐
│   CRM Backend (Express BFF)     │
│   Port 3001                      │
│   OIDC session · actor_id       │
│   RemoteAgentBundleClient       │
└────────────┬─────────────────────┘
             │ Bundle API
             ▼
┌──────────────────┐  ┌──────────────────┐
│ CRM Agent Bundle │─→│ Notification Svc │
│ :3000            │  │ :8085            │
└──────────────────┘  └──────────────────┘
```

In Part 3, the browser talked to the bundle directly. Now the browser only talks to the BFF, which:
1. Authenticates the user via OIDC (when `AUTH_PROVIDER` is set)
2. Extracts the user's email from the session
3. Injects `actor_id` into every request before forwarding to the bundle

> **Note:** The notification service is called from the bundle during email workflows (Part 5), not from the BFF. The GUI triggers workflows; it never sends emails directly.

---

## Project Setup

Add the new app to the monorepo:

```
crm/
├── apps/
│   ├── crm-bundle/       # Agent bundle (Part 2)
│   ├── crm-backend/      # Express BFF (this part)
│   └── crm-gui/          # Consumer GUI (Part 3)
├── packages/
│   └── shared-types/
├── pnpm-workspace.yaml
└── turbo.json
```

```bash
mkdir -p apps/crm-backend/src/controllers
```

```json
// apps/crm-backend/package.json
{
  "name": "@apps/crm-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --import tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@firebrandanalytics/app_backend_accelerator": "^2.7.3",
    "@firebrandanalytics/ff-sdk": "^3.1.1",
    "@shared/types": "workspace:*"
  },
  "devDependencies": {
    "@types/express": "^5",
    "@types/express-session": "^1.18.1",
    "@types/node": "^22",
    "tsx": "^4.19.0",
    "typescript": "^5.7.2"
  }
}
```

Two key dependencies:
- **`app_backend_accelerator`** — the Express framework with OIDC, session management, and route layers
- **`ff-sdk`** — provides `RemoteAgentBundleClient` for server-side bundle calls

---

## The App Backend Accelerator

The accelerator provides an opinionated Express application lifecycle:

```
FFExpressApp.init()
  ├── initPreAuth()        ← session, CORS, body parsers
  ├── initUserProvider()   ← your user storage
  ├── initAuth()           ← OIDC via passport-openidconnect
  └── initRouteManager()   ← your controllers and routes
```

Your CRM backend overrides three of these hooks.

### CrmApp — The Application Shell

```typescript
// src/CrmApp.ts
import {
  FFExpressApp,
  FFEntityProvider,
  FFEntityDTOProvider,
} from '@firebrandanalytics/app_backend_accelerator';
import { CrmRouteManager } from './CrmRouteManager.js';
import { CrmUserProvider } from './CrmUserProvider.js';
import { getBundleClient } from './bundle-client.js';

export class CrmApp extends FFExpressApp<FFEntityProvider, FFEntityDTOProvider> {
  protected initUserProvider(): void {
    this.user_provider = new CrmUserProvider();
  }

  /**
   * Only initialise OIDC when AUTH_PROVIDER is set.
   * In dev mode, skip authentication entirely.
   */
  protected initAuth(): void {
    if (process.env.AUTH_PROVIDER) {
      super.initAuth();
    }
    // else: no-op — dev mode, no login required
  }

  protected initRouteManager(): void {
    const entityProvider = new FFEntityProvider('crm-bundle');
    const entityDtoProvider = new FFEntityDTOProvider();
    const requireAuth = !!process.env.AUTH_PROVIDER;

    this.routeManager = new CrmRouteManager(
      this.app,
      entityProvider,
      entityDtoProvider,
      this.user_provider,
      requireAuth,
    );
  }

  protected async healthCheck() {
    const BUNDLE_URL = process.env.BUNDLE_URL || 'http://localhost:3000';
    try {
      const res = await fetch(`${BUNDLE_URL}/health`);
      const bundleHealth = await res.json() as any;
      return {
        healthy: true,
        timestamp: new Date().toISOString(),
        details: {
          bundle: bundleHealth?.healthy ? 'healthy' : 'unknown',
        },
      };
    } catch {
      return {
        healthy: false,
        message: 'Agent bundle unreachable',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
```

**Key decisions:**
- `initAuth()` — skip OIDC when `AUTH_PROVIDER` isn't set, so local dev doesn't require identity provider configuration
- `FFEntityProvider('crm-bundle')` — the entity provider requires the agent bundle name
- `healthCheck()` — probes the bundle's `/health` endpoint and reports upstream status

### The Bundle Client

The `RemoteAgentBundleClient` from `ff-sdk` handles server-side HTTP calls to the bundle:

```typescript
// src/bundle-client.ts
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://localhost:3000';
const API_KEY = process.env.FIREFOUNDRY_API_KEY;

let client: RemoteAgentBundleClient | null = null;

export function getBundleClient(): RemoteAgentBundleClient {
  if (!client) {
    client = new RemoteAgentBundleClient(BUNDLE_URL, {
      api_key: API_KEY,
      timeout: 120_000,
    });
  }
  return client;
}
```

The client is a lazy singleton — created once on first use. In production, the `BUNDLE_URL` points to the in-cluster service URL.

For the notification service, a simple `fetch` wrapper handles email delivery:

```typescript
const NOTIF_URL = process.env.NOTIF_URL || 'http://localhost:8085';

export async function callNotificationService<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${NOTIF_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notification service error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
```

---

## Route Manager and Controllers

### CrmRouteManager

The route manager registers all controllers and configures static file serving:

```typescript
// src/CrmRouteManager.ts
import {
  FFRouteManager,
  FFEntityProvider,
  FFEntityDTOProvider,
  type IUserProvider,
} from '@firebrandanalytics/app_backend_accelerator';
import type express from 'express';
import { ContactsController } from './controllers/ContactsController.js';
import { TemplatesController } from './controllers/TemplatesController.js';
import { DraftsController } from './controllers/DraftsController.js';
import { CampaignsController } from './controllers/CampaignsController.js';
import { getBundleClient } from './bundle-client.js';

export class CrmRouteManager extends FFRouteManager<FFEntityProvider, FFEntityDTOProvider> {
  constructor(
    app: express.Application,
    entityProvider: FFEntityProvider,
    entityDtoProvider: FFEntityDTOProvider,
    userProvider: IUserProvider,
    requireAuth: boolean,
  ) {
    super(app, entityProvider, entityDtoProvider, userProvider, requireAuth, {
      mode: 'nextjs-export',
      publicPath: '../crm-gui/out',
    });

    const client = getBundleClient();

    this.controllers.push(
      new ContactsController(client, requireAuth),
      new TemplatesController(client, requireAuth),
      new DraftsController(client, requireAuth),
      new CampaignsController(client, requireAuth),
    );
  }
}
```

**Key points:**
- `{ mode: 'nextjs-export', publicPath: '../crm-gui/out' }` — in production, the Express server serves the Next.js static export
- Each controller receives the `RemoteAgentBundleClient` and a `requireAuth` flag

### The Controller Pattern: Injecting Actor Identity

Every controller follows the same pattern. Here's `ContactsController` — the most complex one:

```typescript
// src/controllers/ContactsController.ts
import type { Request, Response } from 'express';
import { BaseController } from '@firebrandanalytics/app_backend_accelerator';
import type { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

const DEV_ACTOR_ID = process.env.DEV_ACTOR_ID || 'test@example.com';

export class ContactsController extends BaseController {
  private client: RemoteAgentBundleClient;
  private requireAuth: boolean;

  constructor(client: RemoteAgentBundleClient, requireAuth: boolean) {
    super('/contacts');
    this.client = client;
    this.requireAuth = requireAuth;
  }

  public initializeRoutes(): void {
    this.router.get('/', this.asyncHandler(this.listContacts.bind(this)));
    this.router.post('/', this.asyncHandler(this.createContact.bind(this)));
    this.router.post('/note', this.asyncHandler(this.addNote.bind(this)));
    this.router.post('/interaction', this.asyncHandler(this.logInteraction.bind(this)));
    this.router.post('/summarize', this.asyncHandler(this.summarize.bind(this)));
  }

  private getActorId(req: Request): string {
    if (this.requireAuth) {
      const user = (req.session as any)?.passport?.user;
      return user?.email || user?.id || DEV_ACTOR_ID;
    }
    return DEV_ACTOR_ID;
  }

  private async createContact(req: Request, res: Response) {
    const body = { ...req.body, actor_id: this.getActorId(req) };
    const result = await this.client.call_api_endpoint('contacts', {
      method: 'POST', body,
    });
    res.json(result);
  }

  private async addNote(req: Request, res: Response) {
    const body = { ...req.body, actor_id: this.getActorId(req) };
    const result = await this.client.call_api_endpoint('contacts/note', {
      method: 'POST', body,
    });
    res.json(result);
  }

  // logInteraction, summarize follow the same pattern...
}
```

**The `getActorId` method is the key pattern.** It:
1. Checks if auth is enabled (`requireAuth`)
2. If yes, extracts the user email from the OIDC session (`req.session.passport.user`)
3. Falls back to `DEV_ACTOR_ID` — configurable via environment variable

Every write method spreads the request body and adds `actor_id`:
```typescript
const body = { ...req.body, actor_id: this.getActorId(req) };
```

The GUI never sends `actor_id` — the BFF always injects it. This means a malicious client can't impersonate another user.

### Other Controllers

The remaining controllers are simpler — each has one or two endpoints that follow the same `getActorId` + forward pattern:

| Controller | Path | Endpoints | Notes |
|-----------|------|-----------|-------|
| `ContactsController` | `/contacts` | GET `/`, POST `/`, `/note`, `/interaction`, `/summarize` | Most complex — 5 endpoints |
| `TemplatesController` | `/templates` | POST `/generate`, `/approve` | HITL approval flow |
| `DraftsController` | `/drafts` | POST `/personalize`, `/personalize-and-send` | Preview and send workflows |
| `CampaignsController` | `/campaigns` | POST `/`, `/execute` | Create and execute campaigns |

> **Note:** There is no `EmailController` — email delivery happens inside the agent bundle as part of entity graph workflows. The BFF proxies the `personalize-and-send` and `campaigns/execute` endpoints, which trigger the bundle to generate AI content and call the notification service directly. See [Part 5](./part-05-email-workflows.md) for details.

---

## Updating the GUI

The GUI changes are minimal. The key differences from Part 3:

### API Client: Relative Paths

The API client no longer needs bundle/notification URLs — everything goes through the BFF:

```typescript
// src/lib/api.ts
async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// All paths are now relative — BFF handles routing
export async function createContact(data: { ... }) {
  return request<any>('/api/v1/contacts', {
    method: 'POST', body: JSON.stringify(data),
  });
}
```

**What changed:**
- No more `NEXT_PUBLIC_BUNDLE_URL` or `NEXT_PUBLIC_NOTIF_URL` — the BFF URL is same-origin
- No more `actor_id` in function signatures — the BFF injects it
- Paths changed from `/api/contacts` to `/api/v1/contacts` (the accelerator mounts controllers under `/api/v1/`)

### Session Endpoint

The BFF provides a session endpoint that the GUI calls on mount:

```typescript
export interface SessionData {
  id: string;
  email?: string;
  display_name?: string;
}

export async function getSession(): Promise<SessionData> {
  return request<SessionData>('/api/v1/session');
}
```

### Next.js Config: Dev Proxy

In development, the GUI dev server proxies API calls to the backend:

```javascript
// next.config.mjs
const isDev = process.env.NODE_ENV !== 'production';
const backendPort = process.env.BACKEND_PORT || '3001';

const nextConfig = {
  ...(!isDev && { output: 'export' }),
  ...(isDev && {
    rewrites: async () => [
      { source: '/api/v1/:path*', destination: `http://localhost:${backendPort}/api/v1/:path*` },
      { source: '/health', destination: `http://localhost:${backendPort}/health` },
      { source: '/login', destination: `http://localhost:${backendPort}/login` },
      { source: '/logout', destination: `http://localhost:${backendPort}/logout` },
    ],
  }),
};
```

In production, `output: 'export'` generates a static site that the Express BFF serves directly.

### Displaying Actor Identity

The GUI now shows who performed each action using an `ActorBadge` component:

```typescript
function ActorBadge({ actorId }: { actorId?: string }) {
  if (!actorId) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-crm-muted">
      <User className="w-3 h-3" /> {actorId}
    </span>
  );
}
```

This appears on:
- **Contact list items** — who created each contact
- **Note results** — who added the note
- **Interaction alerts** — who logged the interaction
- **Template cards** — who generated the template
- **Draft cards** — who personalized the draft
- **Email send results** — who sent the email
- **Campaign cards** — who created the campaign

Every bundle response includes `actor_id` in its payload (set by the BFF), so the GUI simply reads it from the response and displays it.

---

## User Provider

The accelerator requires an `IUserProvider` for storing user records after OIDC login:

```typescript
// src/CrmUserProvider.ts
import { type IUserProvider, UserRecord } from '@firebrandanalytics/app_backend_accelerator';

export class CrmUserProvider implements IUserProvider {
  private users = new Map<string, UserRecord>();

  async upsertUser(user: Partial<UserRecord>): Promise<UserRecord> {
    const existing = user.openid ? this.users.get(user.openid) : undefined;
    const record: UserRecord = {
      id: existing?.id || crypto.randomUUID(),
      openid: user.openid || '',
      email: user.email || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      user_name: user.user_name || '',
      display_name: user.display_name || '',
      groups: user.groups || [],
      created: existing?.created || new Date(),
      modified: new Date(),
    };
    this.users.set(record.openid!, record);
    return record;
  }

  async getUserByOpenId(openId: string): Promise<UserRecord> {
    const user = this.users.get(openId);
    if (!user) throw new Error(`User not found: ${openId}`);
    return user;
  }

  trackUserAction(_userId: string, _action: string): void {}
}
```

This is an in-memory implementation suitable for the demo. In production, you'd store user records in a database.

---

## Entry Point

```typescript
// src/index.ts
import { CrmApp } from './CrmApp.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
process.env.PORT = String(PORT);
process.env.CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || `http://localhost:${PORT}`;

async function main() {
  const app = new CrmApp();
  await app.init();
  await app.start();

  console.log(`CRM Backend running on port ${PORT}`);
  if (!process.env.AUTH_PROVIDER) {
    console.log(`  Auth: DISABLED (dev mode)`);
  } else {
    console.log(`  Auth: ${process.env.AUTH_PROVIDER}`);
    console.log(`  Login: http://localhost:${PORT}/login`);
  }
}

main().catch((err) => {
  console.error('Failed to start CRM backend:', err);
  process.exit(1);
});
```

---

## Running the Full Stack

You now have three services:

```bash
# Terminal 1: Agent bundle (port 3000)
cd apps/crm-bundle
PORT=3000 pnpm dev

# Terminal 2: BFF backend (port 3001)
cd apps/crm-backend
pnpm dev

# Terminal 3: GUI dev server (port 3002)
cd apps/crm-gui
pnpm dev
```

Or from the monorepo root:

```bash
pnpm dev         # Runs all three via turbo
```

### Dev Mode vs. Production Mode

| | Dev Mode | Production Mode |
|--|---------|----------------|
| `AUTH_PROVIDER` | Not set | `azure-b2c`, `azure-entraid`, or `gcp` |
| Authentication | Skipped — `DEV_ACTOR_ID` used | OIDC login required |
| GUI serving | Next.js dev server with rewrites | Express serves static export |
| Actor identity | `test@example.com` (configurable) | Email from OIDC token |

### Checkpoint: Verify Full Stack

1. Start all three services
2. Open `http://localhost:3002`
3. Check health in the header — should show green (verifies BFF → bundle connection)
4. Create a contact — the success message should show "Contact created by test@example.com"
5. Add a note with enrichment — the note result should show the actor badge
6. Generate and approve a template — the template card footer shows the actor
7. Personalize and send an email — the send result shows "Sent by: test@example.com"

### Verify with ff-sdk-cli

```bash
# Call through the BFF (not the bundle directly)
ff-sdk-cli api call contacts --method GET --url http://localhost:3001/api/v1

# Check the entity graph for actor_id
ff-eg-read entities --type Contact --limit 5
```

---

## Enabling OIDC (Production)

To enable real authentication, set these environment variables on the BFF:

```bash
# Azure AD B2C example
AUTH_PROVIDER=azure-b2c
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_TENANT_ID=your-tenant-id
CALLBACK_BASE_URL=https://your-app.example.com
EXPRESS_SESSION_SECRET=a-strong-random-secret
```

The accelerator handles the rest — login redirect, callback, token validation, session creation, and user record upsert via your `CrmUserProvider`.

---

## Summary

You've built a 3-tier CRM application:

| Layer | App | Port | Role |
|-------|-----|------|------|
| Frontend | `crm-gui` | 3002 | React SPA — tabs, forms, results display |
| BFF | `crm-backend` | 3001 | Auth, session, actor_id injection, proxy |
| Backend | `crm-bundle` | 3000 | Entities, bots, API endpoints |

**What the BFF provides:**
- **Security** — bundle URLs and API keys are server-side only
- **Identity** — every action is attributed to a logged-in user
- **Consistency** — one pattern for all controllers: `getActorId` + forward
- **Flexibility** — dev mode works without any identity provider

**What we didn't do:**
- Role-based access control (all authenticated users have full access)
- Rate limiting or request validation in the BFF
- Persistent user storage (in-memory is fine for the demo)

These are production concerns you'd add when deploying to a real environment.

### Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `crm/`.

---

**Next up:** [Part 5](./part-05-email-workflows.md) connects the bundle to the notification service so that AI-generated emails are sent as part of entity graph workflows. Then [Part 6](./part-06-campaign-execution.md) scales this up to parallel campaign execution.
