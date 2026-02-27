# Part 4: Building a Web GUI

So far we've been testing our agent bundle from the command line -- typing JSON payloads into `ff-sdk-cli` and reading JSON responses. That works for development, but it's not what your users will experience. In this part, we'll build a browser-based interface that makes the agent bundle feel like a product.

Here's what the finished GUI looks like in use: a user opens the page, sees two modes -- **TypeScript** for general computation and **Data Science** for database queries. They pick a mode, type a question in plain English, and hit Run. A few seconds later, the result appears: structured data for data science queries (rendered as a table), or a computed value for TypeScript tasks. There's an execution history so they can see past results, and suggested prompts to help them get started.

The agent bundle doesn't change at all. We're adding a thin web layer in front of it.

**What you'll learn:**
- The thin-proxy pattern: browser → Next.js API routes → agent bundle
- Scaffolding a Next.js app inside the monorepo
- API route proxying with `fetch`
- Building a dual-mode interface with result formatting

**What you'll build:** A Next.js web application that provides a browser-based interface for both endpoints.

---

## The Thin-Proxy Pattern

The GUI is intentionally simple. It doesn't contain any AI logic, prompt building, or sandbox interaction. All of that stays in the agent bundle. The GUI is a **thin proxy** that:

1. Collects user input (mode + prompt)
2. Forwards it to the agent bundle's API
3. Displays the result

```
Browser                    Next.js Server              Agent Bundle
  |                            |                           |
  |  POST /api/execute         |                           |
  |  { prompt: "..." }         |                           |
  |--------------------------->|                           |
  |                            |  POST /api/execute        |
  |                            |  { prompt: "..." }        |
  |                            |-------------------------->|
  |                            |                           |
  |                            |  { success, output, ... } |
  |                            |<--------------------------|
  |  { success, output, ... }  |                           |
  |<---------------------------|                           |
  |                            |                           |
  |  Renders result            |                           |
```

Why the middle layer? The Next.js server acts as a proxy so the browser never talks directly to the agent bundle. This keeps the bundle URL internal, lets you add authentication later, and follows the same pattern used across FireFoundry applications.

## Step 1: Scaffold the Next.js App

Create a new app inside the monorepo:

```bash
cd apps
npx create-next-app@latest coder-gui \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --no-eslint \
  --no-import-alias
```

When prompted, accept the defaults. Then update the `package.json` name:

```json
{
  "name": "coder-gui",
  "private": true
}
```

Add it to the workspace. In the root `pnpm-workspace.yaml`, the `apps/*` glob already covers it.

Install dependencies:

```bash
cd ..
pnpm install
```

## Step 2: Configure Next.js

Update `apps/coder-gui/next.config.mjs` for standalone output (required for Docker deployment):

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
};

export default nextConfig;
```

Add a `BUNDLE_URL` environment variable. Create `apps/coder-gui/.env.local`:

```
BUNDLE_URL=http://localhost:3001
```

This points the GUI at the agent bundle. In production, this would be the internal service URL.

## Step 3: Create the Bundle Client

This is the server-side module that talks to the agent bundle. It's a thin wrapper around `fetch`.

Create `apps/coder-gui/src/lib/bundleClient.ts`:

```typescript
export interface ExecutionResult {
  success: boolean;
  output: {
    description: string;
    result: any;
    stdout?: string;
  } | null;
  entity_id: string;
}

const BUNDLE_URL = process.env.BUNDLE_URL || "http://localhost:3001";

async function callBundle(route: string, prompt: string): Promise<ExecutionResult> {
  const resp = await fetch(`${BUNDLE_URL}/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bundle returned ${resp.status}: ${text}`);
  }

  return resp.json();
}

export async function executeCode(prompt: string): Promise<ExecutionResult> {
  return callBundle("execute", prompt);
}

export async function analyzeData(prompt: string): Promise<ExecutionResult> {
  return callBundle("analyze", prompt);
}
```

Three functions: `callBundle` does the actual HTTP call, `executeCode` and `analyzeData` are named wrappers for the two endpoints. The bundle URL comes from an environment variable so it works in any deployment.

## Step 4: Create API Routes

Next.js API routes act as the proxy layer. Each route validates the input, calls the bundle client, and returns the result.

**`apps/coder-gui/src/app/api/execute/route.ts`**:

```typescript
import { NextResponse } from "next/server";
import { executeCode } from "@/lib/bundleClient";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    const result = await executeCode(prompt);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

**`apps/coder-gui/src/app/api/analyze/route.ts`**:

```typescript
import { NextResponse } from "next/server";
import { analyzeData } from "@/lib/bundleClient";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    const result = await analyzeData(prompt);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

Identical structure -- validate, call, return. The route path (`/api/execute` vs `/api/analyze`) determines which bundle endpoint gets called.

## Step 5: Build the Page

Now the fun part -- the UI. We'll build a single page with:

- A **mode toggle** to switch between TypeScript and Data Science
- A **prompt textarea** where users type their question
- A **Run button** (also triggered by Cmd/Ctrl+Enter)
- A **result panel** that shows the output, with smart formatting for tabular data
- **Suggested prompts** to help users get started

**`apps/coder-gui/src/app/page.tsx`**:

```tsx
"use client";

import { useState } from "react";

type Mode = "typescript" | "datascience";

interface Result {
  success: boolean;
  output: {
    description: string;
    result: any;
    stdout?: string;
  } | null;
  error?: string;
}

const SUGGESTIONS: Record<Mode, string[]> = {
  typescript: [
    "Calculate the first 20 Fibonacci numbers",
    "Sort [42, 7, 13, 99, 1, 55] using quicksort and count comparisons",
    "Generate all prime numbers less than 200",
  ],
  datascience: [
    "What is the total revenue by product category?",
    "Which customers have placed the most orders? Show the top 10.",
    "Calculate the month-over-month revenue growth for the last 12 months",
  ],
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("typescript");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRun() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResult(null);

    try {
      const route = mode === "typescript" ? "execute" : "analyze";
      const resp = await fetch(`/api/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setResult({ success: false, output: null, error: data.error });
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setResult({ success: false, output: null, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Code Sandbox</h1>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode("typescript")}
          className={`px-4 py-2 rounded ${
            mode === "typescript"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-700"
          }`}
        >
          TypeScript
        </button>
        <button
          onClick={() => setMode("datascience")}
          className={`px-4 py-2 rounded ${
            mode === "datascience"
              ? "bg-emerald-600 text-white"
              : "bg-gray-200 text-gray-700"
          }`}
        >
          Data Science
        </button>
      </div>

      {/* Prompt input */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          mode === "typescript"
            ? "Describe a computation..."
            : "Ask a question about the data..."
        }
        className="w-full h-32 p-3 border rounded mb-2 font-mono text-sm"
      />

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handleRun}
          disabled={loading || !prompt.trim()}
          className="px-6 py-2 bg-gray-900 text-white rounded disabled:opacity-50"
        >
          {loading ? "Running..." : "Run"}
        </button>
        <span className="text-xs text-gray-400">⌘+Enter to run</span>
      </div>

      {/* Suggestions */}
      <div className="flex flex-wrap gap-2 mb-6">
        {SUGGESTIONS[mode].map((s) => (
          <button
            key={s}
            onClick={() => { setPrompt(s); }}
            className="text-xs px-3 py-1 bg-gray-100 rounded-full hover:bg-gray-200"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </main>
  );
}

function ResultPanel({ result }: { result: Result }) {
  if (result.error) {
    return (
      <div className="border border-red-300 rounded p-4 bg-red-50">
        <p className="font-semibold text-red-700">Error</p>
        <p className="text-sm text-red-600 mt-1">{result.error}</p>
      </div>
    );
  }

  if (!result.output) return null;

  const { description, result: data, stdout } = result.output;

  return (
    <div className="border rounded p-4 space-y-3">
      <p className="font-semibold">{description}</p>

      {/* Smart rendering: table for arrays of objects, pre for everything else */}
      {Array.isArray(data) && data.length > 0 && typeof data[0] === "object" ? (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr>
                {Object.keys(data[0]).map((key) => (
                  <th key={key} className="border px-3 py-1 bg-gray-50 text-left">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row: any, i: number) => (
                <tr key={i}>
                  {Object.values(row).map((val: any, j: number) => (
                    <td key={j} className="border px-3 py-1">
                      {typeof val === "number" ? val.toLocaleString() : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="text-sm bg-gray-50 p-3 rounded overflow-x-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}

      {stdout && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500">Console output</summary>
          <pre className="mt-1 bg-gray-50 p-2 rounded">{stdout}</pre>
        </details>
      )}
    </div>
  );
}
```

Let's walk through the key design decisions:

**Mode toggle** -- two buttons at the top, color-coded (blue for TypeScript, green for Data Science). Switching modes changes the placeholder text and suggested prompts, and determines which API route gets called.

**Keyboard shortcut** -- Cmd+Enter (or Ctrl+Enter on Windows/Linux) submits the prompt. Power users expect this.

**Suggested prompts** -- clickable pills below the input that populate the prompt field. Different suggestions for each mode. These help users understand what's possible without reading documentation.

**Smart result rendering** -- the `ResultPanel` checks the shape of the result. If it's an array of objects (which is what most data science queries return), it renders a table with column headers. Otherwise, it renders formatted JSON. This single check handles both modes elegantly.

**Console output** -- hidden behind a `<details>` toggle. Most users don't care about stdout, but it's there for debugging.

## Step 6: Build and Test

Start the GUI in development mode:

```bash
cd apps/coder-gui
pnpm dev
```

Open `http://localhost:3000` in your browser. You should see:

1. The mode toggle (TypeScript selected by default)
2. A text area with suggested prompts below it
3. Click a suggestion or type your own prompt
4. Click Run (or press Cmd+Enter)
5. See the result appear below

Try switching to Data Science mode and asking "What is the total revenue by product category?" -- you should see the result rendered as a table.

For production deployment:

```bash
pnpm run build
ff-cli ops build coder-gui
ff-cli ops install coder-gui
```

## Key Takeaways

1. **The GUI is a thin proxy** -- no AI logic, no prompt building, no sandbox interaction. It collects input, forwards it, and displays results. All the intelligence stays in the agent bundle.

2. **API routes are the proxy layer** -- Next.js API routes forward requests to the agent bundle, keeping the bundle URL internal and providing a place to add authentication later.

3. **Smart rendering adapts to the data** -- checking if the result is an array of objects lets you render tables for data science results and formatted JSON for everything else, without mode-specific rendering logic.

4. **The agent bundle doesn't change** -- we added an entire web application without modifying a single line of the agent bundle. This is the benefit of clean API boundaries.

## Next Steps

We have a complete application: two AI-powered endpoints backed by a web GUI. In [Part 5: Deployment, Testing & Troubleshooting](./part-05-deployment-and-testing.md), we'll deploy the full stack to a FireFoundry cluster, test it systematically, and learn to diagnose problems when things go wrong.
