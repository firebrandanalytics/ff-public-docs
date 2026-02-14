# Part 3: Web UI

In this part you'll add a Next.js web UI that lets users search for news topics, view AI-analyzed articles with color-coded impact badges, and browse previous searches. The GUI communicates with the agent bundle through server-side API routes using a typed fetch wrapper.

> **Prerequisite:** Complete [Part 1: Bundle & Web Search](./part-01-bundle.md) first. The bundle must be deployed and reachable.

## Step 1: Scaffold the GUI

Add a GUI component to the application:

```bash
ff gui add news-analysis-gui
```

This scaffolds a Next.js application in `apps/news-analysis-gui/`.

This GUI does not use the `@firebrandanalytics/ff-sdk` client package. Instead it calls the bundle's `@ApiEndpoint` routes directly with `fetch`. This is a simpler pattern when your GUI only needs to hit custom API endpoints (no entity method invocation or file uploads).

Install the icon library and Tailwind CSS tooling:

```bash
cd apps/news-analysis-gui
pnpm add lucide-react
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p --ts
```

Configure Tailwind to scan your source files.

**`apps/news-analysis-gui/tailwind.config.ts`**:

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

**`apps/news-analysis-gui/src/app/globals.css`**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Update `next.config.mjs` to use standalone output (required for Docker deployments):

**`apps/news-analysis-gui/next.config.mjs`**:

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

**`apps/news-analysis-gui/src/lib/bundleClient.ts`**:

```typescript
/**
 * Server-side client for the news-analysis agent bundle.
 * Calls bundle API endpoints from Next.js API routes.
 */

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://news-analysis-bundle-agent-bundle:3000';

export interface SearchResult {
  search_id: string;
  query: string;
  article_count: number;
  articles: ArticleResult[];
}

export interface ArticleResult {
  title: string;
  url: string;
  snippet: string;
  published_date: string | null;
  analysis: ImpactAnalysis | null;
}

export interface ImpactAnalysis {
  article_summary: string;
  healthcare: VerticalImpact;
  shipping_logistics: VerticalImpact;
  technology: VerticalImpact;
  overall_significance: string;
}

export interface VerticalImpact {
  impact_level: string;
  confidence: number;
  reasoning: string;
  key_factors: string[];
}

export interface SearchListItem {
  id: string;
  query: string;
  searched_at: string;
  article_count: number;
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

export async function runSearch(query: string, limit?: number): Promise<SearchResult> {
  return callBundle('search', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  });
}

export async function getSearchResults(searchId: string): Promise<SearchResult> {
  return callBundle(`search-results?searchId=${encodeURIComponent(searchId)}`);
}

export async function listSearches(): Promise<{ searches: SearchListItem[] }> {
  return callBundle('searches');
}
```

**Key details:**

- **`BUNDLE_URL`** defaults to the in-cluster service name. Override it with an environment variable for local development (see Step 5).
- **`callBundle`** is the single point of contact with the agent bundle. It prepends `/api/` to all endpoints, sets the JSON content type, and handles error responses.
- **`data.result ?? data` unwrapping**: Bundle `@ApiEndpoint` methods return `{ success: true, result: <your return value> }`. The `?? data` fallback handles cases where the response shape differs (e.g., health checks).
- **TypeScript interfaces** mirror the shapes returned by `SearchEntity.get_results()` and `NewsAnalysisAgentBundle.listSearches()` from Part 1.

> **CRITICAL**: This module makes HTTP calls to the agent bundle, so it must only be used in server-side code (API routes, Server Components). Never import it in client components -- the `BUNDLE_URL` may not be reachable from the browser, and you would expose internal service addresses.

---

## Step 3: API Routes

The GUI uses Next.js API routes as a server-side proxy between the browser and the agent bundle. The browser calls `/api/search` on the Next.js server, which calls `POST /api/search` on the bundle.

This proxy pattern provides three benefits:

1. **No CORS issues** -- the browser only talks to its own origin
2. **Hidden infrastructure** -- the bundle's internal cluster URL is never exposed to the client
3. **Server-side validation** -- you can add authentication, rate limiting, or input sanitization in the API routes

### Search Route

Accepts a topic query from the browser and forwards it to the bundle's `search` endpoint. This triggers the full pipeline: web search, article entity creation, and AI analysis.

**`apps/news-analysis-gui/src/app/api/search/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { runSearch } from '@/lib/bundleClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty query' }, { status: 400 });
    }

    const result = await runSearch(query.trim(), limit);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /search] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Search failed' }, { status: 500 });
  }
}
```

### Results Route

Loads a previous search's results by ID. Used when clicking a search in the recent searches sidebar.

**`apps/news-analysis-gui/src/app/api/results/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSearchResults } from '@/lib/bundleClient';

export async function GET(request: NextRequest) {
  try {
    const searchId = request.nextUrl.searchParams.get('searchId');
    if (!searchId) {
      return NextResponse.json({ error: 'Missing searchId parameter' }, { status: 400 });
    }

    const result = await getSearchResults(searchId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /results] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Failed to get results' }, { status: 500 });
  }
}
```

### Searches Route

Returns the 20 most recent searches for the sidebar.

**`apps/news-analysis-gui/src/app/api/searches/route.ts`**:

```typescript
import { NextResponse } from 'next/server';
import { listSearches } from '@/lib/bundleClient';

export async function GET() {
  try {
    const result = await listSearches();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /searches] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Failed to list searches' }, { status: 500 });
  }
}
```

### Health Route

A simple health check endpoint used by Kubernetes probes. It does not call the bundle -- it only confirms the Next.js server is responding.

**`apps/news-analysis-gui/src/app/api/health/route.ts`**:

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'healthy', timestamp: new Date().toISOString() });
}
```

---

## Step 4: Search Page

Replace the scaffolded page with the full search interface. This is a single `'use client'` page with four components:

- **`HomePage`** -- the main page with search form, results grid, and sidebar layout
- **`ArticleCard`** -- displays an article with its AI analysis summary and expandable vertical details
- **`ImpactBadge`** -- a color-coded pill showing impact level per vertical
- **`RecentSearches`** -- sidebar listing previous searches, clickable to reload results

### Layout

First, set up the root layout to import Tailwind styles.

**`apps/news-analysis-gui/src/app/layout.tsx`**:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'News Impact Analyzer',
  description: 'AI-powered news article impact analysis across business verticals',
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

**`apps/news-analysis-gui/src/app/page.tsx`**:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Newspaper, Clock, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

// Types
interface VerticalImpact {
  impact_level: string;
  confidence: number;
  reasoning: string;
  key_factors: string[];
}

interface ImpactAnalysis {
  article_summary: string;
  healthcare: VerticalImpact;
  shipping_logistics: VerticalImpact;
  technology: VerticalImpact;
  overall_significance: string;
}

interface ArticleResult {
  title: string;
  url: string;
  snippet: string;
  published_date: string | null;
  analysis: ImpactAnalysis | null;
}

interface SearchResult {
  search_id: string;
  query: string;
  article_count: number;
  articles: ArticleResult[];
}

interface SearchListItem {
  id: string;
  query: string;
  searched_at: string;
  article_count: number;
}

// Impact badge colors
function getImpactColor(level: string): string {
  switch (level) {
    case 'critical': return 'bg-red-100 text-red-800 border-red-200';
    case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'low': return 'bg-green-100 text-green-800 border-green-200';
    case 'none': return 'bg-gray-100 text-gray-500 border-gray-200';
    default: return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function getSignificanceColor(level: string): string {
  switch (level) {
    case 'high': return 'text-orange-600';
    case 'medium': return 'text-yellow-600';
    case 'low': return 'text-green-600';
    default: return 'text-gray-500';
  }
}

// Impact Badge component
function ImpactBadge({ label, impact }: { label: string; impact: VerticalImpact }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getImpactColor(impact.impact_level)}`}>
      {label}: {impact.impact_level}
    </span>
  );
}

// Article Card component
function ArticleCard({ article }: { article: ArticleResult }) {
  const [expanded, setExpanded] = useState(false);
  const analysis = article.analysis;

  // Strip HTML tags from snippet
  const cleanSnippet = article.snippet.replace(/<[^>]*>/g, '');

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-blue-600 inline-flex items-center gap-1"
        >
          {article.title}
          <ExternalLink className="w-4 h-4 flex-shrink-0" />
        </a>
      </h3>

      {/* Snippet */}
      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{cleanSnippet}</p>

      {/* Analysis section */}
      {analysis ? (
        <>
          {/* Summary */}
          <p className="text-sm text-gray-700 mb-3 italic">{analysis.article_summary}</p>

          {/* Impact badges */}
          <div className="flex flex-wrap gap-2 mb-3">
            <ImpactBadge label="Healthcare" impact={analysis.healthcare} />
            <ImpactBadge label="Logistics" impact={analysis.shipping_logistics} />
            <ImpactBadge label="Technology" impact={analysis.technology} />
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${getSignificanceColor(analysis.overall_significance)}`}>
              Overall: {analysis.overall_significance}
            </span>
          </div>

          {/* Expand/collapse details */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expanded ? 'Hide details' : 'Show details'}
          </button>

          {expanded && (
            <div className="mt-3 space-y-4 border-t pt-3">
              {(['healthcare', 'shipping_logistics', 'technology'] as const).map((vertical) => {
                const v = analysis[vertical];
                const label = vertical === 'shipping_logistics' ? 'Shipping & Logistics'
                  : vertical.charAt(0).toUpperCase() + vertical.slice(1);
                return (
                  <div key={vertical}>
                    <h4 className="font-medium text-gray-900 text-sm mb-1">
                      {label}
                      <span className={`ml-2 ${getImpactColor(v.impact_level)} px-2 py-0.5 rounded text-xs`}>
                        {v.impact_level} ({Math.round(v.confidence * 100)}% confidence)
                      </span>
                    </h4>
                    <p className="text-sm text-gray-600 mb-1">{v.reasoning}</p>
                    <ul className="text-xs text-gray-500 list-disc list-inside">
                      {v.key_factors.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400 italic">Analysis pending...</p>
      )}
    </div>
  );
}

// Recent searches sidebar
function RecentSearches({
  searches,
  onSelect,
  loading,
}: {
  searches: SearchListItem[];
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded" />
        ))}
      </div>
    );
  }

  if (searches.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No recent searches</p>;
  }

  return (
    <div className="space-y-2">
      {searches.map((search) => (
        <button
          key={search.id}
          onClick={() => onSelect(search.id)}
          className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          <div className="text-sm font-medium text-gray-900 truncate">{search.query}</div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            {new Date(search.searched_at).toLocaleString()}
            <span className="ml-auto">{search.article_count} articles</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// Main page
export default function HomePage() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<SearchListItem[]>([]);
  const [loadingSearches, setLoadingSearches] = useState(true);

  // Fetch recent searches on mount
  const fetchSearches = useCallback(async () => {
    try {
      setLoadingSearches(true);
      const res = await fetch('/api/searches');
      if (res.ok) {
        const data = await res.json();
        setRecentSearches(data.searches || []);
      }
    } catch {
      // Silently ignore - recent searches are non-critical
    } finally {
      setLoadingSearches(false);
    }
  }, []);

  useEffect(() => {
    fetchSearches();
  }, [fetchSearches]);

  // Handle search submission
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || searching) return;

    setSearching(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 5 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Search failed');
      }

      const data = await res.json();
      setResults(data);
      // Refresh recent searches
      fetchSearches();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setSearching(false);
    }
  };

  // Load a previous search's results
  const loadSearch = async (searchId: string) => {
    setSearching(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`/api/results?searchId=${encodeURIComponent(searchId)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load results');
      }

      const data = await res.json();
      setResults(data);
      setQuery(data.query || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load search results');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-3">
            <Newspaper className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            News Impact Analyzer
          </h1>
          <p className="text-gray-600 max-w-xl mx-auto">
            Search any topic to discover recent news articles and get AI-powered impact analysis
            across Healthcare, Logistics, and Technology verticals.
          </p>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-8">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter a topic to analyze (e.g., AI chip breakthroughs)"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-gray-900 bg-white shadow-sm"
                disabled={searching}
              />
            </div>
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {searching ? 'Searching...' : 'Analyze'}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="max-w-2xl mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Loading state */}
        {searching && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
            <p className="text-gray-600">Searching and analyzing articles...</p>
            <p className="text-sm text-gray-400 mt-1">This may take 15-30 seconds</p>
          </div>
        )}

        {/* Content area: Results + Recent Searches */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Results (3/4 width) */}
          <div className="lg:col-span-3">
            {results && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">
                    Results for &ldquo;{results.query}&rdquo;
                  </h2>
                  <span className="text-sm text-gray-500">
                    ({results.article_count} article{results.article_count !== 1 ? 's' : ''})
                  </span>
                </div>
                <div className="space-y-4">
                  {results.articles.map((article, i) => (
                    <ArticleCard key={i} article={article} />
                  ))}
                </div>
                {results.articles.length === 0 && (
                  <p className="text-center text-gray-500 py-8">
                    No articles found for this topic. Try a different search term.
                  </p>
                )}
              </>
            )}

            {!results && !searching && !error && (
              <div className="text-center py-16 text-gray-400">
                <Newspaper className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">Enter a topic above to start analyzing news</p>
              </div>
            )}
          </div>

          {/* Recent Searches sidebar (1/4 width) */}
          <div className="lg:col-span-1">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Recent Searches
            </h3>
            <RecentSearches
              searches={recentSearches}
              onSelect={loadSearch}
              loading={loadingSearches}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Component breakdown:**

### ImpactBadge

A small pill component that maps impact levels to Tailwind color classes:

| Impact Level | Color |
|-------------|-------|
| `none` | Gray |
| `low` | Green |
| `medium` | Yellow |
| `high` | Orange |
| `critical` | Red |

These levels match the enum values in the Zod schema from Part 2.

### ArticleCard

Each card displays:

1. **Title** -- linked to the original article URL with an external link icon
2. **Snippet** -- truncated to two lines, with HTML tags stripped
3. **AI summary** -- the `article_summary` from the analysis, shown in italics
4. **Impact badges** -- one per vertical (Healthcare, Logistics, Technology) plus an overall significance indicator
5. **Expandable details** -- clicking "Show details" reveals the full reasoning, confidence percentage, and key factors for each vertical

When `analysis` is `null` (the article hasn't been analyzed yet), the card shows "Analysis pending..." instead.

### RecentSearches

The sidebar loads the 20 most recent searches from `/api/searches` on page mount. Each entry shows the query text, timestamp, and article count. Clicking an entry calls `loadSearch()`, which fetches the results from `/api/results?searchId=...` and populates the results area without running a new search.

### HomePage

The main component manages five pieces of state:

- `query` -- the search input value
- `searching` -- whether a search is in progress (shows the loading spinner)
- `results` -- the current `SearchResult` being displayed
- `error` -- error message string, if any
- `recentSearches` / `loadingSearches` -- sidebar data and its loading state

The search flow:

1. User types a topic and submits the form
2. `handleSearch` POSTs to `/api/search` with the query
3. The loading spinner appears (searches take 15-30 seconds because each article triggers an LLM analysis call)
4. On success, results are displayed and the recent searches sidebar refreshes

---

## Step 5: Configure and Run

Set the `BUNDLE_URL` environment variable so the GUI knows where to reach the agent bundle.

### Local Development

**`apps/news-analysis-gui/.env.local`**:

```bash
BUNDLE_URL=http://localhost:3001
```

> For local development, port-forward the bundle first: `kubectl port-forward svc/news-analysis-bundle-agent-bundle 3001:3000`

Run the GUI:

```bash
cd apps/news-analysis-gui
pnpm dev
```

Open `http://localhost:3000` in your browser. You should see the News Impact Analyzer interface with a search bar and an empty recent searches sidebar. Type a topic like "AI chip breakthroughs" and click Analyze. After 15-30 seconds the results will appear with impact badges for each vertical.

### Deployed Environment

For a deployed environment, set `BUNDLE_URL` in `values.local.yaml`. The URL points to the bundle's in-cluster service name:

**`apps/news-analysis-gui/helm/values.local.yaml`**:

```yaml
replicaCount: 1

image:
  repository: firebranddevet.azurecr.io/news-analysis-gui
  tag: latest
  pullPolicy: Always

service:
  type: ClusterIP
  port: 3000

configMap:
  enabled: true
  data:
    PORT: "3001"
    HOSTNAME: "0.0.0.0"
    NODE_ENV: "production"
    BUNDLE_URL: "http://news-analysis-bundle-agent-bundle.ff-dev.svc.cluster.local:3000"

secret:
  enabled: false

containerPort: 3001

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

startupProbe:
  httpGet:
    path: /api/health
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 10

livenessProbe:
  httpGet:
    path: /api/health
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /api/health
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 10
```

Build and deploy:

```bash
ff ops build --app-name news-analysis-gui
ff ops deploy --app-name news-analysis-gui
```

---

## Bundle Client Method Summary

Here's a quick reference for the bundle client functions used in this tutorial:

| Function | Purpose | Used In |
|----------|---------|---------|
| `runSearch(query, limit?)` | Run a new search with AI analysis | Search API route |
| `getSearchResults(searchId)` | Load a previous search's results | Results API route |
| `listSearches()` | List the 20 most recent searches | Searches API route |

Each function calls the corresponding `@ApiEndpoint` on the agent bundle from Part 1: `POST /api/search`, `GET /api/search-results`, and `GET /api/searches`.

---

## What's Next

You now have a complete news analysis application: the browser sends a topic to the Next.js API routes, which proxy the request to the agent bundle. The bundle runs a web search, creates entity nodes for each article, triggers AI impact analysis via the structured output bot, and returns the results. The GUI displays everything with color-coded impact badges and expandable details per vertical.

From here you can:

- **Add filtering and sorting.** Let users filter articles by impact level or sort by confidence score within the page component.
- **Stream progress updates.** Replace the static loading spinner with real-time progress by adding SSE (Server-Sent Events) to show each article as its analysis completes.
- **Add authentication.** Wrap the API routes with session middleware to restrict access and associate searches with users.
- **Extend the verticals.** Add new verticals to the Zod schema in Part 2, update the prompt, and add matching `ImpactBadge` entries in the page component.
