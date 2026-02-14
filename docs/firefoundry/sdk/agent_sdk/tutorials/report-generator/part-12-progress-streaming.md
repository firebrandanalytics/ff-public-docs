# Part 12: Real-Time Progress Streaming

In this part, you'll add real-time progress streaming to the consumer backend. You'll build a Server-Sent Events (SSE) endpoint that bridges the agent bundle's async iterator to the browser, then create a client-side hook that consumes the stream and drives the UI.

**What you'll learn:**
- How agent bundle iterators work (async generators yielding typed envelopes)
- Creating an SSE endpoint in Next.js using `ReadableStream`
- Connecting to a running workflow's iterator via `start_iterator(entityId, 'start', [])`
- Handling envelope types: `INTERNAL_UPDATE`, `VALUE`, `STATUS`, `WAITING`, `ERROR`
- Client-side SSE consumption with `fetch()` + `TextDecoderStream`
- Reconnection after page refresh (the progress reconnect pattern)
- Building a `useStreamingReportGeneration` hook

**What you'll build:** An SSE progress endpoint at `GET /api/reports/[id]/progress`, a client-side `listenToStream` function that parses SSE messages into typed state updates, and a `generate` function that ties the create call from Part 11 to the progress stream in a single user action.

**Starting point:** Completed code from [Part 11: Consumer Backend Setup](./part-11-consumer-backend.md). You should have a working Next.js BFF with `POST /api/reports/create` and `GET /api/reports/status` routes, plus a `RemoteAgentBundleClient` configured in `serverConfig.ts`.

---

## Key Concepts

### Iterators and Envelopes

In Part 9, the agent bundle's `createReport` endpoint starts the workflow in the background using a fire-and-forget pattern -- it calls `entity.start()` to begin the async iterator, drains it in an anonymous async function, and returns the `entity_id` immediately.

The key insight is that the workflow runs as an **async iterator** inside the agent bundle. As the workflow progresses through its stages (text extraction, AI generation, PDF conversion, review), it `yield`s progress **envelopes** -- typed objects that describe what is happening.

From outside the bundle, a consumer can reconnect to this running iterator at any time using `start_iterator()`. This does not start a new workflow. Instead, it attaches to the existing one and begins receiving envelopes from wherever the workflow currently is.

### Envelope Types

Every envelope has a `type` field that tells you what kind of event it represents:

| Type | Meaning | When Sent |
|------|---------|-----------|
| `ACK` | Connection acknowledged | Synthetic, sent by the BFF immediately on connect |
| `INTERNAL_UPDATE` | Progress message from a workflow stage | During text extraction, AI generation, PDF conversion |
| `VALUE` | A child entity completed and returned a value | When `ReportEntity` finishes with its result |
| `WAITING` | Workflow paused, waiting for human input | When `ReviewStep` needs approve/reject |
| `STATUS` | Entity status changed | When entity transitions (e.g., `Pending` to `InProgress`) |
| `BOT_PROGRESS` | LLM streaming tokens | During AI generation (token-by-token) |
| `ERROR` | Something went wrong | On processing failure at any stage |
| `DONE` | Stream is complete | Synthetic, sent by the BFF after the iterator finishes |

Note that `ACK` and `DONE` are not envelope types from the agent bundle itself -- they are synthetic messages that the BFF injects to give the client clear stream lifecycle signals.

### The BFF SSE Bridge Pattern

The consumer backend acts as a bridge between two different streaming protocols:

1. **Agent bundle side:** The `RemoteAgentBundleClient` provides an async iterator that yields envelopes over gRPC.
2. **Browser side:** The browser expects Server-Sent Events (SSE) over HTTP -- a `text/event-stream` response where each message is formatted as `data: <json>\n\n`.

The BFF's job is to connect these two worlds: call `start_iterator()` to get the async iterator, loop over it, and write each envelope as an SSE message to a `ReadableStream` that Next.js sends to the browser.

```
Browser                    BFF (Next.js)                 Agent Bundle
  |                           |                              |
  |-- GET /progress --------->|                              |
  |                           |-- start_iterator() --------->|
  |                           |<-- envelope (INTERNAL_UPDATE)|
  |<-- data: {...}\n\n -------|                              |
  |                           |<-- envelope (VALUE) ---------|
  |<-- data: {...}\n\n -------|                              |
  |                           |<-- iterator done ------------|
  |<-- data: {DONE}\n\n -----|                              |
```

---

## Step 1: Create the Progress SSE Route

Create the dynamic route that streams progress for a specific report entity.

**`apps/report-gui/src/app/api/reports/[id]/progress/route.ts`**:

```typescript
/**
 * API Route: GET /api/reports/{id}/progress
 * Reconnects to an existing entity's progress stream via Server-Sent Events (SSE)
 */

import { NextRequest } from 'next/server';
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';
import { AGENT_BUNDLE_URL } from '@/lib/serverConfig';

export const dynamic = 'force-dynamic';

const client = new RemoteAgentBundleClient(AGENT_BUNDLE_URL);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: entityId } = await params;

    if (!entityId) {
      return new Response(
        JSON.stringify({ error: 'entity_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[API/progress] Reconnecting to stream for entity: ${entityId}`);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendMessage = (data: any) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        // Send a synthetic ACK so the client knows the connection is live
        sendMessage({ type: 'ACK', message: 'Stream connection established' });

        try {
          // Connect to the running workflow's iterator.
          // This does NOT start a new workflow -- it attaches to the existing one.
          const iterator = await client.start_iterator(entityId, 'start', []);

          try {
            let iteratorResult = await iterator.next();

            while (!iteratorResult.done) {
              const envelope = iteratorResult.value;

              // Unpack VALUE envelopes from ReportEntity for easier client consumption
              if (
                envelope.type === 'VALUE' &&
                envelope.sub_type === 'return' &&
                envelope.entity_name === 'ReportEntity'
              ) {
                const unpackedEnvelope = { ...envelope, ...envelope.value };
                sendMessage(unpackedEnvelope);
              } else {
                sendMessage(envelope);
              }

              iteratorResult = await iterator.next();
            }

            // When done=true, the iterator may carry a final return value
            const finalResult = iteratorResult.value;
            if (finalResult) {
              sendMessage(finalResult);
            }

            sendMessage({ type: 'DONE' });
          } finally {
            // Always clean up the iterator, even if an error occurred
            await iterator.cleanup();
            controller.close();
          }
        } catch (error: any) {
          console.error(`[API/progress] Stream error for entity ${entityId}:`, error);
          sendMessage({
            type: 'ERROR',
            message: error.message || 'Failed to reconnect to stream',
            error: error.toString()
          });
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: any) {
    console.error('[API/progress] Setup error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to setup stream' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
```

Let's walk through the important parts.

### The ReadableStream Pattern

Next.js App Router supports streaming responses by returning a `ReadableStream` from a route handler. The `start(controller)` callback runs when the stream opens, and you use `controller.enqueue()` to push data and `controller.close()` to end it.

```typescript
const stream = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();

    const sendMessage = (data: any) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(message));
    };

    // ... produce messages ...

    controller.close();
  }
});
```

The `sendMessage` helper formats each message as an SSE data frame: the string `data: ` followed by JSON, followed by two newlines. The double newline is the SSE message delimiter -- it tells the browser that one complete message has been sent.

### start_iterator: Reconnecting to a Running Workflow

The core of the route is the `start_iterator` call:

```typescript
const iterator = await client.start_iterator(entityId, 'start', []);
```

The three arguments are:
1. **`entityId`** -- The entity to connect to (the `entity_id` returned from the create call)
2. **`'start'`** -- The method name on the entity to call. For `RunnableEntity` subclasses, `start()` is the entry point that returns the async iterator.
3. **`[]`** -- Arguments to pass to the method. For a reconnect, no arguments are needed.

The returned `iterator` is a remote async iterator. It has the same interface as a local JavaScript async iterator (`next()`, `return()`, `throw()`) plus a `cleanup()` method that releases server-side resources.

### Unpacking VALUE Envelopes

When the `ReportEntity` completes, it yields a `VALUE` envelope where the actual result (containing `pdf_working_memory_id`, `reasoning`, `html_content`) is nested inside `envelope.value`. The route unpacks this for easier client consumption:

```typescript
if (
  envelope.type === 'VALUE' &&
  envelope.sub_type === 'return' &&
  envelope.entity_name === 'ReportEntity'
) {
  // Flatten: { type, sub_type, entity_name, ...envelope.value }
  const unpackedEnvelope = { ...envelope, ...envelope.value };
  sendMessage(unpackedEnvelope);
}
```

Without unpacking, the client would need to dig into `data.value.pdf_working_memory_id`. With unpacking, it can access `data.pdf_working_memory_id` directly.

### Iterator Cleanup

The `finally` block ensures the iterator is always cleaned up, even if the stream errors or the client disconnects:

```typescript
try {
  // ... iterate ...
} finally {
  await iterator.cleanup();
  controller.close();
}
```

Failing to call `cleanup()` would leave server-side resources (the gRPC stream to the agent bundle) open until they time out. Always use a `finally` block.

### SSE Response Headers

The response headers are critical for SSE to work correctly:

```typescript
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',     // Required: tells the browser this is SSE
    'Cache-Control': 'no-cache, no-transform', // Prevent caching and content modification
    'Connection': 'keep-alive',               // Keep the TCP connection open
    'X-Accel-Buffering': 'no',               // Disable nginx buffering
  },
});
```

The `X-Accel-Buffering: no` header is important if your deployment sits behind nginx or a similar reverse proxy. Without it, nginx may buffer the entire response and deliver it all at once when the stream ends, defeating the purpose of real-time streaming.

---

## Step 2: Client-Side -- Consume the SSE Stream

On the client side, you need to consume the SSE stream and turn it into React state updates. Create a custom hook that manages the full streaming lifecycle.

### Define the ProgressUpdate Type

First, define the type that represents all possible SSE messages:

**`apps/report-gui/src/hooks/useStreamingReportGeneration.ts`**:

```typescript
export interface ProgressUpdate {
  type:
    | 'INTERNAL_UPDATE'
    | 'ERROR'
    | 'DONE'
    | 'WAITING'
    | 'VALUE'
    | 'STATUS'
    | 'BOT_PROGRESS'
    | 'ACK';
  message?: string;
  metadata?: {
    stage?: string;
    node_id?: string;
    progress?: number;
    [key: string]: any;
  };
  // Present on unpacked VALUE envelopes from ReportEntity
  pdf_working_memory_id?: string;
  reasoning?: string;
  // Present on raw VALUE envelopes
  value?: any;
  sub_type?: string;
  entity_id?: string;
  entity_name?: string;
}
```

This is a union type -- not every field is present on every message. The `type` field tells you which fields to expect.

### The listenToStream Function

The `listenToStream` function takes a `fetch()` response and reads it as a stream of SSE messages. It uses `TextDecoderStream` to convert the raw bytes to strings, then parses SSE frames by splitting on the `\n\n` delimiter.

```typescript
import { useState, useCallback, useRef } from 'react';

export function useStreamingReportGeneration() {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProgressUpdate | null>(null);
  const [reviewStepEntityId, setReviewStepEntityId] = useState<string | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);

  const listenToStream = useCallback(async (response: Response) => {
    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    // Pipe the binary ReadableStream through TextDecoderStream to get strings
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    readerRef.current = reader;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate chunks -- a single read() may contain partial messages
        buffer += value;

        // Split on double newline (SSE message delimiter)
        const lines = buffer.split('\n\n');
        // The last element may be incomplete -- keep it in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as ProgressUpdate;

              // Route each message type to the appropriate state update
              if (data.type === 'ERROR') {
                setError(data.message || 'Processing failed');
                setIsProcessing(false);
                return;
              }

              if (data.type === 'DONE') {
                setIsProcessing(false);
                return;
              }

              if (data.type === 'INTERNAL_UPDATE') {
                // Append to the progress log
                setProgress(prev => [...prev, data]);
              } else if (
                data.type === 'VALUE' &&
                data.sub_type === 'return' &&
                data.entity_name === 'ReportEntity'
              ) {
                // Final report result -- extract the key fields
                setResult({
                  ...data,
                  pdf_working_memory_id: data.value.pdf_working_memory_id
                });
                setAiReasoning(data.value.reasoning);
              } else if (
                data.type === 'WAITING' &&
                data.entity_name === 'ReviewStep'
              ) {
                // Workflow paused for review -- store the ReviewStep entity ID
                setReviewStepEntityId(data.entity_id!);
                setIsProcessing(false);
              }
            } catch (parseError) {
              console.warn('[Stream] Failed to parse SSE message:', line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      readerRef.current = null;
    }
  }, []);
```

**How the SSE parsing works:**

1. `response.body` is a `ReadableStream<Uint8Array>` -- raw bytes from the HTTP response.
2. `.pipeThrough(new TextDecoderStream())` converts it to a `ReadableStream<string>` -- decoded UTF-8 text.
3. `.getReader()` gives you a pull-based reader with a `read()` method.
4. Each `read()` returns a chunk of text. Chunks do not align with SSE message boundaries -- a single `read()` might return half a message or three messages. The buffer handles this.
5. `buffer.split('\n\n')` splits on the SSE delimiter. The last element (via `lines.pop()`) is kept in the buffer because it may be incomplete.
6. Each complete line that starts with `data: ` is an SSE data frame. Strip the prefix, parse the JSON, and dispatch based on `type`.

### Handling Each Envelope Type

The `listenToStream` function routes messages based on their `type`:

- **`ERROR`** -- Sets the error message and stops processing. The user sees the error.
- **`DONE`** -- Sets `isProcessing` to false. The workflow has completed.
- **`INTERNAL_UPDATE`** -- Appends to the `progress` array. These are human-readable messages like "Stage 1/3: Extracting text from document" that you can display in a progress log.
- **`VALUE` with `sub_type: 'return'` from `ReportEntity`** -- This is the final result. The unpacked envelope contains `pdf_working_memory_id` (for downloading the PDF) and `reasoning` (the AI's explanation of its choices).
- **`WAITING` from `ReviewStep`** -- The workflow has paused for human review. The `entity_id` on this envelope is the ReviewStep's ID, which you will need in Part 13 to send approve/reject decisions. Processing stops until the user acts.
- **`ACK`** -- Connection confirmed. Useful for reconnection scenarios (see Step 4).

---

## Step 3: Wire It Together -- The Generate Function

The `generate` function ties together the create call from Part 11 and the progress stream into a single user action. When the user clicks "Generate Report", this function:

1. Calls `POST /api/reports/create` with the form data (file + prompt + orientation)
2. Gets back the `entity_id`
3. Immediately connects to `GET /api/reports/{id}/progress` to start receiving events
4. Delegates to `listenToStream` to consume the SSE stream

Add this to the same hook:

```typescript
  const generate = useCallback(async (formData: ReportFormData) => {
    try {
      // Reset state for a new generation
      setError(null);
      setProgress([]);
      setResult(null);
      setIsProcessing(true);

      if (!formData.file) {
        throw new Error('No file selected');
      }

      // Step 1: Create entity + upload document + start workflow (single call)
      const createResponse = await createReport({
        prompt: formData.prompt,
        orientation: formData.orientation,
        file: formData.file
      });

      const newEntityId = createResponse.entity_id;
      setEntityId(newEntityId);

      // Step 2: Connect to the progress stream.
      // The workflow is already running in the background on the agent bundle.
      const response = await fetch(`/api/reports/${newEntityId}/progress`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Failed to connect to progress stream'
        }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Step 3: Listen to the stream until it completes or errors
      await listenToStream(response);
    } catch (err: any) {
      setError(getErrorMessage(err));
      setIsProcessing(false);
      throw err;
    }
  }, [listenToStream]);
```

**Why `fetch()` instead of `EventSource`?**

The browser's built-in `EventSource` API is designed for SSE, but it has significant limitations:

- It only supports GET requests (no custom headers, no POST)
- It automatically reconnects on failure, which is not always desirable
- It does not give you access to the raw stream for custom parsing

Using `fetch()` with `TextDecoderStream` gives you full control over the connection lifecycle, error handling, and stream parsing. This is the recommended pattern for SSE in modern applications.

### The createReport Helper

The `createReport` function (from `reportApi.ts`) sends the file and metadata to the BFF's create endpoint:

```typescript
export async function createReport(
  request: CreateReportRequest & { file: File }
): Promise<CreateReportResponse> {
  const formData = new FormData();
  formData.append('file', request.file);
  formData.append('prompt', request.prompt);
  formData.append('orientation', request.orientation);

  const response = await fetch('/api/reports/create', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create report');
  }

  return response.json();
}
```

This sends multipart form data to the BFF, which forwards it to the agent bundle's `acceptsBlobs` endpoint. The response is `{ entity_id: string }`.

### Complete Hook Structure

Here is the full hook with all the pieces together:

**`apps/report-gui/src/hooks/useStreamingReportGeneration.ts`**:

```typescript
/**
 * useStreamingReportGeneration Hook
 * Manages report generation with real-time SSE streaming updates
 */

import { useState, useCallback, useRef } from 'react';
import { createReport, getErrorMessage } from '@/lib/reportApi';
import type { ReportFormData } from '@/types/report';

export interface ProgressUpdate {
  type: 'INTERNAL_UPDATE' | 'ERROR' | 'DONE' | 'WAITING' | 'VALUE' | 'STATUS' | 'BOT_PROGRESS' | 'ACK';
  message?: string;
  metadata?: {
    stage?: string;
    node_id?: string;
    progress?: number;
    [key: string]: any;
  };
  pdf_working_memory_id?: string;
  reasoning?: string;
  value?: any;
  sub_type?: string;
  entity_id?: string;
  entity_name?: string;
}

export function useStreamingReportGeneration() {
  const [entityId, setEntityId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProgressUpdate | null>(null);
  const [reviewStepEntityId, setReviewStepEntityId] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);

  /**
   * Read an SSE stream and dispatch messages to state
   */
  const listenToStream = useCallback(async (response: Response) => {
    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    readerRef.current = reader;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += value;
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as ProgressUpdate;

              if (data.type === 'ERROR') {
                setError(data.message || 'Processing failed');
                setIsProcessing(false);
                return;
              }
              if (data.type === 'DONE') {
                setIsProcessing(false);
                return;
              }
              if (data.type === 'INTERNAL_UPDATE') {
                setProgress(prev => [...prev, data]);
              } else if (data.type === 'VALUE' && data.sub_type === 'return' && data.entity_name === 'ReportEntity') {
                setResult({ ...data, pdf_working_memory_id: data.value.pdf_working_memory_id });
                setAiReasoning(data.value.reasoning);
              } else if (data.type === 'WAITING' && data.entity_name === 'ReviewStep') {
                setReviewStepEntityId(data.entity_id!);
                setIsProcessing(false);
              }
            } catch (parseError) {
              console.warn('[Stream] Failed to parse SSE message:', line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      readerRef.current = null;
    }
  }, []);

  /**
   * Cancel the ongoing stream
   */
  const cancelStream = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.cancel();
      readerRef.current = null;
    }
    setIsProcessing(false);
  }, []);

  /**
   * Generate a report: create entity + upload document, then stream progress
   */
  const generate = useCallback(async (formData: ReportFormData) => {
    try {
      setError(null);
      setProgress([]);
      setResult(null);
      setIsProcessing(true);

      if (!formData.file) {
        throw new Error('No file selected');
      }

      // Single call: create entity + upload document + start workflow
      const createResponse = await createReport({
        prompt: formData.prompt,
        orientation: formData.orientation,
        file: formData.file
      });

      const newEntityId = createResponse.entity_id;
      setEntityId(newEntityId);

      // Connect to the progress stream (workflow is already running)
      const response = await fetch(`/api/reports/${newEntityId}/progress`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Failed to connect to progress stream'
        }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      await listenToStream(response);
    } catch (err: any) {
      setError(getErrorMessage(err));
      setIsProcessing(false);
      throw err;
    }
  }, [listenToStream]);

  /**
   * Reset all state for a new generation
   */
  const reset = useCallback(() => {
    cancelStream();
    setEntityId(null);
    setIsProcessing(false);
    setProgress([]);
    setError(null);
    setResult(null);
    setReviewStepEntityId(null);
    setCurrentVersion(0);
    setAiReasoning(null);
  }, [cancelStream]);

  return {
    entityId,
    isProcessing,
    progress,
    error,
    result,
    reviewStepEntityId,
    currentVersion,
    aiReasoning,
    generate,
    reset,
    cancelStream,
  };
}
```

---

## Step 4: Handle Reconnection After Page Refresh

If the user refreshes the browser while a workflow is running, the SSE connection is lost. But the workflow continues running on the agent bundle. The user needs a way to reconnect.

The reconnection pattern reuses the same `GET /api/reports/[id]/progress` endpoint. Since `start_iterator` attaches to an **existing** workflow (it does not start a new one), calling the progress endpoint again with the same `entity_id` picks up wherever the workflow currently is.

### How Reconnection Works

1. The user refreshes the page.
2. The application detects an in-progress entity (e.g., from URL parameters, localStorage, or a status API call).
3. The application calls `GET /api/reports/{id}/progress` to reconnect to the stream.
4. The BFF calls `start_iterator(entityId, 'start', [])`, which attaches to the running workflow.
5. The client receives envelopes from the current point onward.

Any envelopes that were yielded before the reconnection are missed -- the stream picks up from where it currently is, not from the beginning. If you need to show historical progress, you can combine the progress stream with a status API call that returns previously recorded progress events.

### Reconnection in the Hook

Add a `reconnect` function to the hook that connects to an existing entity's progress stream:

```typescript
  /**
   * Reconnect to an existing entity's progress stream.
   * Use this after a page refresh when the workflow is still running.
   */
  const reconnect = useCallback(async (existingEntityId: string) => {
    try {
      setError(null);
      setProgress([]);
      setResult(null);
      setIsProcessing(true);
      setEntityId(existingEntityId);

      const response = await fetch(`/api/reports/${existingEntityId}/progress`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Failed to reconnect to progress stream'
        }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      await listenToStream(response);
    } catch (err: any) {
      setError(getErrorMessage(err));
      setIsProcessing(false);
    }
  }, [listenToStream]);
```

This is nearly identical to the `generate` function, but it skips the create step and goes straight to connecting to the progress stream.

### Checking If Reconnection Is Needed

On page load, check whether there is an in-progress entity that needs reconnection. You can use the status route from Part 11:

```typescript
// In your page component or a useEffect
useEffect(() => {
  const savedEntityId = searchParams.get('entity_id');
  if (savedEntityId) {
    // Check if the entity is still in progress
    fetch(`/api/reports/status?entity_id=${savedEntityId}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'InProgress' || data.status === 'Pending') {
          reconnect(savedEntityId);
        }
      });
  }
}, []);
```

This pattern works because the agent bundle's workflow is independent of the client connection. The workflow runs to completion (or until it hits a `WAITING` state) regardless of whether anyone is listening.

---

## What You've Built

You now have:
- A `GET /api/reports/[id]/progress` SSE endpoint that bridges the agent bundle's async iterator to the browser
- A `listenToStream` function that parses SSE messages and dispatches typed state updates
- A `generate` function that combines entity creation (from Part 11) with progress streaming in a single user action
- A reconnection pattern that lets users pick up where they left off after a page refresh
- A `useStreamingReportGeneration` hook that encapsulates the full streaming lifecycle

The data flow from end to end:

```
User clicks "Generate"
    |
    v
generate() calls POST /api/reports/create
    |-- BFF forwards to agent bundle's acceptsBlobs endpoint
    |-- Returns { entity_id }
    |
    v
generate() calls GET /api/reports/{id}/progress
    |-- BFF calls client.start_iterator(entityId, 'start', [])
    |-- BFF bridges iterator envelopes to SSE messages
    |
    v
listenToStream() parses SSE messages
    |-- INTERNAL_UPDATE -> progress[] (shown in progress log)
    |-- VALUE from ReportEntity -> result (PDF ready)
    |-- WAITING from ReviewStep -> reviewStepEntityId (paused for review)
    |-- ERROR -> error message
    |-- DONE -> processing complete
```

## Key Takeaways

1. **`start_iterator` reconnects, it does not restart.** Calling `client.start_iterator(entityId, 'start', [])` attaches to an existing workflow. If the workflow is already running, you receive envelopes from the current point onward. If it has completed, you receive the final result immediately.

2. **The BFF is a protocol bridge.** The agent bundle uses gRPC-based async iterators. The browser needs HTTP-based SSE. The BFF's job is to translate between these two protocols -- loop over the iterator, format each envelope as `data: <json>\n\n`, and stream it to the browser.

3. **Always clean up the iterator in a `finally` block.** The iterator holds server-side resources (a gRPC stream). Failing to call `cleanup()` leaks these resources. The `finally` block ensures cleanup happens even when errors occur or the client disconnects.

4. **Buffer-based SSE parsing handles chunked delivery.** Network chunks do not align with SSE message boundaries. The `buffer += value; lines = buffer.split('\n\n'); buffer = lines.pop()` pattern correctly handles messages that span multiple chunks or multiple messages in a single chunk.

5. **`X-Accel-Buffering: no` is essential for proxied deployments.** Without this header, reverse proxies like nginx will buffer the entire SSE response and deliver it all at once, destroying the real-time streaming behavior.

6. **VALUE envelopes need unpacking.** The `ReportEntity`'s return value is nested inside `envelope.value`. The BFF unpacks it by spreading `envelope.value` into the top-level object, making the client code simpler.

7. **WAITING signals a human decision point.** When the `ReviewStep` entity yields a `WAITING` envelope, the workflow is paused. The `entity_id` on that envelope is the ReviewStep's ID, which you will need in Part 13 to approve or reject the report.

## Next Step

The workflow now pauses at the `WAITING` envelope, waiting for the user to approve or reject the generated report. In [Part 13: Review Interaction & Report Management](./part-13-review-and-management.md), you'll build the approve and feedback submission routes, report history queries, PDF downloads, and complete the human-in-the-loop review cycle from the consumer frontend.
