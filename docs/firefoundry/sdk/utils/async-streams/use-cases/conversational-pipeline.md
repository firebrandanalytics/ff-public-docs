# Conversational Pipeline

Multi-stage request-response processing for conversational turns, using `BidirectionalChain` to compose input sanitization, context enrichment, response generation, and output formatting into a single callable pipeline.

---

## The Problem

You have a conversational interface -- a chatbot, command processor, or interactive agent -- where each user message must pass through multiple processing stages before a response is returned. The stages include:

1. **Input sanitization.** Strip whitespace, normalize casing, reject empty or oversized messages.
2. **Context enrichment.** Attach metadata -- turn number, timestamps, conversation history -- so downstream stages can make context-aware decisions.
3. **Response generation.** Produce a reply based on the enriched input. This might be a lookup, a transformation, or a call to an external service.
4. **Output formatting.** Structure the final response for the client: wrap in a standard envelope, truncate if needed, add timing information.

Without a composition mechanism, this logic scatters across a single monolithic handler or a manually wired chain of function calls. Each approach has drawbacks:

- **Monolithic handler.** All concerns in one function. Adding a new stage means editing the function, risking regressions in unrelated stages. Testing any single stage requires invoking the entire handler.

- **Manual function composition.** You wire `format(generate(enrich(sanitize(input))))` by hand. The nesting inverts the visual order (rightmost runs first), stateful stages need external variables, and adding a logging tap between stages requires restructuring the call chain.

What you want is a pipeline where:

- Stages compose left-to-right, matching the conceptual data flow.
- Stateless transforms (sanitization, formatting) use simple functions.
- Stateful stages (turn counter, context history) encapsulate their own state via closures or generator functions.
- Side-effect taps (logging, metrics) can be inserted anywhere without modifying adjacent stages.
- Each `.next(input)` call sends a message through the full pipeline and returns the response.

## The Strategy

**BidirectionalChain: function-based request-response composition.**

`BidirectionalChain` models the request-response pattern directly. Each call to `.next(input)` flows the input through all stages left-to-right, and the caller receives the final output. Unlike pull chains (consumer-driven) or push chains (producer-driven), bidirectional chains are caller-driven: the caller controls both when data enters and when they receive the result.

| Method | Purpose |
|--------|---------|
| `identity()` | Creates a pass-through starting point that preserves the input type |
| `.map(fn)` | Appends a stateless transform -- a pure function from current value to new value |
| `.then(factory)` | Appends a stateful stage -- the factory creates a closure with private state |
| `.tap(fn)` | Appends a side-effect observer that sees the value but does not modify it |
| `fromGenerator(factory)` | Adapts a generator-based stage, handling priming internally |

The chain uses function-based stages internally, not generators. This avoids the priming confusion of JavaScript generators (where the first `.next()` argument is silently discarded). Generator stages are supported via `fromGenerator()`, which handles priming automatically.

## Architecture

```
+----------+    +-----------+    +-----------+    +------------+    +----------+
|  caller  |--->| sanitize  |--->|  enrich   |--->|  generate  |--->|  format  |---> response
| .next()  |    | .map()    |    | .then()   |    | .then()    |    | .map()   |
+----------+    +-----------+    +-----------+    +------------+    +----------+
                  stateless       stateful          stateful         stateless
                                  (turn #,          (context-        (envelope)
                                   history)          aware reply)
```

**Data flow:** The caller invokes `pipeline.next("hello world")`. The string flows through `sanitize` (trimmed, lowercased), then `enrich` (wrapped in a context object with turn number and timestamp), then `generate` (a stateful stage that produces a response based on the enriched context), and finally `format` (structured into a response envelope). The caller receives the formatted response as `{ value: ..., done: false }`.

**State management:** Each stateful stage owns its state privately. The turn counter in `enrich` increments on every call. No shared mutable state exists between stages.

## Implementation

### Type definitions

```typescript
import { BidirectionalChain } from '@firebrandanalytics/shared-utils';

/** What flows between sanitization and enrichment. */
type SanitizedInput = string;

/** What flows between enrichment and generation. */
interface EnrichedMessage {
    text: string;
    turn: number;
    timestamp: number;
    history: string[];
}

/** What the pipeline returns to the caller. */
interface FormattedResponse {
    reply: string;
    turn: number;
    processingMs: number;
}
```

### Stage 1: Input sanitization (stateless, `.map()`)

```typescript
.map((raw: string): SanitizedInput => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return '[empty]';
    if (trimmed.length > 500) return trimmed.slice(0, 500) + '...';
    return trimmed.toLowerCase();
})
```

This is a pure function. It has no state, no side effects, and no async operations. `.map()` is the right tool: it transforms one value into another.

### Stage 2: Logging tap (side-effect, `.tap()`)

```typescript
.tap((sanitized: SanitizedInput) => {
    console.log(`  [sanitize] "${sanitized}"`);
})
```

`.tap()` sees the value flowing through but does not modify it. The value that enters the tap is the same value that leaves it. This is the correct place for logging, metrics emission, or debugging breakpoints.

### Stage 3: Context enrichment (stateful, `.then()`)

```typescript
.then<EnrichedMessage>(() => {
    let turn = 0;
    const history: string[] = [];
    return (text: SanitizedInput): EnrichedMessage => {
        turn++;
        history.push(text);
        return {
            text,
            turn,
            timestamp: Date.now(),
            history: [...history],
        };
    };
})
```

`.then()` accepts a factory that returns a processor function. The factory runs once at build time and closes over `turn` and `history`. Each subsequent call to the processor increments the counter and appends to the history. The state is private -- no external variable, no class instance, no risk of accidental sharing.

### Stage 4: Response generation (generator-based, `fromGenerator()`)

To demonstrate generator integration, the runnable example includes a generator-based stage that uses the `let input = yield output` pattern. The chain's `fromGenerator()` adapter handles priming automatically.

```typescript
async function* responseGenerator(): AsyncGenerator<string, any, EnrichedMessage> {
    let msg: EnrichedMessage = yield '';  // initial yield -- discarded by adapter
    while (true) {
        const reply = msg.turn === 1
            ? `Welcome! You said: "${msg.text}"`
            : `[Turn ${msg.turn}] Echo: "${msg.text}" (history: ${msg.history.length} msgs)`;
        msg = yield reply;
    }
}

const generatorStage = BidirectionalChain.fromGenerator(() => responseGenerator());
```

The adapter calls `gen.next(undefined)` once to prime the generator, advancing it to the first `yield`. Subsequent `.next(input)` calls send the `EnrichedMessage` into the generator and receive the yielded string. The caller never deals with priming -- `BidirectionalChain.fromGenerator()` handles it.

### Stage 5: Output formatting (stateless, `.map()`)

```typescript
.map((reply: string): FormattedResponse => ({
    reply,
    turn: currentTurn,
    processingMs: Date.now() - stageStart,
}))
```

In the full pipeline, the formatting stage captures turn information from the enrichment tap. See the runnable example for the complete wiring.

### Full pipeline assembly

```typescript
const pipeline = BidirectionalChain.identity<string>()
    .map(raw => {                            // Stage 1: sanitize
        const t = raw.trim();
        if (t.length === 0) return '[empty]';
        return t.toLowerCase();
    })
    .tap(s => console.log(`  [sanitize] "${s}"`))
    .then<EnrichedMessage>(() => {           // Stage 3: enrich
        let turn = 0;
        const history: string[] = [];
        return text => {
            turn++;
            history.push(text);
            return { text, turn, timestamp: Date.now(), history: [...history] };
        };
    })
    .tap(msg => console.log(`  [enrich]   turn=${msg.turn}`))
    .then<string>(() => {                    // Stage 4: generate
        return msg => msg.turn === 1
            ? `Welcome! You said: "${msg.text}"`
            : `[Turn ${msg.turn}] Echo: "${msg.text}"`;
    })
    .tap(reply => console.log(`  [generate] "${reply}"`))
    .map(reply => ({ reply, timestamp: new Date().toISOString() }));
```

### Driving the pipeline

```typescript
const messages = ['  Hello World  ', 'How are you?', '  ', 'Goodbye!'];

for (const msg of messages) {
    console.log(`\n> User: "${msg}"`);
    const result = await pipeline.next(msg);
    console.log(`< Bot:  ${JSON.stringify(result.value)}`);
}

await pipeline.return();
```

Each call to `pipeline.next(msg)` sends the message through all stages synchronously (with respect to the caller -- individual stages may internally be async). The caller awaits the result and receives the fully processed response.

For the full runnable version, see [`examples/conversational-pipeline.ts`](../examples/conversational-pipeline.ts).

## What to Observe

When you run the example, output looks like this:

```
--- conversational-pipeline ---
Processing 4 user messages through a multi-stage pipeline.

> User: "  Hello World  "
  [sanitize] "hello world"
  [enrich]   turn=1  history=1
  [generate] "Welcome! You said: \"hello world\""
  [format]   {reply, turn=1}
< Bot:  {"reply":"Welcome! You said: \"hello world\"","turn":1,"processingMs":0}

> User: "How are you?"
  [sanitize] "how are you?"
  [enrich]   turn=2  history=2
  [generate] "[Turn 2] Echo: \"how are you?\" (history: 2 msgs)"
  [format]   {reply, turn=2}
< Bot:  {"reply":"[Turn 2] Echo: \"how are you?\" (history: 2 msgs)","turn":2,"processingMs":1}

> User: "  "
  [sanitize] "[empty]"
  [enrich]   turn=3  history=3
  [generate] "[Turn 3] Echo: \"[empty]\" (history: 3 msgs)"
  [format]   {reply, turn=3}
< Bot:  {"reply":"[Turn 3] Echo: \"[empty]\" (history: 3 msgs)","turn":3,"processingMs":0}

> User: "Goodbye!"
  [sanitize] "goodbye!"
  [enrich]   turn=4  history=4
  [generate] "[Turn 4] Echo: \"goodbye!\" (history: 4 msgs)"
  [format]   {reply, turn=4}
< Bot:  {"reply":"[Turn 4] Echo: \"goodbye!\" (history: 4 msgs)","turn":4,"processingMs":0}

--- generator-based pipeline ---
Running the same conversation through a fromGenerator()-based response stage.

> User: "  Hello World  "
  [generate] "Welcome! You said: \"hello world\""
< Bot:  "Welcome! You said: \"hello world\""

> User: "How are you?"
  [generate] "[Turn 2] Echo: \"how are you?\" (history: 2 msgs)"
< Bot:  "[Turn 2] Echo: \"how are you?\" (history: 2 msgs)"

[summary]  turns=4  pipeline_stages=8
```

**What each stage demonstrates:**

| Stage | Method | Stateful? | What it shows |
|-------|--------|-----------|---------------|
| Sanitize | `.map()` | No | Pure transforms: trim, lowercase, length guard |
| Sanitize tap | `.tap()` | No | Observability without modifying the value |
| Enrich | `.then()` | Yes | Closure-based state: turn counter, history accumulation |
| Enrich tap | `.tap()` | No | Inspecting enriched context mid-pipeline |
| Generate | `.then()` | Yes | Response logic with access to enriched context |
| Generate tap | `.tap()` | No | Logging the generated response before formatting |
| Format | `.map()` | No | Structuring the final output envelope |

**Key insight:** Every `.next()` call is a complete round-trip. The caller sends a message and receives a fully processed response. There is no buffering, no batching, no asynchronous delivery -- the bidirectional model is synchronous from the caller's perspective (though individual stages may internally be async). This makes it ideal for request-response protocols where the caller needs the answer before proceeding.

## Variations

### 1. Generator-based stateful stage

Replace the `.then()` response generator with `fromGenerator()` for stages that naturally express state via `yield`:

```typescript
async function* echoWithMemory(): AsyncGenerator<string, any, EnrichedMessage> {
    const keywords: string[] = [];
    let msg: EnrichedMessage = yield '';
    while (true) {
        const words = msg.text.split(/\s+/);
        keywords.push(...words);
        const reply = `Heard "${msg.text}". Keywords so far: [${keywords.join(', ')}]`;
        msg = yield reply;
    }
}

const pipeline = BidirectionalChain.identity<string>()
    .map(s => s.trim().toLowerCase())
    .then<EnrichedMessage>(/* ... enrich ... */)
    .then<string>(() => {
        // Wrap the generator in a fromGenerator adapter inline
        const adapter = BidirectionalChain.fromGenerator(() => echoWithMemory());
        return async (msg: EnrichedMessage) => (await adapter.next(msg)).value;
    });
```

### 2. Branching responses based on intent

Add a classification stage that routes to different response generators:

```typescript
const pipeline = BidirectionalChain.identity<string>()
    .map(s => s.trim().toLowerCase())
    .then<EnrichedMessage>(/* ... enrich ... */)
    .then<string>(() => {
        return (msg) => {
            if (msg.text.startsWith('/help'))
                return 'Available commands: /help, /status, /reset';
            if (msg.text.startsWith('/status'))
                return `Status: active, turn ${msg.turn}`;
            return `Echo: "${msg.text}"`;
        };
    });
```

### 3. Async stages for external service calls

Stages can be async. Replace the mock response generator with a real API call:

```typescript
.then<string>(() => {
    return async (msg: EnrichedMessage) => {
        const response = await fetch('https://api.example.com/chat', {
            method: 'POST',
            body: JSON.stringify({ message: msg.text, turn: msg.turn }),
        });
        const data = await response.json();
        return data.reply;
    };
})
```

### 4. Error boundary stage

Wrap stages in error handling so the pipeline always returns a response:

```typescript
const safePipeline = BidirectionalChain.identity<string>()
    .map(s => s.trim().toLowerCase())
    .then<string>(() => {
        return (text) => {
            if (text.includes('crash')) throw new Error('simulated failure');
            return `OK: ${text}`;
        };
    });

// Caller handles errors:
try {
    const result = await safePipeline.next('please crash');
} catch (err) {
    console.error('Pipeline error:', (err as Error).message);
}
```

### 5. Composing two independent chains

Build sub-pipelines for different concerns and drive them sequentially:

```typescript
const preprocessing = BidirectionalChain.identity<string>()
    .map(s => s.trim().toLowerCase())
    .then<EnrichedMessage>(/* ... enrich ... */);

const generation = BidirectionalChain.identity<EnrichedMessage>()
    .then<string>(/* ... generate ... */)
    .map(reply => ({ reply, timestamp: Date.now() }));

// Drive manually:
const enriched = await preprocessing.next('Hello');
const response = await generation.next(enriched.value);
```

## See Also

- [Conceptual Guide](../concepts.md) -- Push, pull, and bidirectional model philosophy
- [Push Pipeline Basics Tutorial](../tutorials/push-pipeline-basics.md) -- Comparison: push model for fire-and-forget vs. bidirectional for request-response
- [Pull Pipeline Basics Tutorial](../tutorials/pull-pipeline-basics.md) -- Comparison: pull model for consumer-driven iteration
