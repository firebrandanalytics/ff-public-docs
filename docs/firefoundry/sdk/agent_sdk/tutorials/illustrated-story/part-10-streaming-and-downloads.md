# Part 10: SSE Progress Streaming & Downloads

In Part 9, you built the Next.js GUI shell: project scaffolding, environment configuration, API proxy routes (`/api/create`, `/api/status`, `/api/download`), and the `StoryForm` component. The app can create story entities and check their status, but there is no real-time feedback -- the user submits a topic and sees nothing until the pipeline finishes. In this final part, you'll close that gap with **Server-Sent Events (SSE)** for live progress streaming, a generation hook that manages the full lifecycle, and result/download components that let the user retrieve their finished storybook.

**What you'll learn:**
- Building an SSE endpoint that streams entity progress envelopes to the browser
- Using `client.start_iterator()` to run an entity and yield progress in real time
- Handling client disconnection with `req.signal` (AbortSignal)
- Managing a multi-stage UI lifecycle with a custom React hook
- Parsing SSE streams in the browser with `TextDecoderStream`
- Displaying real-time progress with auto-scrolling log entries
- Rendering completed, rejected, and failed result states
- Triggering file downloads from working memory through the API proxy

**What you'll build:** The SSE progress route, `useStoryGeneration` hook, `ProgressPanel` and `ResultPanel` components, and the main page that ties everything together into a working illustrated storybook GUI.

**Starting point:** Completed code from [Part 9](./part-09-web-ui.md). You should have a Next.js app with environment config, API proxy routes, and the `StoryForm` component.

---

## Concepts: SSE vs. WebSockets

The bundle's iterator protocol yields progress envelopes as an async iterable. The GUI needs to consume those envelopes in real time. Two options exist:

| Approach | Direction | Complexity | Use Case |
|----------|-----------|------------|----------|
| **Server-Sent Events (SSE)** | Server to client only | Low -- built on plain HTTP, auto-reconnects | Progress streaming, live logs, notifications |
| **WebSockets** | Bidirectional | Higher -- separate protocol, connection management | Chat, collaborative editing, bidirectional control |

Story generation is unidirectional: the server sends progress updates, the client displays them. SSE is the right fit. It uses a standard HTTP response with `Content-Type: text/event-stream`, requires no special client library (the browser's `EventSource` API or a plain `fetch` with stream reading both work), and reconnects automatically if the connection drops.

---

## Step 1: The Progress Route (SSE Endpoint)

This route connects the browser to the bundle's iterator protocol. When the client connects, the route starts the entity's pipeline and streams every progress envelope as an SSE `data:` event.

**`apps/story-gui/src/app/api/progress/route.ts`**:

```typescript
import { NextRequest } from 'next/server';
import { getBundleClient } from '@/lib/serverConfig';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entity_id');

  if (!entityId) {
    return new Response(JSON.stringify({ error: 'entity_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const client = getBundleClient();
  const abortSignal = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* Controller already closed */
        }
      };

      try {
        const iterator = await client.start_iterator(entityId, 'start');

        for await (const envelope of iterator) {
          if (abortSignal.aborted) break;

          send(envelope);

          if (envelope.type === 'VALUE' && envelope.sub_type === 'return') {
            send({ type: 'DONE' });
            break;
          }
        }
      } catch (err: any) {
        if (abortSignal.aborted) return;
        console.error('[SSE /progress]', err);
        send({ type: 'ERROR', error: err.message || 'Stream error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
```

### How It Works

**`client.start_iterator(entityId, 'start')`** does two things in one call: it starts the entity's `run_impl()` on the bundle, and returns an async iterable that yields every progress envelope the entity produces. This is the same protocol that `ff-sdk-cli iterator run` uses under the hood.

**The `send()` helper** encodes each envelope as an SSE-formatted message. SSE messages follow a simple text protocol: each message is a line starting with `data:` followed by a JSON payload, terminated by two newlines (`\n\n`). The browser parses this format automatically.

**`req.signal` (AbortSignal)** fires when the client disconnects -- the user navigates away, closes the tab, or the `fetch` is aborted. The `for await` loop checks this signal on each iteration and breaks early, preventing the server from doing work nobody will see.

**The try/catch around `controller.enqueue`** handles a race condition: the client might disconnect between the `abortSignal.aborted` check and the `enqueue` call. Rather than crashing, the catch silently drops the message.

**`type: 'VALUE', sub_type: 'return'`** is the envelope that carries the entity's final return value. When the pipeline returns its result (the story metadata, title, moral, and working memory IDs), it arrives in this envelope. After sending it, the route sends a synthetic `{ type: 'DONE' }` marker and closes the stream.

### SSE Message Format

Each message the browser receives looks like this:

```
data: {"type":"INTERNAL_UPDATE","stage":"safety_check","message":"Running content safety check..."}

data: {"type":"INTERNAL_UPDATE","stage":"writing","message":"Generating story..."}

data: {"type":"VALUE","sub_type":"return","value":{"title":"The Brave Kitten","moral":"..."}}

data: {"type":"DONE"}

```

The double newline after each `data:` line is required by the SSE specification. It tells the browser "this is a complete message, parse it now."

---

## Step 2: The useStoryGeneration Hook

The hook manages the entire generation lifecycle: creating the entity, connecting to SSE, parsing progress, handling errors, and providing state to the UI components.

**`apps/story-gui/src/hooks/useStoryGeneration.ts`**:

```typescript
'use client';

import { useState, useRef, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────

export type Stage =
  | 'idle'
  | 'creating'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'failed';

export interface ProgressEntry {
  timestamp: number;
  stage: string;
  message: string;
}

export interface StoryResult {
  title: string;
  moral: string;
  age_range: string;
  image_count: number;
  html_wm_id?: string;
  pdf_wm_id?: string;
  safety?: {
    reasoning: string;
    concerns: string[];
  };
}

export interface StoryGenerationState {
  entityId: string | null;
  stage: Stage;
  progress: ProgressEntry[];
  result: StoryResult | null;
  error: string | null;
}

// ─── Hook ──────────────────────────────────────────────────

export function useStoryGeneration() {
  const [state, setState] = useState<StoryGenerationState>({
    entityId: null,
    stage: 'idle',
    progress: [],
    result: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  // ── Helpers ────────────────────────────────────────────

  const addProgress = useCallback((stage: string, message: string) => {
    setState((prev) => ({
      ...prev,
      progress: [
        ...prev.progress,
        { timestamp: Date.now(), stage, message },
      ],
    }));
  }, []);

  const handleSSEMessage = useCallback(
    (data: any, entityId: string) => {
      if (data.type === 'INTERNAL_UPDATE') {
        addProgress(data.stage || 'update', data.message || 'Processing...');
      } else if (data.type === 'VALUE' && data.sub_type === 'return') {
        const value = data.value;

        if (value?.rejected) {
          setState((prev) => ({
            ...prev,
            stage: 'rejected',
            result: {
              title: '',
              moral: '',
              age_range: '',
              image_count: 0,
              safety: {
                reasoning: value.safety_reasoning || '',
                concerns: value.safety_concerns || [],
              },
            },
          }));
        } else {
          setState((prev) => ({
            ...prev,
            stage: 'completed',
            result: {
              title: value.title || 'Untitled Story',
              moral: value.moral || '',
              age_range: value.age_range || '',
              image_count: value.image_count || 0,
              html_wm_id: value.html_wm_id,
              pdf_wm_id: value.pdf_wm_id,
            },
          }));
        }
      } else if (data.type === 'DONE') {
        // Stream ended. If still processing, fall back to polling.
        setState((prev) => {
          if (prev.stage === 'processing') {
            pollForResult(entityId);
          }
          return prev;
        });
      } else if (data.type === 'ERROR') {
        setState((prev) => ({
          ...prev,
          stage: 'failed',
          error: data.error || 'An unknown error occurred',
        }));
      }
    },
    [addProgress],
  );

  // ── Fallback polling ───────────────────────────────────

  const pollForResult = useCallback(async (entityId: string) => {
    try {
      const res = await fetch(`/api/status?entity_id=${entityId}`);
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);

      const status = await res.json();

      if (status.status === 'completed' || status.status === 'completed_with_errors') {
        setState((prev) => ({
          ...prev,
          stage: 'completed',
          result: {
            title: status.result?.title || 'Untitled Story',
            moral: status.result?.moral || '',
            age_range: status.result?.age_range || '',
            image_count: status.result?.image_count || 0,
            html_wm_id: status.result?.html_wm_id,
            pdf_wm_id: status.result?.pdf_wm_id,
          },
        }));
      } else if (status.status === 'rejected') {
        setState((prev) => ({
          ...prev,
          stage: 'rejected',
          result: {
            title: '',
            moral: '',
            age_range: '',
            image_count: 0,
            safety: {
              reasoning: status.result?.safety_reasoning || '',
              concerns: status.result?.safety_concerns || [],
            },
          },
        }));
      } else if (status.status === 'failed') {
        setState((prev) => ({
          ...prev,
          stage: 'failed',
          error: status.error || 'Pipeline failed',
        }));
      }
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        stage: 'failed',
        error: err.message,
      }));
    }
  }, []);

  // ── Generate ───────────────────────────────────────────

  const generate = useCallback(
    async (topic: string, customization?: Record<string, any>) => {
      // 1. Reset state
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        entityId: null,
        stage: 'creating',
        progress: [],
        result: null,
        error: null,
      });

      try {
        // 2. Create entity via API proxy
        addProgress('setup', 'Creating story entity...');

        const createRes = await fetch('/api/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, ...customization }),
          signal: controller.signal,
        });

        if (!createRes.ok) {
          const body = await createRes.text();
          throw new Error(`Failed to create story: ${body}`);
        }

        const { entity_id } = await createRes.json();

        setState((prev) => ({
          ...prev,
          entityId: entity_id,
          stage: 'processing',
        }));

        addProgress('setup', `Entity created: ${entity_id}`);

        // 3. Connect to SSE progress stream
        const sseRes = await fetch(
          `/api/progress?entity_id=${entity_id}`,
          { signal: controller.signal },
        );

        if (!sseRes.ok || !sseRes.body) {
          throw new Error('Failed to connect to progress stream');
        }

        // 4. Parse SSE stream
        const reader = sseRes.body
          .pipeThrough(new TextDecoderStream())
          .getReader();

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += value;
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEMessage(data, entity_id);
            } catch {
              /* Skip malformed JSON */
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          stage: 'failed',
          error: err.message,
        }));
      }
    },
    [addProgress, handleSSEMessage],
  );

  // ── Reset ──────────────────────────────────────────────

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({
      entityId: null,
      stage: 'idle',
      progress: [],
      result: null,
      error: null,
    });
  }, []);

  return { ...state, generate, reset };
}
```

### State Machine

The hook implements a simple state machine:

```
idle ──[generate()]──> creating ──[entity created]──> processing
                                                          |
                                    ┌─────────────────────┼─────────────────────┐
                                    |                     |                     |
                                    v                     v                     v
                               completed              rejected               failed
                                    |                     |                     |
                                    └─────────[reset()]───┴─────────[reset()]───┘
                                                          |
                                                          v
                                                        idle
```

Each stage maps to a UI component: `idle` shows the form, `creating`/`processing` shows the progress panel, and `completed`/`rejected`/`failed` shows the result panel.

### SSE Parsing

The browser receives SSE data as a text stream. The hook reads chunks with `TextDecoderStream` and a manual line parser:

```typescript
buffer += value;
const lines = buffer.split('\n\n');
buffer = lines.pop() || '';   // Keep incomplete last message in buffer
```

This handles the case where a chunk boundary falls in the middle of a message. The `buffer` accumulates partial data until a complete SSE message (terminated by `\n\n`) arrives. Each complete message starting with `data: ` is parsed as JSON and passed to `handleSSEMessage`.

### Why Not EventSource?

The browser's built-in `EventSource` API is simpler but has a limitation: it automatically reconnects and replays from the beginning when the connection drops. For a one-shot pipeline, reconnection would attempt to restart the entity. Using `fetch` with manual stream parsing gives full control over the connection lifecycle.

### Fallback Polling

If the SSE stream ends without a `VALUE` envelope (network hiccup, proxy timeout, server restart), the hook falls back to polling:

```typescript
} else if (data.type === 'DONE') {
  setState((prev) => {
    if (prev.stage === 'processing') {
      pollForResult(entityId);
    }
    return prev;
  });
}
```

`pollForResult` calls `/api/status`, which reads the entity's current state. If the pipeline completed while the SSE connection was broken, the status endpoint returns the result. This ensures the user always sees the outcome, even with unreliable connections.

---

## Step 3: The ProgressPanel Component

The progress panel displays real-time updates while the pipeline runs. It shows a spinning indicator, a log of progress entries, and a cancel button.

**`apps/story-gui/src/components/ProgressPanel.tsx`**:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import type { ProgressEntry, Stage } from '@/hooks/useStoryGeneration';

// ─── Stage label mapping ───────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  setup: 'Setup',
  safety_check: 'Safety Check',
  writing: 'Story Writing',
  reference_image: 'Reference Image',
  generating_images: 'Image Generation',
  assembling: 'HTML Assembly',
  pdf: 'PDF Conversion',
  storing: 'Storage',
  update: 'Update',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage;
}

// ─── Stage badge colors ────────────────────────────────────

function stageBadgeClass(stage: string): string {
  switch (stage) {
    case 'safety_check':
      return 'bg-yellow-100 text-yellow-800';
    case 'writing':
      return 'bg-blue-100 text-blue-800';
    case 'generating_images':
    case 'reference_image':
      return 'bg-purple-100 text-purple-800';
    case 'pdf':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

// ─── Component ─────────────────────────────────────────────

interface ProgressPanelProps {
  stage: Stage;
  progress: ProgressEntry[];
  onCancel: () => void;
}

export function ProgressPanel({ stage, progress, onCancel }: ProgressPanelProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest entry
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progress.length]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Spinner and heading */}
      <div className="flex items-center gap-3 mb-6">
        <div className="animate-spin h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full" />
        <h2 className="text-xl font-semibold">
          {stage === 'creating' ? 'Setting up your story' : 'Generating your story'}
        </h2>
        <BouncingDots />
      </div>

      {/* Progress log */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 max-h-80 overflow-y-auto p-4 space-y-2">
        {progress.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 text-xs whitespace-nowrap mt-0.5">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${stageBadgeClass(entry.stage)}`}
            >
              {stageLabel(entry.stage)}
            </span>
            <span className="text-gray-700">{entry.message}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Cancel button */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Bouncing dots animation ───────────────────────────────

function BouncingDots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
```

### Key Design Points

**Auto-scrolling:** The `logEndRef` is an invisible div at the bottom of the log. When new progress entries arrive, `scrollIntoView` keeps the latest entry visible. The `smooth` behavior avoids jarring jumps.

**Stage badges:** Each pipeline stage gets a color-coded badge. This provides visual grouping -- all "Image Generation" entries are purple, all "Safety Check" entries are yellow -- so the user can scan the log quickly.

**Timestamps:** Each entry shows the wall-clock time, helping users gauge how long each stage takes. This is especially useful during image generation, where each image might take 5-10 seconds.

**Cancel button:** Calls `onCancel`, which in the hook aborts the `AbortController`. This triggers `req.signal` on the server, which breaks the `for await` loop in the SSE route, and the `AbortError` in the hook's `generate` function is caught and silently ignored.

---

## Step 4: The ResultPanel Component

The result panel displays one of three outcomes: a completed story with download buttons, a rejected topic with safety details, or an error.

**`apps/story-gui/src/components/ResultPanel.tsx`**:

```tsx
'use client';

import { useState } from 'react';
import type { Stage, StoryResult, ProgressEntry } from '@/hooks/useStoryGeneration';

interface ResultPanelProps {
  stage: Stage;
  result: StoryResult | null;
  error: string | null;
  progress: ProgressEntry[];
  onReset: () => void;
}

export function ResultPanel({ stage, result, error, progress, onReset }: ResultPanelProps) {
  const [showLog, setShowLog] = useState(false);

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* ── Completed ─────────────────────────────────────── */}
      {stage === 'completed' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold">
              ✓
            </span>
            <h2 className="text-xl font-semibold text-green-800">Story Complete</h2>
          </div>

          <div className="bg-white rounded-lg border border-green-200 p-4 space-y-2">
            <p><strong>Title:</strong> {result.title}</p>
            <p><strong>Moral:</strong> {result.moral}</p>
            <p><strong>Age Range:</strong> {result.age_range}</p>
            <p><strong>Images:</strong> {result.image_count} illustrations</p>
          </div>

          {/* Download buttons */}
          <div className="flex gap-3">
            {result.pdf_wm_id && (
              <a
                href={`/api/download?wm_id=${result.pdf_wm_id}`}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                download
              >
                Download PDF
              </a>
            )}
            {result.html_wm_id && (
              <a
                href={`/api/download?wm_id=${result.html_wm_id}`}
                className="px-4 py-2 bg-white text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 text-sm font-medium"
                download
              >
                Download HTML
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Rejected ──────────────────────────────────────── */}
      {stage === 'rejected' && result?.safety && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600 font-bold">
              !
            </span>
            <h2 className="text-xl font-semibold text-yellow-800">Topic Not Suitable</h2>
          </div>

          <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4 space-y-3">
            <p className="text-sm text-yellow-800">{result.safety.reasoning}</p>

            {result.safety.concerns.length > 0 && (
              <div>
                <p className="text-sm font-medium text-yellow-800 mb-1">Concerns:</p>
                <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1">
                  {result.safety.concerns.map((concern, i) => (
                    <li key={i}>{concern}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <p className="text-sm text-gray-500">
            Try a different topic that is suitable for children aged 3-10.
          </p>
        </div>
      )}

      {/* ── Failed ────────────────────────────────────────── */}
      {stage === 'failed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold">
              x
            </span>
            <h2 className="text-xl font-semibold text-red-800">Generation Failed</h2>
          </div>

          <div className="bg-red-50 rounded-lg border border-red-200 p-4">
            <p className="text-sm text-red-700">{error || 'An unexpected error occurred.'}</p>
          </div>
        </div>
      )}

      {/* ── Collapsible progress log ──────────────────────── */}
      {progress.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowLog(!showLog)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {showLog ? 'Hide' : 'Show'} generation log ({progress.length} entries)
          </button>

          {showLog && (
            <div className="mt-2 bg-gray-50 rounded-lg border border-gray-200 max-h-60 overflow-y-auto p-3 space-y-1">
              {progress.map((entry, i) => (
                <div key={i} className="text-xs text-gray-600">
                  <span className="text-gray-400">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  [{entry.stage}] {entry.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Create another ────────────────────────────────── */}
      <div className="mt-6">
        <button
          onClick={onReset}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
        >
          Create Another Story
        </button>
      </div>
    </div>
  );
}
```

### Three Result States

The `ResultPanel` renders one of three visual states based on `stage`:

| Stage | Color | Content |
|-------|-------|---------|
| **completed** | Green | Story title, moral, age range, image count, and download buttons for PDF and HTML |
| **rejected** | Yellow | The safety bot's reasoning and a list of specific concerns |
| **failed** | Red | The error message from the pipeline or network |

### Download Buttons

The download buttons are plain `<a>` tags pointing at `/api/download`:

```tsx
<a
  href={`/api/download?wm_id=${result.pdf_wm_id}`}
  download
>
  Download PDF
</a>
```

The `download` attribute tells the browser to save the response as a file rather than navigating to it. The `/api/download` route (built in Part 9) proxies the request to the bundle's working memory, retrieves the stored document, and returns it with the appropriate `Content-Type` header.

### Collapsible Progress Log

After the pipeline finishes, the full progress log is available behind a toggle. This is useful for debugging -- if the story took longer than expected, the user (or developer) can expand the log and see exactly which stage consumed the time.

---

## Step 5: Main Page Composition

The page component ties everything together. It delegates all state management to the hook and renders the appropriate component for each stage.

**`apps/story-gui/src/app/page.tsx`**:

```tsx
'use client';

import { useStoryGeneration } from '@/hooks/useStoryGeneration';
import { StoryForm } from '@/components/StoryForm';
import { ProgressPanel } from '@/components/ProgressPanel';
import { ResultPanel } from '@/components/ResultPanel';

export default function HomePage() {
  const gen = useStoryGeneration();

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Illustrated Storybook Generator
        </h1>
        <p className="text-gray-500 mt-2">
          Enter a topic and we'll create a children's storybook with custom illustrations
        </p>
      </div>

      {gen.stage === 'idle' && (
        <StoryForm onSubmit={gen.generate} />
      )}

      {(gen.stage === 'creating' || gen.stage === 'processing') && (
        <ProgressPanel
          stage={gen.stage}
          progress={gen.progress}
          onCancel={gen.reset}
        />
      )}

      {(gen.stage === 'completed' || gen.stage === 'rejected' || gen.stage === 'failed') && (
        <ResultPanel
          stage={gen.stage}
          result={gen.result}
          error={gen.error}
          progress={gen.progress}
          onReset={gen.reset}
        />
      )}
    </main>
  );
}
```

### Simplicity by Design

The page component is intentionally minimal. It makes exactly one decision: which component to render based on the current stage. All state transitions, API calls, SSE parsing, and error handling live in `useStoryGeneration`. All visual presentation lives in the panel components.

This separation means you can swap the UI framework (replace Tailwind with a component library), change the layout (add a sidebar, use tabs), or embed the generator in a larger application -- all without touching the hook or the API routes.

---

## Step 6: Testing the Complete Flow

Start both the bundle and the GUI:

```bash
# Terminal 1: Start the bundle
cd apps/story-bundle && pnpm run dev

# Terminal 2: Start the GUI
cd apps/story-gui && pnpm run dev

# Open http://localhost:3002
```

### End-to-End Walkthrough

Here is what happens when a user creates a story:

1. **User fills out the form.** They enter a topic ("A brave kitten who learns to share"), select an art style, and click "Create My Story."

2. **GUI creates the entity.** The `generate` function POSTs to `/api/create`, which proxies to the bundle. The bundle creates a `StoryPipelineEntity` with the topic and customization data, and returns the `entity_id`.

3. **GUI connects to the SSE stream.** The hook fetches `/api/progress?entity_id=...`. The SSE route calls `client.start_iterator(entityId, 'start')`, which kicks off the entity's `run_impl()` and returns the progress stream.

4. **Pipeline executes.** Inside the bundle, the pipeline runs through its stages:
   - **Safety check** -- `ContentSafetyCheckEntity` evaluates the topic
   - **Story writing** -- `StoryWriterEntity` generates HTML with `{{IMAGE_N}}` placeholders
   - **Reference image** -- optional character reference for visual consistency
   - **Parallel image generation** -- `ImageGenerationEntity` children generate illustrations concurrently (up to 3 per story, 10 globally)
   - **HTML assembly** -- placeholders are replaced with base64-encoded `<img>` tags
   - **PDF conversion** -- the doc-proc service converts the assembled HTML to PDF
   - **Working memory storage** -- both HTML and PDF are stored with retrievable IDs

5. **Progress streams in real time.** Each stage yields `INTERNAL_UPDATE` envelopes. The SSE route forwards them to the browser. The hook parses them and adds entries to the progress log. The `ProgressPanel` auto-scrolls to show the latest entry.

6. **Pipeline returns its result.** The final `VALUE` envelope contains the story metadata: title, moral, age range, image count, and working memory IDs for the HTML and PDF documents.

7. **User downloads the storybook.** The `ResultPanel` shows the story details and download buttons. Clicking "Download PDF" navigates to `/api/download?wm_id=...`, which retrieves the PDF from the bundle's working memory and streams it to the browser.

### Testing Edge Cases

**Unsafe topic:** Enter "A zombie apocalypse with graphic battles." The safety check rejects it, the pipeline returns a rejected result, and the `ResultPanel` shows the yellow rejection state with the safety bot's reasoning and concerns.

**Cancel mid-generation:** Click "Cancel" during image generation. The `AbortController` fires, the SSE connection closes, the server stops iterating, and the hook returns to idle. The entity still exists on the bundle (it will eventually complete or time out), but the client has disconnected.

**Network interruption:** If the SSE connection drops mid-stream (close the laptop lid, lose Wi-Fi), the hook's `fetch` terminates. When the `DONE` handler fires (or the `for await` loop exits), the fallback `pollForResult` kicks in and retrieves the final state from `/api/status`.

---

## What You've Built: The Complete System

Over ten parts, you have built a complete AI-powered illustrated storybook generator. Here is everything in the final system:

### Bots (2)

| Bot | Purpose | Key Technique |
|-----|---------|---------------|
| **ContentSafetyBot** | Evaluates topic safety for children | `StructuredOutputBotMixin` with Zod schema validation |
| **StoryWriterBot** | Generates an illustrated HTML story | Complex prompt engineering, HTML + image placeholder pattern |

### Entities (4)

| Entity | Purpose | Key Technique |
|--------|---------|---------------|
| **ContentSafetyCheckEntity** | Wraps safety bot in an entity | `BotRunnableEntityMixin`, `get_bot_request_args_impl` |
| **StoryWriterEntity** | Wraps story bot, receives customization | Reference image injection, style-aware prompt composition |
| **ImageGenerationEntity** | Generates one illustration | Broker client integration, blob storage retrieval |
| **StoryPipelineEntity** | Orchestrates the full pipeline | `appendOrRetrieveCall`, `yield*`, `condition()`, capacity management |

### Agent Bundle (1)

| Component | Endpoints |
|-----------|-----------|
| **IllustratedStoryAgentBundle** | `POST /api/create-story` (create pipeline entity), `GET /api/story-status` (poll status), `GET /api/download` (retrieve from working memory) |

### Next.js GUI (1)

| Component | Purpose |
|-----------|---------|
| **API routes** | `/api/create`, `/api/status`, `/api/download`, `/api/progress` (SSE) |
| **StoryForm** | Topic input, style selection, customization options |
| **ProgressPanel** | Real-time progress log with stage badges and auto-scroll |
| **ResultPanel** | Three-state result display with download buttons |
| **useStoryGeneration** | Lifecycle hook managing the full state machine |

### Architectural Patterns

| Pattern | Where It Appears |
|---------|-----------------|
| **Entity-based parallelism** | `ImageGenerationEntity` children with `HierarchicalTaskPoolRunner` |
| **Hierarchical capacity** | Per-story (3) and global (10) `CapacitySource` limits |
| **Deterministic child creation** | `appendOrRetrieveCall` with stable names for resumability |
| **Bot-entity separation** | Bots are stateless AI behavior; entities are stateful work orders |
| **Structured output validation** | Zod schemas with `withSchemaMetadata` and `.describe()` annotations |
| **SSE streaming** | Server pushes progress envelopes; browser parses and displays |
| **Fallback polling** | `/api/status` as backup when SSE connection drops |
| **Thin client** | All intelligence lives in the bundle; the GUI is a display layer |

---

## Key Takeaways

1. **SSE is simpler than WebSockets for unidirectional streaming.** Server-Sent Events use plain HTTP, require no special client library, and auto-reconnect by default. For progress streaming where the server sends and the client displays, SSE is the right choice.

2. **`start_iterator()` is the SDK's streaming API.** It starts the entity's `run_impl()` and returns an async iterable of progress envelopes. The SSE route wraps each envelope as a `data:` line and streams it to the browser. This is the same protocol `ff-sdk-cli iterator run` uses.

3. **`req.signal` provides graceful disconnection.** When the client navigates away or cancels, the `AbortSignal` fires. The SSE route checks this signal in the `for await` loop and stops iterating. No zombie connections, no wasted compute.

4. **Fallback polling handles unreliable connections.** If the SSE stream ends without delivering the final result, the hook calls `/api/status` to retrieve the entity's current state. The pipeline's result persists in the entity graph regardless of whether the SSE consumer was connected.

5. **A simple state machine keeps the UI predictable.** Five stages (idle, creating, processing, completed/rejected/failed) map directly to three UI components (form, progress, result). The hook manages all transitions. The page component makes one decision: which component to render.

6. **The GUI is a thin client.** All AI logic, pipeline orchestration, safety checks, image generation, and document assembly live in the bundle. The GUI creates entities, displays progress, and triggers downloads. This means the same bundle can serve a mobile app, a CLI, or a Slack integration with zero changes to the AI pipeline.

7. **The `download` attribute and API proxy enable clean file downloads.** The browser fetches from the local API route, which proxies to the bundle's working memory. The response arrives with the correct `Content-Type` and `Content-Disposition` headers, and the `download` attribute on the `<a>` tag triggers a save dialog.

---

## Next Steps

You have completed the illustrated storybook tutorial series. Here are directions you can explore from here:

- **Add authentication** -- protect the API routes with NextAuth or a session token so each user's stories are private
- **Persist story history** -- store completed stories in a database and let users browse their past creations
- **Add image regeneration** -- let users regenerate individual illustrations they don't like, using the entity graph to replace specific `ImageGenerationEntity` children
- **Support multiple languages** -- add a language selector and modify the `StoryWriterPrompt` to generate stories in the selected language
- **Deploy to production** -- use `ff ops build && ff ops deploy` for the bundle and Vercel/Docker for the Next.js app
- **Build a different pipeline** -- the patterns you've learned (bot-entity separation, structured output, parallel entities, SSE streaming) apply to any multi-stage AI workflow: report generation, data analysis, content moderation, and more

---

**Previous:** [Part 9: Web UI Setup & Story Form](./part-09-web-ui.md) | **Start over:** [Part 1: Project Setup & Content Safety Bot](./part-01-setup-and-safety.md)
