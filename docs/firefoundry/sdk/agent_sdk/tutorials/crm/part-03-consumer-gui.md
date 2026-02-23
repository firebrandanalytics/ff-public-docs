# Part 3: Consumer GUI — Next.js Frontend

In [Part 2](./part-02-agent-bundle.md) you built a running CRM agent bundle with 4 AI bots and 9 API endpoints. Now we'll build a Next.js frontend that consumes those APIs, giving sales reps a visual interface for managing contacts, generating templates, previewing personalized drafts, and creating campaigns.

**What you'll learn:**
- Structuring a Next.js consumer app in the same monorepo as the agent bundle
- Building a typed API client layer that maps to bundle endpoints
- UI patterns for AI-powered workflows (loading states, enrichment results, HITL approval)

> **Note:** This part builds a working GUI that calls the bundle directly from the browser — good enough for local development and verifying your bundle works. [Part 4](./part-04-bff-and-authentication.md) upgrades this to a production architecture with a server-side BFF proxy and OIDC login.

**What you'll build:** A 4-tab CRM dashboard: Contacts, Templates, Personalize & Send, Campaigns.

---

## Architecture

```
┌──────────────────────────────────┐
│   CRM GUI (Next.js + React 19)  │
│   Port 3002                      │
└────────────┬─────────────────────┘
             │
  Bundle API │
             ▼
┌──────────────────┐
│ CRM Agent Bundle │
│ :3000            │
│ /api/contacts    │
│ /api/templates/* │
│ /api/drafts/*    │
│ /api/campaigns   │
│ /health          │
└──────────────────┘
```

The GUI talks to one service — the **CRM Agent Bundle** (port 3000). All entity operations, AI workflows, and email delivery go through the bundle. The notification service is called from the bundle, never from the GUI (see [Part 5](./part-05-email-workflows.md)).

The bundle URL is configurable via environment variable.

---

## Project Setup

The GUI lives in the same monorepo as the agent bundle:

```
crm/
├── apps/
│   ├── crm-bundle/       # Agent bundle (Part 2)
│   └── crm-gui/          # Consumer GUI (this part)
├── packages/
│   └── shared-types/     # Shared TypeScript interfaces
├── pnpm-workspace.yaml
└── turbo.json
```

```bash
# From the monorepo root
mkdir -p apps/crm-gui
cd apps/crm-gui
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir
```

Key dependencies:

```json
{
  "dependencies": {
    "@shared/types": "workspace:*",
    "next": "^15.3.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.460.0"
  }
}
```

The `@shared/types` workspace package holds TypeScript interfaces shared between the bundle and GUI — `ContactData`, `NoteEnrichmentOutput`, `EmailTemplateData`, etc.

---

## The API Client Layer

The API client is the bridge between the GUI and the backend services. It mirrors the bundle's `@ApiEndpoint` routes:

```typescript
// src/lib/api.ts
const BUNDLE_URL = process.env.NEXT_PUBLIC_BUNDLE_URL || 'http://localhost:3000';

async function request<T>(base: string, path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}
```

Then each endpoint gets a typed wrapper:

```typescript
// ── Bundle API ──────────────────────────────────────────────

export async function getHealth() {
  return request<any>(BUNDLE_URL, '/health');
}

export async function createContact(data: {
  first_name: string; last_name: string; email: string;
  phone?: string; company?: string; job_title?: string;
  tags?: string[]; actor_id: string;
}) {
  return request<any>(BUNDLE_URL, '/api/contacts', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function listContacts(tag?: string) {
  const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return request<{ contacts: any[]; count: number }>(BUNDLE_URL, `/api/contacts${qs}`);
}

export async function addNote(data: {
  contact_id: string; content: string; category?: string;
  actor_id: string; enrich?: boolean;
}) {
  return request<any>(BUNDLE_URL, '/api/contacts/note', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function logInteraction(data: {
  contact_id: string; interaction_type: string; subject: string;
  details: string; actor_id: string; occurred_at?: string;
}) {
  return request<any>(BUNDLE_URL, '/api/contacts/interaction', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function summarizeContact(contact_id: string) {
  return request<any>(BUNDLE_URL, '/api/contacts/summarize', {
    method: 'POST', body: JSON.stringify({ contact_id }),
  });
}

export async function generateTemplate(data: {
  description: string; category: string; tone?: string; actor_id: string;
}) {
  return request<any>(BUNDLE_URL, '/api/templates/generate', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function approveTemplate(template_id: string, actor_id: string) {
  return request<any>(BUNDLE_URL, '/api/templates/approve', {
    method: 'POST', body: JSON.stringify({ template_id, actor_id }),
  });
}

export async function personalizeDraft(data: {
  template_id: string; contact_id: string; actor_id: string;
}) {
  return request<any>(BUNDLE_URL, '/api/drafts/personalize', {
    method: 'POST', body: JSON.stringify(data),
  });
}

export async function createCampaign(data: {
  name: string; description: string; template_id: string;
  tag_filter: string[]; actor_id: string;
}) {
  return request<any>(BUNDLE_URL, '/api/campaigns', {
    method: 'POST', body: JSON.stringify(data),
  });
}
```

**Key design decisions:**
- `NEXT_PUBLIC_` prefix makes the bundle URL available in client-side code
- The generic `request<T>` helper handles JSON content-type, error extraction, and typing
- Each function matches exactly one `@ApiEndpoint` in the bundle — same route, same body shape
- There is no `sendEmail` function — email delivery happens inside the bundle as part of workflows (see [Part 5](./part-05-email-workflows.md))

---

## Application Structure

The GUI is a single-page app with 4 tabs, all in one file (`src/app/page.tsx`). Each tab is a separate React component:

```typescript
'use client';

import { useState } from 'react';
import { Users, Mail, FileText, BarChart3 } from 'lucide-react';
import * as api from '../lib/api';

const ACTOR_ID = 'augustus@firebrand.ai';

const tabs = [
  { id: 'contacts',    label: 'Contacts',           icon: Users },
  { id: 'templates',   label: 'Templates',          icon: FileText },
  { id: 'personalize', label: 'Personalize & Send', icon: Mail },
  { id: 'campaigns',   label: 'Campaigns',          icon: BarChart3 },
] as const;
```

### Tab 1: Contacts

The contacts tab is the most complex — it handles listing, creating, and interacting with contacts:

```typescript
function ContactsTab() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [noteEnrich, setNoteEnrich] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  // ... more state

  const refresh = useCallback(async () => {
    const { contacts } = await api.listContacts();
    setContacts(contacts);
  }, []);

  // Create, add note, log interaction, summarize...
}
```

**UI features:**
- Contact list with tag badges
- Create contact form (name, email, company, tags)
- Selected contact detail panel with:
  - Add note form with category selector and AI enrichment toggle
  - Log interaction form (call, email, meeting)
  - AI summary button that shows engagement score, sentiment, recommended actions

**AI enrichment display:**
When a note is enriched, the response includes structured data from the `NoteEnricherBot`:

```typescript
{noteResult?.enrichment && (
  <div>
    <h4>AI Enrichment</h4>
    <p>Sentiment: {noteResult.enrichment.sentiment}</p>
    <ul>{noteResult.enrichment.key_insights.map(i => <li>{i}</li>)}</ul>
    <ul>{noteResult.enrichment.action_items.map(a => <li>{a}</li>)}</ul>
    <div>{noteResult.enrichment.topics.map(t => <span>{t}</span>)}</div>
  </div>
)}
```

### Tab 2: Templates

AI-powered email template generation with HITL approval:

```typescript
function TemplatesTab() {
  const [template, setTemplate] = useState<any>(null);
  const [form, setForm] = useState({
    description: '', category: 'newsletter', tone: ''
  });

  async function handleGenerate() {
    const result = await api.generateTemplate({
      ...form, actor_id: ACTOR_ID,
    });
    setTemplate(result);
  }

  async function handleApprove() {
    await api.approveTemplate(template.template_id, ACTOR_ID);
    setTemplate({ ...template, status: 'approved' });
  }
}
```

**The HITL flow in the UI:**
1. User fills in description, category, and tone
2. Clicks "Generate" → `TemplateWriterBot` produces a template (status: `draft`)
3. UI displays the generated subject and HTML body for review
4. User clicks "Approve" → template status becomes `approved`
5. Template ID is now usable in personalization and campaigns

### Tab 3: Personalize & Send

Previews AI-personalized email drafts:

```typescript
function PersonalizeTab() {
  const [draft, setDraft] = useState<any>(null);

  async function handlePersonalize() {
    const result = await api.personalizeDraft({
      template_id: form.template_id,
      contact_id: form.contact_id,
      actor_id: ACTOR_ID,
    });
    setDraft(result);
  }

  // Display the personalized subject and body_html for review
}
```

At this stage, the tab only **previews** personalized drafts — the `personalizeDraft` endpoint runs the `EmailPersonalizerBot` and returns the AI-generated content without sending. [Part 5](./part-05-email-workflows.md) adds a "Personalize & Send" button that triggers the bundle's `personalize-and-send` workflow to generate and send in one step.

### Tab 4: Campaigns

Bulk campaign creation:

```typescript
function CampaignsTab() {
  async function handleCreate() {
    const result = await api.createCampaign({
      name: form.name,
      description: form.description,
      template_id: form.template_id,
      tag_filter: form.tag_filter.split(',').map(t => t.trim()),
      actor_id: ACTOR_ID,
    });
    setCampaign(result);
  }
}
```

---

## Styling

The app uses Tailwind CSS with a custom CRM color palette:

```typescript
// tailwind.config.ts
const config: Config = {
  theme: {
    extend: {
      colors: {
        crm: {
          primary: '#2563eb',    // Blue-600
          secondary: '#7c3aed',  // Violet-600 (AI features)
          accent: '#0891b2',     // Cyan-600
          bg: '#f8fafc',         // Slate-50
          surface: '#ffffff',
          text: '#0f172a',       // Slate-900
          muted: '#64748b',      // Slate-500
          border: '#e2e8f0',     // Slate-200
        },
      },
    },
  },
};
```

---

## Running the Full Stack

You'll need two services running simultaneously:

```bash
# Terminal 1: Agent bundle (port 3000)
cd apps/crm-bundle
PORT=3000 pnpm dev

# Terminal 2: GUI (port 3002)
cd apps/crm-gui
pnpm dev
```

Open `http://localhost:3002` in your browser.

### Checkpoint: Verify Full Stack

1. Click the health check button in the header — should show green
2. Create a contact in the Contacts tab
3. Add a note with AI enrichment enabled — should see structured insights
4. Generate a template in the Templates tab — review the AI output and approve
5. Switch to Personalize & Send — enter the template ID and contact ID, click "Preview Draft"
6. Verify the AI-personalized subject and body appear in the preview

---

## Summary

You've built a working CRM frontend that calls the agent bundle directly from the browser. The GUI **triggers workflows** but never composes or sends emails — that happens inside the bundle. This is fine for local development, but a production app needs:

- **Server-side credentials** — API keys and bundle URLs should never be in browser code
- **User authentication** — the hardcoded `ACTOR_ID` should come from a real login session
- **Request proxying** — a Backend-for-Frontend layer that handles CORS, error normalization, and service discovery

[Part 4](./part-04-bff-and-authentication.md) adds all of this: an Express BFF layer using `@firebrandanalytics/app_backend_accelerator`, OIDC login, and session-based actor identity. Then [Part 5](./part-05-email-workflows.md) connects the bundle to the notification service for email delivery, and [Part 6](./part-06-campaign-execution.md) adds parallel campaign execution.

### Source Code

The complete source code is available in the [ff-demo-apps](https://github.com/firebrandanalytics/ff-demo-apps) repository under `crm/`.
