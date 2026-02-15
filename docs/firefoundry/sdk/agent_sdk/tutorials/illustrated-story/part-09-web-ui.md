# Part 9: Building the Web UI

In this part, you'll build a Next.js web application that serves as the frontend for the illustrated storybook generator. The GUI is a thin proxy to the agent bundle's API endpoints -- it does not call the LLM directly. Users fill out a form, the form submits to Next.js API routes, and those routes forward requests to the running bundle.

**What you'll learn:**
- Scaffolding a Next.js 15 app inside the existing monorepo
- Configuring Next.js for ESM-only SDK packages (`serverExternalPackages`)
- Using `RemoteAgentBundleClient` to communicate with the bundle from API routes
- Building API route proxies that forward requests to the bundle
- Handling binary downloads with `call_api_endpoint_binary` and `Uint8Array`
- Creating a Tailwind theme with custom storybook colors
- Building a story creation form with customization options

**What you'll build:** A Next.js frontend with a story form component, four API route proxies (`create`, `status`, `progress`, `download`), server-side configuration for the bundle client, and a custom Tailwind theme.

**Starting point:** Completed code from [Part 8: Input Validation & Error Handling](./part-08-input-validation.md). You should have a fully working backend with content safety, story generation, parallel image generation, customization options, and input validation.

---

## Concepts: The GUI as a Thin Proxy

The web UI does not contain any AI logic. It does not import agent SDK classes, create entities, or call the LLM. Instead, it communicates with the running agent bundle over HTTP using `RemoteAgentBundleClient` from `@firebrandanalytics/ff-sdk` (the client SDK, not the agent SDK).

```
Browser (React)
    |
    | fetch('/api/create', { body: { topic, customization } })
    v
Next.js API Route (/api/create/route.ts)
    |
    | client.call_api_endpoint('create-story', { method: 'POST', body })
    v
Agent Bundle (story-bundle on port 3001)
    |
    | creates StoryPipelineEntity, returns entity_id
    v
Next.js API Route returns { entity_id } to browser
```

This separation means:
- The bundle can run anywhere (local, Kubernetes, remote cluster)
- The GUI only needs the bundle's URL
- Multiple GUIs can share one bundle
- The GUI is independently deployable as a standard Next.js app

---

## Step 1: Scaffold the Frontend App

Create the `story-gui` directory alongside the existing `story-bundle`:

```
illustrated-story/
├── apps/
│   ├── story-bundle/     # Backend (Parts 1-8)
│   └── story-gui/        # Frontend (this part)
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx
│       │   │   ├── layout.tsx
│       │   │   ├── globals.css
│       │   │   └── api/
│       │   │       ├── create/route.ts
│       │   │       ├── status/route.ts
│       │   │       ├── progress/route.ts
│       │   │       └── download/route.ts
│       │   ├── components/
│       │   │   ├── StoryForm.tsx
│       │   │   ├── ProgressPanel.tsx
│       │   │   └── ResultPanel.tsx
│       │   ├── hooks/
│       │   │   └── useStoryGeneration.ts
│       │   ├── lib/
│       │   │   ├── serverConfig.ts
│       │   │   └── storyApi.ts
│       │   └── types/
│       │       └── index.ts
│       ├── next.config.mjs
│       ├── tailwind.config.ts
│       ├── postcss.config.cjs
│       ├── tsconfig.json
│       └── package.json
```

### package.json

**`apps/story-gui/package.json`**:

```json
{
  "name": "story-gui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start --port 3002"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.400.0",
    "@firebrandanalytics/ff-sdk": "^4.0.0",
    "@shared/types": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

Key dependencies:
- **`next@15` / `react@19`** -- the latest Next.js with the App Router and React Server Components
- **`lucide-react`** -- lightweight icon library for the form UI
- **`@firebrandanalytics/ff-sdk`** -- the client SDK, used server-side to talk to the bundle
- **`@shared/types`** -- the workspace shared-types package from the monorepo
- **`tailwindcss`** -- utility-first CSS framework for styling

Add the new app to the workspace. In the root `pnpm-workspace.yaml`, the existing `apps/*` glob already covers `story-gui`.

Install dependencies:

```bash
pnpm install
```

---

## Step 2: Configure Next.js

The Next.js configuration handles three things: standalone output for Docker, ESM-only package compatibility, and client-side webpack fallbacks.

**`apps/story-gui/next.config.mjs`**:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['lucide-react'],
  serverExternalPackages: [
    '@firebrandanalytics/ff-sdk',
    '@firebrandanalytics/entity-client',
  ],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
```

### Why Each Setting Matters

**`output: 'standalone'`** -- produces a self-contained build that includes only the files needed to run. This is required for Docker deployment. Without it, `next start` expects the full `node_modules` directory to be present.

**`serverExternalPackages`** -- this is the critical setting. The `@firebrandanalytics/ff-sdk` and `@firebrandanalytics/entity-client` packages are ESM-only. Next.js's server-side bundler (webpack) tries to bundle all imports into a single file. ESM-only packages with complex module resolution fail during this bundling step. By listing them in `serverExternalPackages`, you tell Next.js: "leave these as external `import` statements -- don't try to bundle them." The packages are loaded at runtime from `node_modules` instead.

If you omit this setting, you will see errors like:

```
Error: Cannot find module '@firebrandanalytics/ff-sdk'
```

or:

```
Module parse failed: Unexpected token 'export'
```

**`transpilePackages: ['lucide-react']`** -- the opposite situation. `lucide-react` uses ESM exports that Next.js needs to transpile (convert to a format the bundler can process). Without this, tree-shaking fails and you may get import errors on the client side.

**Client-side webpack fallbacks** -- the SDK packages reference Node.js builtins (`fs`, `net`, `tls`, `child_process`). These only run on the server side (in API routes), but webpack analyzes the entire dependency tree during the client build. Setting these to `false` tells webpack to replace them with empty modules on the client side, preventing "Module not found" errors.

---

## Step 3: Configure TypeScript

**`apps/story-gui/tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2017",
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
    "paths": {
      "@/*": ["./src/*"],
      "@shared/types": ["../../packages/shared-types/src"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

The `paths` configuration maps two aliases:
- **`@/*`** maps to `src/*` -- standard Next.js convention for importing project files (`import { StoryForm } from '@/components/StoryForm'`)
- **`@shared/types`** maps to the workspace shared-types package -- the same types used by the backend (`import type { PipelineResult } from '@shared/types'`)

---

## Step 4: Configure PostCSS and Tailwind

### PostCSS

**`apps/story-gui/postcss.config.cjs`**:

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

This file must use the `.cjs` extension, not `.js`. Because `package.json` has `"type": "module"`, Node.js treats `.js` files as ES modules. PostCSS's config loader uses `require()`, which does not work with ES modules. Using `.cjs` forces CommonJS mode for this file only.

### Tailwind Theme

**`apps/story-gui/tailwind.config.ts`**:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        storybook: {
          bg: '#FFF8F0',
          card: '#FFFFFF',
          primary: '#E8735A',
          secondary: '#5B9BD5',
          accent: '#F4C542',
          text: '#3D3D3D',
          muted: '#8E8E93',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
```

The custom `storybook` color palette gives the app a warm, inviting look suited for a children's storybook generator:

| Token | Hex | Purpose |
|-------|-----|---------|
| `bg` | `#FFF8F0` | Warm cream page background |
| `card` | `#FFFFFF` | White card surfaces |
| `primary` | `#E8735A` | Warm coral for buttons, accents |
| `secondary` | `#5B9BD5` | Soft blue for secondary actions, selections |
| `accent` | `#F4C542` | Golden yellow for highlights |
| `text` | `#3D3D3D` | Dark gray body text |
| `muted` | `#8E8E93` | Subtle gray for secondary text |

Usage in components: `className="bg-storybook-bg text-storybook-text"`, `className="bg-storybook-primary hover:bg-storybook-primary/90"`.

### Global Styles

**`apps/story-gui/src/app/globals.css`**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: 'Georgia', 'Times New Roman', serif;
}
```

The serif font reinforces the storybook aesthetic. Tailwind's utility classes handle everything else.

---

## Step 5: Server Configuration -- Connecting to the Bundle

The GUI's server-side code needs a client that can talk to the running bundle. This is `RemoteAgentBundleClient` from the client SDK.

**`apps/story-gui/src/lib/serverConfig.ts`**:

```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

const BUNDLE_URL = process.env.BUNDLE_URL || 'http://localhost:3001';

let _client: RemoteAgentBundleClient | null = null;

export function getBundleClient(): RemoteAgentBundleClient {
  if (!_client) {
    _client = new RemoteAgentBundleClient(BUNDLE_URL, { timeout: 300_000 });
  }
  return _client;
}
```

### How This Works

`RemoteAgentBundleClient` is the SDK's HTTP client for communicating with agent bundles. It handles the HTTP protocol for calling API endpoints, consuming iterators, and downloading binary artifacts.

Key details:

- **Singleton pattern** -- the client is created once and reused across all API route invocations. There is no per-request state in the client, so sharing it is safe.
- **`BUNDLE_URL`** -- the base URL of the running bundle. In local development, this is `http://localhost:3001` (the bundle's default port). In production, this points to the bundle's Kubernetes service URL.
- **`timeout: 300_000`** -- 5-minute timeout. Story generation involves LLM calls, image generation, and PDF conversion. A short timeout would cause failures during normal operation.

This file is imported only by server-side code (API routes). It never runs in the browser. The `serverExternalPackages` setting from Step 2 ensures the SDK is loaded correctly at runtime.

---

## Step 6: Type Definitions

Re-export shared types and add UI-specific types.

**`apps/story-gui/src/types/index.ts`**:

```typescript
export type {
  CreateStoryRequest,
  CreateStoryResponse,
  StoryStatusResponse,
  StoryEntityData,
  StoryCustomization,
  IllustrationStyle,
  ImageQualityLevel,
  AspectRatioOption,
  PipelineResult,
} from '@shared/types';

export interface ProgressMessage {
  type: 'INTERNAL_UPDATE' | 'VALUE' | 'DONE' | 'ERROR';
  sub_type?: string;
  message?: string;
  value?: any;
  error?: string;
}

export type UIStage =
  | 'idle'
  | 'creating'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'failed';
```

The re-exports bring in the shared types from the workspace package. `ProgressMessage` types the SSE messages from the progress endpoint. `UIStage` mirrors the lifecycle stages used by the `useStoryGeneration` hook (Part 10).

---

## Step 7: API Route Proxies

Each API route is a thin proxy that receives a request from the browser, forwards it to the bundle via `RemoteAgentBundleClient`, and returns the response.

### POST /api/create

Creates a new story pipeline entity.

**`apps/story-gui/src/app/api/create/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getBundleClient } from '@/lib/serverConfig';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const client = getBundleClient();
    const result = await client.call_api_endpoint('create-story', {
      method: 'POST',
      body,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API /create]', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create story' },
      { status: 500 },
    );
  }
}
```

`client.call_api_endpoint('create-story', { method: 'POST', body })` calls the bundle's `@ApiEndpoint({ method: 'POST', route: 'create-story' })` method (defined in Part 4). The first argument is the route name, and the second specifies the HTTP method and body. The result is the `CreateStoryResponse` returned by the bundle.

### GET /api/status

Polls the pipeline entity's current stage.

**`apps/story-gui/src/app/api/status/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getBundleClient } from '@/lib/serverConfig';

export async function GET(req: NextRequest) {
  try {
    const entityId = req.nextUrl.searchParams.get('entity_id');
    if (!entityId) {
      return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
    }
    const client = getBundleClient();
    const result = await client.call_api_endpoint(
      'story-status',
      { query: { entity_id: entityId } },
    );
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API /status]', err);
    return NextResponse.json(
      { error: err.message || 'Failed to get status' },
      { status: 500 },
    );
  }
}
```

The `query` option passes query parameters to the bundle endpoint. The bundle's `getStoryStatus` method (Part 4) reads `query.entity_id` and returns the entity's data including its current `stage`.

### GET /api/download

Downloads a binary artifact (PDF or HTML) from working memory.

**`apps/story-gui/src/app/api/download/route.ts`**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getBundleClient } from '@/lib/serverConfig';

export async function GET(req: NextRequest) {
  try {
    const wmId = req.nextUrl.searchParams.get('wm_id');
    if (!wmId) {
      return NextResponse.json({ error: 'wm_id required' }, { status: 400 });
    }

    const client = getBundleClient();

    const result = await client.call_api_endpoint_binary('download', {
      query: { wm_id: wmId },
    });

    return new Response(new Uint8Array(result), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
      },
    });
  } catch (err: any) {
    console.error('[API /download]', err);
    return NextResponse.json(
      { error: err.message || 'Download failed' },
      { status: 500 },
    );
  }
}
```

### Binary Downloads: `call_api_endpoint_binary` and `Uint8Array`

This route uses `call_api_endpoint_binary` instead of `call_api_endpoint`. The binary variant returns the response body as a `Buffer` (or `ArrayBuffer`-like object) rather than parsing it as JSON. This is necessary for PDF and HTML file downloads.

The critical detail is the `new Uint8Array(result)` wrapper. The web `Response` constructor does not accept a Node.js `Buffer` directly -- `Buffer` is a Node.js class, not a standard web API. `Uint8Array` is a standard typed array that both Node.js and the web `Response` API understand. Wrapping the buffer in `Uint8Array` bridges this gap.

If you pass `result` directly without wrapping:

```typescript
// WRONG: Response may not accept Node.js Buffer
return new Response(result, { ... });

// CORRECT: Uint8Array is universally accepted
return new Response(new Uint8Array(result), { ... });
```

The `Content-Disposition: attachment` header tells the browser to download the file rather than displaying it inline.

### GET /api/progress

This route handles Server-Sent Events (SSE) for real-time progress streaming. It is covered in detail in [Part 10](./part-10-streaming-and-downloads.md). For now, create a placeholder:

**`apps/story-gui/src/app/api/progress/route.ts`**:

```typescript
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  // SSE streaming implementation -- see Part 10
  return new Response('Progress streaming not yet implemented', { status: 501 });
}
```

---

## Step 8: Client-Side API Functions

The browser-side code calls the Next.js API routes (not the bundle directly). These functions handle serialization, error handling, and file downloads.

**`apps/story-gui/src/lib/storyApi.ts`**:

```typescript
import type {
  CreateStoryResponse,
  StoryStatusResponse,
  StoryCustomization,
} from '@shared/types';

export async function createStory(
  topic: string,
  customization?: StoryCustomization,
): Promise<CreateStoryResponse> {
  const res = await fetch('/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, customization }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to create story');
  }
  return res.json();
}

export async function getStoryStatus(entityId: string): Promise<StoryStatusResponse> {
  const res = await fetch(`/api/status?entity_id=${encodeURIComponent(entityId)}`);
  if (!res.ok) {
    throw new Error('Failed to get status');
  }
  return res.json();
}

export async function downloadArtifact(
  wmId: string,
  filename: string,
): Promise<void> {
  const res = await fetch(`/api/download?wm_id=${encodeURIComponent(wmId)}`);
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### The Download Flow

The `downloadArtifact` function deserves explanation. Browser `fetch` cannot directly save files to disk. Instead:

1. Fetch the binary response from `/api/download`
2. Convert to a `Blob` (binary large object in the browser)
3. Create a temporary object URL (`blob:http://...`)
4. Create an `<a>` element with `download` attribute and programmatically click it
5. Clean up the temporary URL

This pattern works across all modern browsers without requiring third-party download libraries.

---

## Step 9: The Layout and Page Shell

### Root Layout

**`apps/story-gui/src/app/layout.tsx`**:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Illustrated Storybook Generator',
  description: 'Create AI-powered illustrated children\'s stories',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-storybook-bg text-storybook-text min-h-screen">
        {children}
      </body>
    </html>
  );
}
```

### Main Page

**`apps/story-gui/src/app/page.tsx`**:

```tsx
'use client';

import { StoryForm } from '@/components/StoryForm';
import { createStory } from '@/lib/storyApi';

export default function HomePage() {
  const handleSubmit = async (topic: string, customization?: any) => {
    const result = await createStory(topic, customization);
    console.log('Story created:', result.entity_id);
    // In Part 10, this is replaced with the useStoryGeneration hook
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold text-storybook-primary mb-2">
          Illustrated Storybook Generator
        </h1>
        <p className="text-storybook-muted text-lg">
          Enter a topic and we&apos;ll create a beautifully illustrated
          children&apos;s story
        </p>
      </header>

      <StoryForm onSubmit={handleSubmit} />
    </main>
  );
}
```

The page is deliberately simple. It passes a submission handler to `StoryForm` and logs the result. In Part 10, the `handleSubmit` function is replaced with the `useStoryGeneration` hook, and `ProgressPanel` and `ResultPanel` components are added to show real-time progress and results.

---

## Step 10: The StoryForm Component

The form is the primary user interaction point. It collects a topic and optional customization settings, then submits to the API.

**`apps/story-gui/src/components/StoryForm.tsx`**:

```tsx
'use client';

import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import type { StoryCustomization } from '@shared/types';

const STYLE_OPTIONS = [
  { value: 'watercolor', label: 'Watercolor' },
  { value: 'digital-art', label: 'Digital Art' },
  { value: 'colored-pencil', label: 'Colored Pencil' },
  { value: 'storybook-classic', label: 'Classic Storybook' },
  { value: 'anime', label: 'Anime' },
  { value: 'paper-cutout', label: 'Paper Cutout' },
];

const QUALITY_OPTIONS = [
  { value: 'low', label: 'Draft' },
  { value: 'medium', label: 'Standard' },
  { value: 'high', label: 'High Quality' },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '3:2', label: 'Landscape (3:2)' },
  { value: '1:1', label: 'Square (1:1)' },
  { value: '4:3', label: 'Standard (4:3)' },
  { value: '16:9', label: 'Widescreen (16:9)' },
];

const AGE_RANGE_OPTIONS = [
  { value: '2-5', label: 'Toddler (2-5)' },
  { value: '3-8', label: 'Young (3-8)' },
  { value: '5-10', label: 'Middle (5-10)' },
  { value: '8-12', label: 'Older (8-12)' },
];

const ILLUSTRATION_COUNTS = [3, 4, 5, 6, 8];

interface StoryFormProps {
  onSubmit: (topic: string, customization?: StoryCustomization) => void;
}

export function StoryForm({ onSubmit }: StoryFormProps) {
  const [topic, setTopic] = useState('');
  const [showCustomization, setShowCustomization] = useState(false);
  const [style, setStyle] = useState('watercolor');
  const [quality, setQuality] = useState('medium');
  const [aspectRatio, setAspectRatio] = useState('3:2');
  const [ageRange, setAgeRange] = useState('3-8');
  const [numIllustrations, setNumIllustrations] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const customization = showCustomization
        ? {
            style,
            image_quality: quality,
            aspect_ratio: aspectRatio,
            age_range: ageRange,
            illustration_count: numIllustrations,
          }
        : undefined;

      onSubmit(topic.trim(), customization as StoryCustomization | undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create story');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Topic Input */}
      <div className="bg-storybook-card rounded-xl shadow-sm p-6">
        <label
          htmlFor="topic"
          className="block text-lg font-semibold mb-2"
        >
          What story would you like?
        </label>
        <textarea
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="A brave kitten who learns to swim in a magical pond..."
          rows={3}
          className="w-full px-4 py-3 rounded-lg border border-gray-200
                     focus:outline-none focus:ring-2 focus:ring-storybook-primary/50
                     focus:border-storybook-primary resize-none
                     placeholder:text-storybook-muted/60"
          disabled={isSubmitting}
        />
      </div>

      {/* Customization Toggle */}
      <button
        type="button"
        onClick={() => setShowCustomization(!showCustomization)}
        className="flex items-center gap-2 text-storybook-secondary
                   hover:text-storybook-secondary/80 font-medium transition-colors"
      >
        {showCustomization ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
        Customize your story
      </button>

      {/* Customization Panel */}
      {showCustomization && (
        <div className="bg-storybook-card rounded-xl shadow-sm p-6 space-y-6">
          {/* Style Selection */}
          <div>
            <label className="block font-semibold mb-3">
              Illustration Style
            </label>
            <div className="grid grid-cols-3 gap-2">
              {STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStyle(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium
                    transition-all ${
                      style === opt.value
                        ? 'bg-storybook-secondary text-white shadow-sm'
                        : 'bg-gray-100 text-storybook-text hover:bg-gray-200'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quality Selection */}
          <div>
            <label className="block font-semibold mb-3">
              Image Quality
            </label>
            <div className="grid grid-cols-3 gap-2">
              {QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setQuality(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm transition-all
                    ${
                      quality === opt.value
                        ? 'bg-storybook-secondary text-white shadow-sm'
                        : 'bg-gray-100 text-storybook-text hover:bg-gray-200'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio Selection */}
          <div>
            <label className="block font-semibold mb-3">
              Image Aspect Ratio
            </label>
            <div className="grid grid-cols-4 gap-2">
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAspectRatio(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm transition-all
                    ${
                      aspectRatio === opt.value
                        ? 'bg-storybook-secondary text-white shadow-sm'
                        : 'bg-gray-100 text-storybook-text hover:bg-gray-200'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Age Range Dropdown */}
          <div>
            <label
              htmlFor="age-range"
              className="block font-semibold mb-2"
            >
              Target Age Range
            </label>
            <select
              id="age-range"
              value={ageRange}
              onChange={(e) => setAgeRange(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-200
                         focus:outline-none focus:ring-2
                         focus:ring-storybook-primary/50 bg-white"
            >
              {AGE_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Illustration Count Dropdown */}
          <div>
            <label
              htmlFor="num-illustrations"
              className="block font-semibold mb-2"
            >
              Number of Illustrations
            </label>
            <select
              id="num-illustrations"
              value={numIllustrations}
              onChange={(e) => setNumIllustrations(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-lg border border-gray-200
                         focus:outline-none focus:ring-2
                         focus:ring-storybook-primary/50 bg-white"
            >
              {ILLUSTRATION_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count} illustrations
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3
                        text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!topic.trim() || isSubmitting}
        className="w-full flex items-center justify-center gap-2 px-6 py-3
                   bg-storybook-primary text-white rounded-xl font-semibold
                   text-lg shadow-sm hover:bg-storybook-primary/90
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all"
      >
        <Sparkles className="w-5 h-5" />
        {isSubmitting ? 'Creating your story...' : 'Create My Story'}
      </button>
    </form>
  );
}
```

### Component Structure

The form is organized into distinct sections:

| Section | What It Does |
|---------|-------------|
| **Topic textarea** | The only required input. A free-text area where the user describes their story idea. |
| **Customization toggle** | A button that shows/hides the customization panel. Defaults to hidden for simplicity. |
| **Style grid** | 6 buttons in a 3-column grid. Each represents an illustration style. |
| **Quality grid** | 3 buttons with labels and descriptions. Maps to the `image_quality` customization field. |
| **Aspect ratio grid** | 4 buttons for image dimensions. Maps to the `aspect_ratio` customization field. |
| **Age range dropdown** | Select element for target audience. Maps to the `age_range` customization field. |
| **Illustration count dropdown** | Select element for how many images to generate. Maps to `illustration_count`. |
| **Submit button** | Disabled when topic is empty or submission is in progress. Shows loading state. |

### Selection Button Pattern

All grid selections follow the same visual pattern:

```tsx
className={`... ${
  selectedValue === opt.value
    ? 'bg-storybook-secondary text-white shadow-sm'    // Selected
    : 'bg-gray-100 text-storybook-text hover:bg-gray-200'  // Unselected
}`}
```

The selected state uses the `storybook-secondary` (soft blue) background with white text. Unselected buttons use a neutral gray. This creates a clear visual distinction without requiring checkboxes or radio buttons.

### Form Submission

When the user clicks "Create My Story":

1. The `handleSubmit` function prevents the default form action
2. Sets `isSubmitting` to `true` (disables the button, shows loading text)
3. Builds a `StoryFormData` object from the form state
4. Calls `createStory()` which `POST`s to `/api/create`
5. The API route forwards to the bundle's `create-story` endpoint
6. The bundle creates a `StoryPipelineEntity` and returns `{ entity_id }`
7. In Part 10, the returned `entity_id` will be used to start progress streaming

If customization is toggled off (`showCustomization` is false), the `customization` field is `undefined` and the bundle uses default settings.

---

## Step 11: Build and Run

Build both apps:

```bash
pnpm run build
```

Start the backend and frontend in separate terminals:

```bash
# Terminal 1: Start the agent bundle
cd apps/story-bundle
pnpm start
# Bundle listening on port 3001

# Terminal 2: Start the GUI
cd apps/story-gui
pnpm dev
# Next.js dev server on port 3000
```

Open `http://localhost:3000` in your browser. You should see:

1. The "Illustrated Storybook Generator" header
2. A text area for the story topic
3. A "Customize your story" toggle
4. A coral "Create My Story" button

Type a topic and click submit. Check the browser console for the returned `entity_id`. In the next part, you will wire up real-time progress streaming so the user can watch the story being generated.

---

## What You've Built

You now have:
- A Next.js 15 frontend app (`story-gui`) in the monorepo alongside the backend (`story-bundle`)
- Next.js configuration with `serverExternalPackages` for ESM-only SDK packages and `output: 'standalone'` for Docker
- A `RemoteAgentBundleClient` singleton for server-side communication with the bundle
- Four API route proxies: `create` (POST), `status` (GET), `download` (GET with binary response), and `progress` (placeholder for Part 10)
- Client-side API functions that call the Next.js routes and handle binary downloads
- A custom Tailwind theme with storybook-themed colors
- A `StoryForm` component with topic input, customization options, and form submission

The project structure:

```
apps/story-gui/
+-- src/
|   +-- app/
|   |   +-- page.tsx                  # Main page with StoryForm
|   |   +-- layout.tsx                # Root layout with global styles
|   |   +-- globals.css               # Tailwind imports + serif font
|   |   +-- api/
|   |       +-- create/route.ts       # POST proxy -> bundle create-story
|   |       +-- status/route.ts       # GET proxy -> bundle story-status
|   |       +-- download/route.ts     # GET binary proxy -> bundle download
|   |       +-- progress/route.ts     # SSE streaming (Part 10)
|   +-- components/
|   |   +-- StoryForm.tsx             # Topic input + customization form
|   |   +-- ProgressPanel.tsx         # (Part 10)
|   |   +-- ResultPanel.tsx           # (Part 10)
|   +-- hooks/
|   |   +-- useStoryGeneration.ts     # (Part 10)
|   +-- lib/
|   |   +-- serverConfig.ts           # RemoteAgentBundleClient singleton
|   |   +-- storyApi.ts               # Client-side fetch functions
|   +-- types/
|       +-- index.ts                  # Shared + UI type definitions
+-- next.config.mjs                   # Standalone output, external packages
+-- tailwind.config.ts                # Custom storybook color palette
+-- postcss.config.cjs                # PostCSS with Tailwind plugin
+-- tsconfig.json                     # Path aliases (@/*, @shared/types)
+-- package.json                      # Dependencies
```

---

## Key Takeaways

1. **The GUI is a thin proxy to the bundle.** It does not import agent SDK classes, create entities, or call the LLM. Every request flows through Next.js API routes to `RemoteAgentBundleClient`, which handles HTTP communication with the running bundle.

2. **`RemoteAgentBundleClient` is the SDK's HTTP client for bundles.** Use `call_api_endpoint` for JSON responses and `call_api_endpoint_binary` for binary data (PDFs, images). The client is initialized once and reused across all requests.

3. **`serverExternalPackages` is required for ESM-only SDK packages.** Without it, Next.js's bundler fails to process `@firebrandanalytics/ff-sdk` and `@firebrandanalytics/entity-client`. This setting tells Next.js to load them at runtime from `node_modules` instead of bundling them.

4. **Use `Uint8Array` for binary web responses, not `Buffer`.** The web `Response` constructor does not accept Node.js `Buffer`. Wrap binary data in `new Uint8Array(result)` to create a universally accepted typed array.

5. **PostCSS config must be `.cjs` when `package.json` has `"type": "module"`.** PostCSS uses `require()` to load its config. ES module `.js` files cannot be loaded with `require()`. The `.cjs` extension forces CommonJS mode.

6. **Custom Tailwind themes keep styling consistent.** Define a color palette once in `tailwind.config.ts` and reference it everywhere with `bg-storybook-primary`, `text-storybook-muted`, etc. This avoids scattering hex values across components.

7. **Component-per-feature organization keeps the codebase navigable.** Each major UI concern has its own file: `StoryForm` for input, `ProgressPanel` for real-time progress (Part 10), `ResultPanel` for download links (Part 10). API routes follow the same pattern -- one route file per endpoint.

---

## Next Steps

In [Part 10: Real-Time Streaming & Downloads](./part-10-streaming-and-downloads.md), you'll complete the web UI by implementing Server-Sent Events (SSE) for real-time progress streaming, the `useStoryGeneration` hook for managing generation state, the `ProgressPanel` component for visual progress feedback, and the `ResultPanel` component for downloading the finished story as PDF or HTML.

---

**Previous:** [Part 8: Input Validation & Error Handling](./part-08-input-validation.md) | **Next:** [Part 10: Real-Time Streaming & Downloads](./part-10-streaming-and-downloads.md)
