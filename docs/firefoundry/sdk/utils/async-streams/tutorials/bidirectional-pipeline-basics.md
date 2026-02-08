# Bidirectional Pipeline Basics

This tutorial walks you through building bidirectional pipelines with `BidirectionalChain`. By the end you will understand the request-response model, how to compose stateless and stateful stages, how to integrate generator-based stages, and when to choose bidirectional over pull or push.

## 1. What Is a Bidirectional Pipeline?

A bidirectional pipeline is **caller-driven**: the caller sends a request via `.next(input)` and receives a response. The input flows through all stages left-to-right, each stage transforms it, and the final output is returned to the caller as an `IteratorResult`.

This is different from pull (consumer pulls when ready, many sources converge into one) and push (producer fires events into branching sinks). In a bidirectional chain, **you** control both what goes in and when, and you get the result back immediately.

**When to use bidirectional pipelines:**

- Request-response protocols (sanitize → enrich → process → format)
- Stateful transformations where each call depends on prior calls (accumulators, counters, session state)
- Conversational interfaces (each user message produces a bot reply)
- Any pipeline where the caller needs the output before proceeding

```typescript
import { BidirectionalChain } from '@firebrandanalytics/shared-utils';
```

## 2. Your First Pipeline

Everything starts with a factory method and fluent composition.

```typescript
import { BidirectionalChain } from '@firebrandanalytics/shared-utils';

// Step 1: Start with identity (pass-through)
const echo = BidirectionalChain.identity<string>();

const r1 = await echo.next('hello');
console.log(r1.value); // 'hello'
console.log(r1.done);  // false

// Step 2: Add a transform
const upper = BidirectionalChain.identity<string>()
    .map(s => s.toUpperCase());

const r2 = await upper.next('hello');
console.log(r2.value); // 'HELLO'

// Step 3: Chain multiple stages
const pipeline = BidirectionalChain.identity<string>()
    .map(s => s.trim())
    .map(s => s.toLowerCase())
    .map(s => s.toUpperCase());

const r3 = await pipeline.next('  Hello World  ');
console.log(r3.value); // 'HELLO WORLD'
```

Each fluent method (`.map()`, `.then()`, `.tap()`) returns a **new** `BidirectionalChain` instance. The original is not modified -- this is an immutable builder pattern.

## 3. Static Factories

There are four ways to create a starting chain. Choose the one that matches your stage's nature.

### identity() -- Pass-through starting point

Creates a chain that returns its input unchanged. Use this when you want to start a pipeline and add transforms with fluent methods.

```typescript
const chain = BidirectionalChain.identity<number>();

await chain.next(42); // { value: 42, done: false }
await chain.next(0);  // { value: 0, done: false }
```

No initial value is needed -- unlike the deprecated `TwoWayIdentity(initial)`, `identity()` has no priming step.

### of(fn) -- Stateless processor

Creates a chain from a single function. Use this for stateless stages -- functions that produce the same output for the same input regardless of call history.

```typescript
const doubler = BidirectionalChain.of<number, number>(n => n * 2);

await doubler.next(5); // { value: 10, done: false }
await doubler.next(3); // { value: 6, done: false }
```

```typescript
const formatter = BidirectionalChain.of<number, string>(n => `val:${n}`);

await formatter.next(42); // { value: 'val:42', done: false }
```

### from(factory) -- Stateful processor

Creates a chain from a factory that produces a processor function. The factory is called lazily on first use. Use this when your stage needs private state.

```typescript
const accumulator = BidirectionalChain.from<number, number>(() => {
    let total = 0;
    return (n) => { total += n; return total; };
});

await accumulator.next(10); // { value: 10, done: false }
await accumulator.next(20); // { value: 30, done: false }
await accumulator.next(5);  // { value: 35, done: false }
```

The factory closure captures `total`. Each call to the returned function updates the running sum. The state is private -- no external variables needed.

### fromGenerator(factory) -- Generator adapter

Wraps an `AsyncGenerator`-based stage. The generator is automatically primed (the initial `.next()` is called internally and its yielded value is discarded). Use this to integrate generator-based stages that use the `let input = yield output` pattern.

```typescript
async function* doubler(): AsyncGenerator<number, any, number> {
    let input: number = yield 0; // initial yield -- discarded by adapter
    while (true) {
        input = yield input * 2;
    }
}

const chain = BidirectionalChain.fromGenerator(() => doubler());

await chain.next(5); // { value: 10, done: false }
await chain.next(3); // { value: 6, done: false }
await chain.next(0); // { value: 0, done: false }
```

The `yield 0` on the first line is the priming yield -- the adapter calls `.next(undefined)` to advance past it, so the first real `.next(5)` sends `5` into the generator and receives `10` back. The caller never deals with priming.

## 4. Fluent Methods

### map -- Transform Each Output

Appends a function that transforms each output value. The function can be synchronous or asynchronous.

```typescript
const chain = BidirectionalChain.identity<number>()
    .map(n => n * 10);

await chain.next(5); // { value: 50, done: false }
await chain.next(3); // { value: 30, done: false }
```

Multiple maps compose naturally -- they run left-to-right:

```typescript
const chain = BidirectionalChain.identity<number>()
    .map(n => n + 100)
    .map(n => `${n}`);

await chain.next(5);  // { value: '105', done: false }
await chain.next(10); // { value: '110', done: false }
```

Async functions are supported:

```typescript
const chain = BidirectionalChain.identity<string>()
    .map(async s => s.toUpperCase());

await chain.next('hello'); // { value: 'HELLO', done: false }
```

### then -- Append a Stateful Stage

Appends a stage via a processor factory. This is the general composition method. The factory runs once when the chain is first used and must return a processor function.

```typescript
const chain = BidirectionalChain
    .of<number, number>(n => n * 2)
    .then<string>(() => {
        let count = 0;
        return async (n) => `[${++count}] ${n}`;
    });

await chain.next(5); // { value: '[1] 10', done: false }
await chain.next(3); // { value: '[2] 6', done: false }
await chain.next(0); // { value: '[3] 0', done: false }
```

The factory creates a closure over `count`. Each call increments it. The `of(n => n * 2)` stage runs first, doubling the input, then the `then()` stage formats the result with a running counter.

### tap -- Observe Without Modifying

Appends a side-effect stage that sees the value but does not change it. Useful for logging, metrics, and debugging.

```typescript
const observed: number[] = [];
const chain = BidirectionalChain.identity<number>()
    .tap(n => { observed.push(n); })
    .map(n => n * 2);

await chain.next(5); // { value: 10, done: false }
await chain.next(3); // { value: 6, done: false }

console.log(observed); // [5, 3]
```

The tap sees the value *before* it reaches the next stage. The value `5` enters the tap, is observed, and then flows into `.map(n => n * 2)` which produces `10`.

## 5. Closing the Chain

A `BidirectionalChain` follows the `AsyncGenerator` protocol. You can close it with `return()` or signal an error with `throw()`.

### return() -- Graceful shutdown

```typescript
const chain = BidirectionalChain.identity<number>();

await chain.next(1);              // { value: 1, done: false }

const result = await chain.return(42);
console.log(result.done);         // true
console.log(result.value);        // 42

const after = await chain.next(5);
console.log(after.done);          // true -- chain is closed
```

After `return()`, all subsequent `.next()` calls return `{ value: undefined, done: true }`.

### throw() -- Error shutdown

```typescript
const chain = BidirectionalChain.identity<number>();

await chain.next(1);

try {
    await chain.throw(new Error('abort'));
} catch (err) {
    console.log((err as Error).message); // 'abort'
}

const after = await chain.next(5);
console.log(after.done); // true -- chain is closed
```

## 6. Error Handling

Errors thrown by stage functions propagate directly to the caller of `.next()`. The chain itself remains open after a stage error -- only `return()` and `throw()` permanently close the chain.

```typescript
const chain = BidirectionalChain.of<number, number>(n => {
    if (n < 0) throw new Error('negative input');
    return n * 2;
});

await chain.next(5);    // { value: 10, done: false }

try {
    await chain.next(-1); // throws Error('negative input')
} catch (err) {
    console.log((err as Error).message); // 'negative input'
}

await chain.next(3);    // { value: 6, done: false } -- chain is still open
```

This means transient errors (invalid input, network timeouts) do not kill the pipeline. The caller can catch the error and retry with different input.

## 7. Practical Example: Metric Normalizer

Here is a pipeline that normalizes raw metric readings by applying unit conversion, outlier clamping, and running average smoothing:

```typescript
import { BidirectionalChain } from '@firebrandanalytics/shared-utils';

interface MetricReading {
    sensor: string;
    value: number;
    unit: 'celsius' | 'fahrenheit';
}

interface NormalizedReading {
    sensor: string;
    celsius: number;
    smoothed: number;
    readingNumber: number;
}

const normalizer = BidirectionalChain.identity<MetricReading>()
    // Stage 1: Convert to celsius
    .map(reading => ({
        sensor: reading.sensor,
        celsius: reading.unit === 'fahrenheit'
            ? (reading.value - 32) * 5 / 9
            : reading.value,
    }))
    // Stage 2: Clamp outliers to [-50, 150] range
    .map(reading => ({
        ...reading,
        celsius: Math.max(-50, Math.min(150, reading.celsius)),
    }))
    // Stage 3: Running average (stateful)
    .then<NormalizedReading>(() => {
        let count = 0;
        let sum = 0;
        return (reading) => {
            count++;
            sum += reading.celsius;
            return {
                sensor: reading.sensor,
                celsius: reading.celsius,
                smoothed: sum / count,
                readingNumber: count,
            };
        };
    });

// Drive the pipeline with sensor readings
const readings: MetricReading[] = [
    { sensor: 'A', value: 72, unit: 'fahrenheit' },  // 22.22°C
    { sensor: 'A', value: 25, unit: 'celsius' },      // 25°C
    { sensor: 'A', value: 212, unit: 'fahrenheit' },   // 100°C (clamped if > 150)
    { sensor: 'A', value: 20, unit: 'celsius' },       // 20°C
];

for (const reading of readings) {
    const result = await normalizer.next(reading);
    const r = result.value;
    console.log(
        `#${r.readingNumber} ${r.sensor}: ${r.celsius.toFixed(1)}°C` +
        ` (smoothed: ${r.smoothed.toFixed(1)}°C)`
    );
}

await normalizer.return();
```

Output:

```
#1 A: 22.2°C (smoothed: 22.2°C)
#2 A: 25.0°C (smoothed: 23.6°C)
#3 A: 100.0°C (smoothed: 49.1°C)
#4 A: 20.0°C (smoothed: 41.8°C)
```

Each call to `normalizer.next(reading)` sends a raw metric reading through the pipeline and receives the fully normalized result. The running average accumulates across calls because the `.then()` stage is stateful.

## 8. Bidirectional vs Pull vs Push: When to Choose Each

| Aspect | Pull (PullChain) | Push (PushChainBuilder) | Bidirectional (BidirectionalChain) |
|--------|------------------|-------------------------|------------------------------------|
| Data flow | Consumer pulls | Producer pushes | Caller sends, receives response |
| Laziness | Lazy -- on demand | Eager -- immediate | Immediate -- on each `.next()` |
| Topology | Many-to-one | One-to-many | One-to-one (pipeline) |
| State | Source holds state | Sink receives state | Stages hold private state via closures |
| Use case | ETL, combining sources | Event dispatch, fan-out | Request-response, conversational, stateful transforms |
| Construction | Forward from source | Backward from sink | Forward, lazy build on first use |
| Iteration | `for await...of` | Producer calls `.next()` | Caller calls `.next(input)` per request |

**Rule of thumb:**
- **Pull** when you have data to process and the consumer controls the pace.
- **Push** when you have events to dispatch to multiple subscribers.
- **Bidirectional** when each input requires a corresponding output and the caller drives the conversation.

## 9. Next Steps

- [Conversational Pipeline Use Case](../use-cases/conversational-pipeline.md) -- Multi-stage chatbot pipeline with sanitization, enrichment, and response generation
- [BidirectionalChain API Reference](../reference/bidirectional-chain.md) -- Complete API including `fromGenerator()`, protocol delegation, and design notes
- [Pull Pipeline Basics](./pull-pipeline-basics.md) -- Comparison: lazy consumer-driven pipelines
- [Push Pipeline Basics](./push-pipeline-basics.md) -- Comparison: eager producer-driven event dispatch
