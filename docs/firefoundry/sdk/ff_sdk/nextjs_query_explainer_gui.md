# Building a Next.js GUI for the Query Explainer

Welcome! In the [Tool-Calling Agent tutorial](../agent_sdk/feature_guides/tool_calling_query_explainer.md), you built a Query Explainer agent bundle that analyzes SQL queries for performance and semantic meaning. Now we'll build a **web interface** so users can submit queries and view results without touching the command line.

## The Goal

We'll create a **Next.js** single-page application that:
- Provides a SQL input form with connection selection
- Submits queries to the agent bundle's API
- Polls for results while showing a loading state
- Displays performance and semantic analysis in a two-column layout
- Keeps a sidebar of recent analyses (stored in localStorage)

**Key Elements:**
- Next.js 15 with App Router and API routes
- Server-side bundle client (no direct client-to-bundle calls)
- Tailwind CSS for styling
- Polling pattern for async results

## Prerequisites

1. The **Query Explainer agent bundle** is running and healthy on port 3001
   - See the [agent bundle tutorial](../agent_sdk/feature_guides/tool_calling_query_explainer.md) for setup
2. Node.js 20+ installed
3. Familiarity with React and Next.js basics

### Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│              │     │   Next.js App   │     │  Agent Bundle    │
│   Browser    │────→│                 │────→│  (port 3001)     │
│              │     │  API Routes     │     │                  │
│  page.tsx    │     │  (server-side)  │     │  /api/analyze-   │
│  (React)     │←────│                 │←────│  query           │
│              │     │  bundleClient   │     │  /api/query-     │
│              │     │  .ts            │     │  status          │
└──────────────┘     └─────────────────┘     └──────────────────┘
     :3000                :3000                    :3001
```

The browser talks to Next.js API routes (same origin), which proxy requests to the bundle on the server side. This keeps the bundle URL out of the browser and avoids CORS issues.

---

## Part 1: Project Setup

### Adding to the Monorepo

The query-explainer project uses a pnpm workspace monorepo. Add the GUI as a new workspace:

```
query-explainer/
├── apps/
│   ├── query-bundle/    # The agent bundle (already exists)
│   └── query-gui/       # The web GUI (we'll create this)
├── packages/
│   └── shared-types/    # Shared TypeScript types
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

The workspace config (`pnpm-workspace.yaml`) already includes `apps/*`, so our new directory is automatically picked up.

### Scaffold the Next.js App

Create the directory structure:

```bash
mkdir -p apps/query-gui/src/{app/api/{analyze,status},lib}
```

### package.json

```json
{
  "name": "@apps/query-gui",
  "version": "1.0.0",
  "private": true,
  "description": "Query Explainer web interface",
  "scripts": {
    "dev": "next dev",
    "build": "NODE_ENV=production next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "15.3.2",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2"
  }
}
```

### Configuration Files

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] },
    "target": "ES2017"
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**next.config.mjs:**
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};
export default nextConfig;
```

**tailwind.config.ts:**
```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

**postcss.config.mjs:**
```javascript
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
export default config;
```

### Root Layout and CSS

**src/app/globals.css:**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**src/app/layout.tsx:**
```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SQL Query Analyzer',
  description: 'AI-powered SQL query performance and semantic analysis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

### Install Dependencies

```bash
cd query-explainer
pnpm install
```

---

## Part 2: The Bundle Client

The bundle client is a **server-side module** that Next.js API routes use to call the agent bundle. It handles the HTTP communication and response unwrapping.

**src/lib/bundleClient.ts:**

```typescript
/**
 * Server-side client for the query-explainer agent bundle.
 * Used by Next.js API routes — never imported from client components.
 */

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://localhost:3001';

export interface AnalyzeRequest {
  sql: string;
  connection: string;
  analyze?: boolean;
  verbose?: boolean;
}

export interface AnalyzeResponse {
  entity_id: string;
}

export interface QueryStatusResponse {
  entity_id: string;
  status: string;
  data: {
    sql: string;
    connection: string;
    result?: QueryAnalysisResult;
    error?: string;
  };
}

export interface QueryAnalysisResult {
  performance: {
    summary: string;
    bottlenecks: string[];
    optimization_suggestions: string[];
    estimated_cost?: string;
    execution_time_ms?: number;
  };
  semantics: {
    business_question: string;
    domain_context: string;
    tables_used: {
      table_name: string;
      business_name?: string;
      role_in_query: string;
    }[];
    entities_involved: string[];
    relationships: string[];
  };
}

async function callBundle(endpoint: string, options?: RequestInit) {
  const url = `${BUNDLE_URL}/api/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bundle API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.result ?? data;
}

export async function analyzeQuery(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  return callBundle('analyze-query', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getQueryStatus(entityId: string): Promise<QueryStatusResponse> {
  return callBundle(`query-status?entity_id=${encodeURIComponent(entityId)}`);
}
```

**Key Design Points:**
- `BUNDLE_URL` defaults to `http://localhost:3001` for local development
- `data.result ?? data` handles both SDK-wrapped and direct responses
- Types mirror the bundle's output structure

### Environment Configuration

Create a `.env.local` file (not committed to git):

```
BUNDLE_URL=http://localhost:3001
```

For production, set `BUNDLE_URL` to the in-cluster service name (e.g., `http://query-explainer-bundle:3000`).

---

## Part 3: API Routes

Next.js API routes act as a proxy layer between the browser and the bundle.

### POST /api/analyze

**src/app/api/analyze/route.ts:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { analyzeQuery } from '@/lib/bundleClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sql, connection, analyze, verbose } = body;

    if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty sql' }, { status: 400 });
    }
    if (!connection || typeof connection !== 'string' || connection.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty connection' }, { status: 400 });
    }

    const result = await analyzeQuery({
      sql: sql.trim(),
      connection: connection.trim(),
      analyze,
      verbose,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /analyze] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Analysis failed' }, { status: 500 });
  }
}
```

### GET /api/status

**src/app/api/status/route.ts:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getQueryStatus } from '@/lib/bundleClient';

export async function GET(request: NextRequest) {
  try {
    const entityId = request.nextUrl.searchParams.get('entity_id');
    if (!entityId) {
      return NextResponse.json({ error: 'Missing entity_id parameter' }, { status: 400 });
    }

    const result = await getQueryStatus(entityId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /status] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Failed to get status' }, { status: 500 });
  }
}
```

**Pattern:** Each API route validates inputs, calls the bundle client, and returns the result. Errors are caught and returned as JSON with appropriate status codes.

---

## Part 4: Building the UI

The main page is a single `'use client'` component with three sections: input form, results display, and recent analyses sidebar.

### Page Structure

The page manages these states:
- `sql` / `connection` — form inputs
- `analyzing` — loading state during submission + polling
- `result` — the analysis result (performance + semantics)
- `error` — error message if something fails
- `recentAnalyses` — saved in localStorage for quick access

### Polling Pattern

When the user submits a query:

1. `POST /api/analyze` → get `entity_id`
2. Start polling `GET /api/status?entity_id=...` every 2 seconds
3. When `data.result` appears → stop polling, display results
4. When `data.error` appears → stop polling, show error
5. After 60 attempts (2 minutes) → timeout

```typescript
const pollForResults = useCallback((entityId: string) => {
  const interval = setInterval(async () => {
    const res = await fetch(`/api/status?entity_id=${encodeURIComponent(entityId)}`);
    const status = await res.json();

    if (status.data?.result) {
      clearInterval(interval);
      setResult(status.data.result);
      setAnalyzing(false);
    } else if (status.data?.error) {
      clearInterval(interval);
      setError(status.data.error);
      setAnalyzing(false);
    }
  }, 2000);
}, []);
```

### Result Display Components

The results are split into two panels:

**PerformancePanel** shows:
- Summary paragraph
- Execution time and cost badges (if available)
- Bottlenecks list with warning icons
- Numbered optimization suggestions

**SemanticsPanel** shows:
- Business question (highlighted, with copy button)
- Domain context paragraph
- Table cards showing `table_name`, `business_name`, and `role_in_query`
- Entity badges
- Relationship list

### Complete Page Implementation

The full page component is approximately 350 lines of React. Here's the overall structure:

```typescript
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Database, Search, AlertTriangle, Zap, BookOpen, Loader2 } from 'lucide-react';

// --- Types (mirror bundleClient types for the client side) ---

interface AnalysisResult {
  performance: { summary: string; bottlenecks: string[]; /* ... */ };
  semantics: { business_question: string; tables_used: any[]; /* ... */ };
}

// --- Helper Components ---

function PerformancePanel({ perf }: { perf: PerformanceResult }) {
  return (
    <div className="bg-white rounded-lg border p-5 shadow-sm">
      <h3>Performance Analysis</h3>
      <p>{perf.summary}</p>
      {/* Bottlenecks list, suggestions list */}
    </div>
  );
}

function SemanticsPanel({ sem }: { sem: SemanticsResult }) {
  return (
    <div className="bg-white rounded-lg border p-5 shadow-sm">
      <h3>Semantic Analysis</h3>
      <div className="bg-indigo-50 rounded-lg p-4">
        <p>{sem.business_question}</p>
      </div>
      {/* Tables used, entities, relationships */}
    </div>
  );
}

// --- Main Page ---

export default function HomePage() {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [connection, setConnection] = useState('firekicks');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  // ... error, recentAnalyses state ...

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnalyzing(true);

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, connection }),
    });
    const data = await res.json();
    pollForResults(data.entity_id);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      {/* Header */}
      {/* Input Form: textarea + connection + submit button */}
      {/* Loading spinner */}
      {/* Two-column results: PerformancePanel + SemanticsPanel */}
      {/* Recent Analyses sidebar */}
    </div>
  );
}
```

The full source code is in the repository at `apps/query-gui/src/app/page.tsx`.

### Tailwind Styling Highlights

Key styling patterns used:

- **Gradient background**: `bg-gradient-to-br from-slate-50 via-white to-indigo-50`
- **Monospace SQL input**: `font-mono text-sm` on the textarea
- **Responsive layout**: `grid grid-cols-1 lg:grid-cols-4` — 3/4 results + 1/4 sidebar
- **Indigo theme**: The semantics panel uses indigo for its "business question" highlight
- **Amber theme**: The performance panel uses amber for bottleneck warnings
- **Loading spinner**: CSS-only spinner with `animate-spin` and border tricks

---

## Part 5: Running the Complete Stack

### Start the Bundle

In one terminal:

```bash
cd apps/query-bundle
export REMOTE_ENTITY_SERVICE_URL=http://localhost
export REMOTE_ENTITY_SERVICE_PORT=8180
export USE_REMOTE_ENTITY_CLIENT=true
export LLM_BROKER_HOST=localhost
export LLM_BROKER_PORT=50052
export DAS_URL=http://localhost:8080
export PORT=3001

node dist/index.js
```

### Start the GUI

In another terminal:

```bash
cd apps/query-gui
pnpm dev
```

The GUI starts on `http://localhost:3000`.

### Using the GUI

1. Open `http://localhost:3000` in your browser
2. Enter a SQL query (a default example is pre-filled)
3. Set the connection name (defaults to "firekicks")
4. Click **Analyze Query**
5. Wait 15-45 seconds while the LLM calls DAS tools
6. View the two-panel results:
   - **Left**: Performance analysis with bottlenecks and suggestions
   - **Right**: Semantic analysis with business question and table explanations

### Root-Level Scripts

The monorepo `package.json` includes convenience scripts:

```bash
# Run just the GUI
pnpm dev:gui

# Run just the bundle
pnpm dev:bundle

# Build the GUI for production
pnpm build:gui

# Run everything in parallel
pnpm dev
```

---

## Summary

You've built a complete web interface for the Query Explainer agent:

- **Server-side bundle client** that proxies requests through Next.js API routes
- **Two API routes** (analyze and status) that handle validation and error forwarding
- **Polling pattern** for async result retrieval
- **Two-panel results display** for performance and semantic analysis
- **Recent analyses sidebar** for quick access to previous results

### What's Next?

- **Deploy the GUI**: Build with `pnpm build:gui` and deploy the `.next/standalone` output as a container
- **Add Authentication**: Integrate with your auth provider in the API routes
- **Explore More Queries**: Try different SQL patterns against the FireKicks dataset
- **Review the Agent Bundle**: See the [Tool-Calling Agent Tutorial](../agent_sdk/feature_guides/tool_calling_query_explainer.md) for the bundle implementation
