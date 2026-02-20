# Part 6: Web GUI

In this part, you'll build a Next.js web interface that lets users enter natural language prompts, switch between TypeScript and Data Science modes, and view generated code execution results.

## Scaffold the GUI

Use `ff-cli` to add a GUI app to the project:

```bash
ff gui add coder-gui
```

This creates a Next.js app at `apps/coder-gui/` with the standard project structure.

Install Tailwind CSS and the icon library:

```bash
cd apps/coder-gui
pnpm add lucide-react
pnpm add -D tailwindcss autoprefixer postcss
npx tailwindcss init -p
```

Configure Tailwind in `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

Add Tailwind imports to `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Architecture: API Route Proxying

The browser never calls the agent bundle directly. Instead, Next.js API routes act as server-side proxies:

```
Browser                    Next.js API Routes          Agent Bundle
  |                              |                          |
  |-- POST /api/execute -------->|                          |
  |                              |-- POST /api/execute ---->|
  |                              |<--- { result } ---------|
  |<--- { result } -------------|                          |
```

This pattern hides infrastructure URLs from the browser, avoids CORS issues, and lets you add validation or authentication in the proxy layer.

## Bundle Client

Create a typed fetch wrapper at `src/lib/bundleClient.ts`:

```typescript
/**
 * Server-side client for the coder-bundle agent bundle.
 * Calls bundle API endpoints from Next.js API routes.
 */

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://coder-bundle-agent-bundle:3000';

export interface ExecutionResult {
  success: boolean;
  output: {
    description: string;
    result: unknown;
    stdout?: string;
    metadata?: Record<string, unknown>;
  } | null;
  entity_id: string;
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

export async function executeCode(prompt: string): Promise<ExecutionResult> {
  return callBundle('execute', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}

export async function analyzeData(prompt: string): Promise<ExecutionResult> {
  return callBundle('analyze', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}
```

**Key patterns:**
- `BUNDLE_URL` comes from an environment variable, with a sensible default for in-cluster deployment
- `data.result ?? data` unwraps the bundle's response wrapper (bundles return `{ result: ... }`)
- Each exported function maps to one bundle API endpoint

## API Routes

Create two API routes that proxy requests to the bundle.

### `src/app/api/execute/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { executeCode } from '@/lib/bundleClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty prompt' }, { status: 400 });
    }

    const result = await executeCode(prompt.trim());
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /execute] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Execution failed' }, { status: 500 });
  }
}
```

### `src/app/api/analyze/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { analyzeData } from '@/lib/bundleClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or empty prompt' }, { status: 400 });
    }

    const result = await analyzeData(prompt.trim());
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /analyze] Error:', error.message);
    return NextResponse.json({ error: error.message || 'Analysis failed' }, { status: 500 });
  }
}
```

## Page Component

The main page provides a two-panel interface: prompt input on the left, execution history on the right.

Create `src/app/page.tsx`:

```typescript
'use client';

import { useState, useCallback } from 'react';
import { Play, Terminal, Database, Loader2, AlertCircle } from 'lucide-react';

type Mode = 'typescript' | 'datascience';

interface ExecutionOutput {
  description: string;
  result: unknown;
  stdout?: string;
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex rounded-lg bg-gray-100 p-1">
      <button
        onClick={() => onChange('typescript')}
        className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          mode === 'typescript'
            ? 'bg-white text-blue-700 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        <Terminal className="w-4 h-4" />
        TypeScript
      </button>
      <button
        onClick={() => onChange('datascience')}
        className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          mode === 'datascience'
            ? 'bg-white text-emerald-700 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        <Database className="w-4 h-4" />
        Data Science
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result display
// ---------------------------------------------------------------------------

function ResultPanel({ output, error }: { output: ExecutionOutput | null; error?: string }) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
          <AlertCircle className="w-4 h-4" />
          Error
        </div>
        <pre className="text-sm text-red-600 whitespace-pre-wrap font-mono">{error}</pre>
      </div>
    );
  }

  if (!output) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-500 mb-1">Description</h3>
        <p className="text-gray-900">{output.description}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-500 mb-2">Result</h3>
        <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono bg-gray-50 rounded p-3 overflow-auto max-h-96">
          {JSON.stringify(output.result, null, 2)}
        </pre>
      </div>

      {output.stdout && output.stdout.trim().length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Console Output</h3>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded p-3 max-h-48 overflow-auto">
            {output.stdout}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [mode, setMode] = useState<Mode>('typescript');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<ExecutionOutput | null>(null);
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setOutput(null);
    setError(undefined);

    try {
      const endpoint = mode === 'typescript' ? '/api/execute' : '/api/analyze';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

      setOutput(data.output);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [prompt, mode, loading]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Code Sandbox</h1>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-6 space-y-4">
        {/* Prompt input */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              mode === 'typescript'
                ? 'e.g., Calculate the first 20 Fibonacci numbers'
                : 'e.g., What is the average order value by customer segment?'
            }
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-400">Cmd+Enter to run</span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || loading}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Generating and executing code...</p>
          </div>
        )}

        {/* Results */}
        {!loading && <ResultPanel output={output} error={error} />}
      </main>
    </div>
  );
}
```

The full source with execution history and table rendering for data science results is available in the [demo app source](https://github.com/firebrandanalytics/ff-demo-apps/tree/main/code-sandbox/apps/coder-gui).

## Configuration

Set the `BUNDLE_URL` environment variable to point to the coder-bundle. During local development with the bundle running on port 3000:

```
BUNDLE_URL=http://localhost:3000
```

In production deployments, this points to the bundle's internal service URL.

## Build and Deploy

```bash
ff-cli ops build coder-gui
ff-cli ops install coder-gui
```

## Key Points

> **API routes proxy to the bundle** -- The browser never calls the bundle directly. Next.js API routes handle the server-to-server communication.

> **No SDK dependency needed** -- For custom API endpoints (`@ApiEndpoint`), a typed fetch wrapper is sufficient. Use `@firebrandanalytics/ff-sdk` when you need entity method invocation or file uploads.

> **`data.result ?? data`** -- Bundle responses are wrapped in `{ result: ... }`. The `?? data` fallback handles both wrapped and unwrapped responses.

> **BUNDLE_URL from environment** -- Always configure the bundle URL via environment variable for portability between development and production.

---

**Back to:** [Tutorial Index](./README.md)
