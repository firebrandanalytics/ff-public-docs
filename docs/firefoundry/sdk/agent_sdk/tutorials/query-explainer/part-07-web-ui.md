# Part 7: Web UI

In this part you'll add a Next.js web interface that lets users submit SQL queries, watch analysis progress, and view structured results with performance and semantic panels. The GUI communicates with the agent bundle through server-side API routes using a typed fetch wrapper.

> **Prerequisite:** Complete [Part 6: Deploy & Test](./part-06-deploy-and-test.md) first. The bundle must be running and reachable.

**What you'll learn:**
- Scaffolding a Next.js GUI in the monorepo
- Server-side bundle client with `data.result ?? data` unwrapping
- API route proxying pattern (why the browser never calls the bundle directly)
- Polling for async results with `setInterval`
- Tailwind CSS styling with `lucide-react` icons

**What you'll build:** A single-page application with a SQL input form, a loading spinner that shows entity status, and two result panels (Performance Analysis and Semantic Analysis).

## Step 1: Scaffold the GUI

Add a GUI application to the monorepo:

```bash
ff gui add query-gui
```

This scaffolds a Next.js application in `apps/query-gui/`.

This GUI does not use the `@firebrandanalytics/ff-sdk` client package. Instead it calls the bundle's `@ApiEndpoint` routes directly with `fetch`. This is a simpler pattern when your GUI only needs to hit custom API endpoints (no entity method invocation or file uploads).

Install the icon library and Tailwind CSS tooling:

```bash
cd apps/query-gui
pnpm add lucide-react
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p --ts
```

Configure Tailwind to scan your source files.

**`apps/query-gui/tailwind.config.ts`**:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

Replace the contents of `globals.css` with the Tailwind directives:

**`apps/query-gui/src/app/globals.css`**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Update `next.config.mjs` to use standalone output (required for Docker deployments):

**`apps/query-gui/next.config.mjs`**:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};
export default nextConfig;
```

---

## Step 2: Bundle Client Helper

Create a server-side helper that wraps all bundle API calls with proper typing and error handling.

**`apps/query-gui/src/lib/bundleClient.ts`**:

```typescript
/**
 * Server-side client for the query-explainer agent bundle.
 * Calls bundle API endpoints from Next.js API routes.
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
    analyze: boolean;
    verbose: boolean;
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

**Key details:**

- **`BUNDLE_URL`** defaults to `http://localhost:3001` (the bundle's default port from Part 6). Override it with an environment variable for deployed environments.
- **`callBundle`** is the single point of contact with the agent bundle. It prepends `/api/` to all endpoints, sets the JSON content type, and handles error responses.
- **`data.result ?? data` unwrapping**: Bundle `@ApiEndpoint` methods return `{ success: true, result: <your return value> }`. The `?? data` fallback handles cases where the response shape differs.
- **TypeScript interfaces** mirror the Zod schema from Part 1 and the entity data shape from Part 5.

> **CRITICAL**: This module makes HTTP calls to the agent bundle, so it must only be used in server-side code (API routes, Server Components). Never import it in client components — the `BUNDLE_URL` may not be reachable from the browser, and you would expose internal service addresses.

---

## Step 3: API Routes

The GUI uses Next.js API routes as a server-side proxy between the browser and the agent bundle. The browser calls `/api/analyze` on the Next.js server, which calls `POST /api/analyze-query` on the bundle.

This proxy pattern provides three benefits:

1. **No CORS issues** — the browser only talks to its own origin
2. **Hidden infrastructure** — the bundle's internal cluster URL is never exposed to the client
3. **Server-side validation** — you can add authentication, rate limiting, or input sanitization in the API routes

### Analyze Route

Accepts a SQL query from the browser and forwards it to the bundle's `analyze-query` endpoint. Returns the entity ID for polling.

**`apps/query-gui/src/app/api/analyze/route.ts`**:

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

### Status Route

Polls the bundle for entity status and results.

**`apps/query-gui/src/app/api/status/route.ts`**:

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

---

## Step 4: Search Page

Replace the scaffolded page with the full query analyzer interface. This is a single `'use client'` page with four components:

- **`HomePage`** — the main page with SQL input form, loading state, and results layout
- **`PerformancePanel`** — displays execution plan analysis, bottlenecks, and optimization suggestions
- **`SemanticsPanel`** — displays the business question, domain context, tables used, and entity relationships
- **`RecentAnalysesSidebar`** — sidebar listing previous analyses from `localStorage`, clickable to reload results

### Layout

Set up the root layout to import Tailwind styles.

**`apps/query-gui/src/app/layout.tsx`**:

```tsx
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

### Page Component

**`apps/query-gui/src/app/page.tsx`**:

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Database, Search, AlertTriangle, Zap,
  BookOpen, Copy, Check, Loader2,
} from 'lucide-react';

// --- Types ---

interface TableUsed {
  table_name: string;
  business_name?: string;
  role_in_query: string;
}

interface PerformanceResult {
  summary: string;
  bottlenecks: string[];
  optimization_suggestions: string[];
  estimated_cost?: string;
  execution_time_ms?: number;
}

interface SemanticsResult {
  business_question: string;
  domain_context: string;
  tables_used: TableUsed[];
  entities_involved: string[];
  relationships: string[];
}

interface AnalysisResult {
  performance: PerformanceResult;
  semantics: SemanticsResult;
}

interface StatusResponse {
  entity_id: string;
  status: string;
  data: {
    sql: string;
    connection: string;
    result?: AnalysisResult;
    error?: string;
  };
}

interface RecentAnalysis {
  sql: string;
  connection: string;
  timestamp: string;
  result: AnalysisResult;
}
```

The types mirror the bundle client interfaces from Step 2, redefined here for the client component (which cannot import server-side modules).

### Helper Components

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-gray-400
                 hover:text-gray-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-500" />
        : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
```

### PerformancePanel

Displays execution plan analysis with optional timing stats, bottleneck warnings, and numbered optimization suggestions:

```tsx
function PerformancePanel({ perf }: { perf: PerformanceResult }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-semibold text-gray-900">Performance Analysis</h3>
      </div>

      <p className="text-sm text-gray-700 mb-4">{perf.summary}</p>

      {/* Execution time / cost badges */}
      {(perf.execution_time_ms != null || perf.estimated_cost) && (
        <div className="flex gap-4 mb-4">
          {perf.execution_time_ms != null && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <div className="text-xs text-blue-600 font-medium">Execution Time</div>
              <div className="text-sm font-bold text-blue-800">
                {perf.execution_time_ms.toFixed(2)} ms
              </div>
            </div>
          )}
          {perf.estimated_cost && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <div className="text-xs text-purple-600 font-medium">Estimated Cost</div>
              <div className="text-sm font-bold text-purple-800">{perf.estimated_cost}</div>
            </div>
          )}
        </div>
      )}

      {/* Bottlenecks */}
      {perf.bottlenecks.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            Bottlenecks
          </h4>
          <ul className="space-y-1">
            {perf.bottlenecks.map((b, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-orange-400 mt-1 flex-shrink-0">&bull;</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Optimization Suggestions */}
      {perf.optimization_suggestions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">
            Optimization Suggestions
          </h4>
          <ol className="space-y-1 list-decimal list-inside">
            {perf.optimization_suggestions.map((s, i) => (
              <li key={i} className="text-sm text-gray-600">{s}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
```

### SemanticsPanel

Displays the business question in a highlighted card, domain context, table cards with business names, entity tags, and relationship bullets:

```tsx
function SemanticsPanel({ sem }: { sem: SemanticsResult }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="w-5 h-5 text-indigo-500" />
        <h3 className="text-lg font-semibold text-gray-900">Semantic Analysis</h3>
      </div>

      {/* Business Question */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-indigo-600 uppercase tracking-wider">
            Business Question
          </span>
          <CopyButton text={sem.business_question} />
        </div>
        <p className="text-base font-medium text-indigo-900">{sem.business_question}</p>
      </div>

      <p className="text-sm text-gray-700 mb-4">{sem.domain_context}</p>

      {/* Tables Used */}
      {sem.tables_used.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Tables Used</h4>
          <div className="grid grid-cols-1 gap-2">
            {sem.tables_used.map((t, i) => (
              <div key={i} className="bg-gray-50 rounded-lg border border-gray-100 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-sm font-mono font-bold text-gray-800
                                   bg-gray-200 px-1.5 py-0.5 rounded">
                    {t.table_name}
                  </code>
                  {t.business_name && (
                    <span className="text-xs text-gray-500">({t.business_name})</span>
                  )}
                </div>
                <p className="text-xs text-gray-600">{t.role_in_query}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entities */}
      {sem.entities_involved.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Entities Involved</h4>
          <div className="flex flex-wrap gap-2">
            {sem.entities_involved.map((e, i) => (
              <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full
                                       text-xs font-medium bg-indigo-100 text-indigo-800
                                       border border-indigo-200">
                {e}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Relationships */}
      {sem.relationships.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">Relationships</h4>
          <ul className="space-y-1">
            {sem.relationships.map((r, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-indigo-400 mt-1 flex-shrink-0">&bull;</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### RecentAnalysesSidebar

Stores recent analyses in `localStorage` so they persist across page refreshes. Each entry shows a truncated SQL snippet, the connection name, and a timestamp:

```tsx
function RecentAnalysesSidebar({
  analyses,
  onSelect,
}: {
  analyses: RecentAnalysis[];
  onSelect: (a: RecentAnalysis) => void;
}) {
  if (analyses.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No recent analyses</p>;
  }

  return (
    <div className="space-y-2">
      {analyses.map((a, i) => (
        <button
          key={i}
          onClick={() => onSelect(a)}
          className="w-full text-left p-3 rounded-lg border border-gray-200
                     hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs font-mono text-gray-700 truncate">{a.sql}</div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <Database className="w-3 h-3" />
            {a.connection}
            <span className="ml-auto">
              {new Date(a.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
```

### HomePage — Main Component

The main component manages the submit → poll → display flow:

```tsx
const DEFAULT_SQL = `SELECT c.first_name, c.last_name, SUM(o.total_amount) as total_spent
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE o.status = 'completed'
GROUP BY c.first_name, c.last_name
ORDER BY total_spent DESC
LIMIT 10`;

export default function HomePage() {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [connection, setConnection] = useState('firekicks');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const [recentAnalyses, setRecentAnalyses] = useState<RecentAnalysis[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load recent analyses from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('query-explainer-recent');
      if (stored) setRecentAnalyses(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const saveRecent = useCallback((analysis: RecentAnalysis) => {
    setRecentAnalyses(prev => {
      const next = [analysis, ...prev.filter(a => a.sql !== analysis.sql)].slice(0, 10);
      try {
        localStorage.setItem('query-explainer-recent', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);
```

### The Polling Logic

The polling function runs every 2 seconds, checking for `data.result` or `data.error`:

```tsx
  const pollForResults = useCallback(
    (entityId: string, sqlValue: string, connValue: string) => {
      if (pollingRef.current) clearInterval(pollingRef.current);

      let attempts = 0;
      const maxAttempts = 60; // 2 minutes at 2s intervals

      pollingRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setError('Analysis timed out after 2 minutes');
          setAnalyzing(false);
          setPollingStatus(null);
          return;
        }

        try {
          const res = await fetch(
            `/api/status?entity_id=${encodeURIComponent(entityId)}`
          );
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Status check failed');
          }

          const status: StatusResponse = await res.json();
          setPollingStatus(status.status);

          if (status.data?.error) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setError(status.data.error);
            setAnalyzing(false);
            setPollingStatus(null);
            return;
          }

          if (status.data?.result) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setResult(status.data.result);
            setAnalyzing(false);
            setPollingStatus(null);
            saveRecent({
              sql: sqlValue,
              connection: connValue,
              timestamp: new Date().toISOString(),
              result: status.data.result,
            });
            return;
          }
        } catch (err: any) {
          // Don't stop polling on transient errors
          console.error('[Poll] Error:', err.message);
        }
      }, 2000);
    },
    [saveRecent]
  );
```

**Key points:**
- **2-second interval, 60 attempts** gives a 2-minute timeout before giving up
- **Transient errors don't stop polling** — only a definitive result or error stops the loop
- **`saveRecent`** stores successful results to `localStorage` for the sidebar

### Submit Handler

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sql.trim() || !connection.trim() || analyzing) return;

    setAnalyzing(true);
    setError(null);
    setResult(null);
    setPollingStatus('Submitting...');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sql.trim(), connection: connection.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Analysis submission failed');
      }

      const data = await res.json();
      setPollingStatus('Pending');
      pollForResults(data.entity_id, sql.trim(), connection.trim());
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setAnalyzing(false);
      setPollingStatus(null);
    }
  };

  const loadRecent = (analysis: RecentAnalysis) => {
    setSql(analysis.sql);
    setConnection(analysis.connection);
    setResult(analysis.result);
    setError(null);
  };
```

### JSX Layout

The page uses a responsive grid: 3/4 width for results and 1/4 for the recent analyses sidebar:

```tsx
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14
                          bg-indigo-600 rounded-2xl mb-3">
            <Database className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            SQL Query Analyzer
          </h1>
          <p className="text-gray-600 max-w-xl mx-auto">
            Submit a SQL query to get AI-powered performance analysis and semantic
            explanation using the Data Access Service.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto mb-8">
          <div className="mb-3">
            <label htmlFor="sql" className="block text-sm font-medium text-gray-700 mb-1">
              SQL Query
            </label>
            <textarea
              id="sql"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={6}
              className="w-full font-mono text-sm px-4 py-3 rounded-xl border border-gray-300
                         focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200
                         outline-none bg-white shadow-sm resize-y"
              placeholder="SELECT * FROM ..."
              disabled={analyzing}
            />
          </div>

          <div className="flex gap-3">
            <div className="w-48">
              <label htmlFor="connection"
                     className="block text-sm font-medium text-gray-700 mb-1">
                Connection
              </label>
              <input
                id="connection"
                type="text"
                value={connection}
                onChange={(e) => setConnection(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300
                           focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200
                           outline-none bg-white shadow-sm text-sm"
                placeholder="firekicks"
                disabled={analyzing}
              />
            </div>
            <div className="flex-1 flex items-end">
              <button
                type="submit"
                disabled={analyzing || !sql.trim() || !connection.trim()}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium
                           hover:bg-indigo-700 disabled:bg-gray-300
                           disabled:cursor-not-allowed transition-colors shadow-sm
                           flex items-center gap-2"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Analyze Query
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="max-w-3xl mx-auto mb-6 p-4 bg-red-50 border border-red-200
                          rounded-lg text-red-700 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          </div>
        )}

        {/* Loading / Polling status */}
        {analyzing && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-indigo-200
                            border-t-indigo-600 rounded-full animate-spin mb-4" />
            <p className="text-gray-600">Analyzing your query...</p>
            <p className="text-sm text-gray-400 mt-1">
              {pollingStatus || 'Submitting...'}
              {' — '}This may take 15-45 seconds as the LLM calls DAS tools
            </p>
          </div>
        )}

        {/* Content: Results + Recent */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            {result && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <PerformancePanel perf={result.performance} />
                  <SemanticsPanel sem={result.semantics} />
                </div>
              </div>
            )}

            {!result && !analyzing && !error && (
              <div className="text-center py-16 text-gray-400">
                <Database className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">Enter a SQL query above to start analysis</p>
                <p className="text-sm mt-1">
                  The analyzer will examine performance and explain the business meaning
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <h3 className="text-sm font-semibold text-gray-500
                           uppercase tracking-wider mb-3">
              Recent Analyses
            </h3>
            <RecentAnalysesSidebar
              analyses={recentAnalyses}
              onSelect={loadRecent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## Step 5: Configure and Run

Set the `BUNDLE_URL` environment variable so the GUI knows where to reach the agent bundle.

### Local Development

**`apps/query-gui/.env.local`**:

```bash
BUNDLE_URL=http://localhost:3001
```

Run the GUI (with the bundle already running from Part 6):

```bash
cd apps/query-gui
pnpm dev
```

Open `http://localhost:3000` in your browser. You should see the SQL Query Analyzer interface with a pre-filled sample query. Click "Analyze Query" and wait 15-45 seconds for the results to appear.

### Deployed Environment

For a deployed environment, set `BUNDLE_URL` to the bundle's in-cluster service name. Add a `values.local.yaml` for the GUI's Helm chart:

```yaml
configMap:
  enabled: true
  data:
    BUNDLE_URL: "http://query-bundle-agent-bundle.ff-dev.svc.cluster.local:3000"
```

Build and deploy:

```bash
ff ops build --app-name query-gui
ff ops deploy --app-name query-gui
```

---

## Component Summary

| Component | Purpose |
|-----------|---------|
| `bundleClient.ts` | Server-side typed wrapper for bundle HTTP API |
| `api/analyze/route.ts` | POST proxy: browser → bundle `analyze-query` |
| `api/status/route.ts` | GET proxy: browser → bundle `query-status` |
| `PerformancePanel` | Displays execution plan analysis with bottleneck warnings |
| `SemanticsPanel` | Displays business question, tables, entities, relationships |
| `RecentAnalysesSidebar` | `localStorage`-backed list of previous analyses |
| `HomePage` | Main page: SQL form → submit → poll → display results |

---

## What's Next

You now have a complete SQL query analysis application: the browser sends a SQL query to the Next.js API routes, which proxy the request to the agent bundle. The bundle calls DAS tools (EXPLAIN, dictionary, schema), has the LLM produce a Zod-validated analysis, and stores the result on the entity. The GUI polls for completion and displays the performance and semantic panels.

From here you can:

- **Add query history persistence.** Replace `localStorage` with a database-backed endpoint so recent analyses persist across browsers and sessions.
- **Stream progress updates.** Replace polling with Server-Sent Events to show tool call progress in real time.
- **Add authentication.** Wrap the API routes with session middleware to restrict access.
- **Support multiple connections.** Add a dropdown populated from the DAS connections list instead of a free-text input.
- **Export results.** Add a "Download JSON" or "Copy Markdown" button to the result panels.
