# Use Case 6: Priority Request Routing (QoS)

Route LLM completion requests from tiered users through a priority queue so premium subscribers get faster service, while aging-based starvation prevention guarantees that free-tier requests are eventually served.

## The Problem

An LLM broker service accepts completion requests from users on three subscription tiers:

- **Premium** — paying customers who expect low latency.
- **Standard** — mid-tier users with moderate latency expectations.
- **Free** — unpaid users on a best-effort basis.

The broker has a limited number of concurrent LLM inference slots (e.g., 4). When all slots are busy, incoming requests queue up. The question is: *in what order should queued requests be served?*

A FIFO queue treats all users equally. Premium users who are paying for priority get the same latency as free users during peak load. That defeats the value proposition of the paid tier.

A strict priority queue fixes the latency problem for premium users but creates a new one: during sustained load, free-tier requests can **starve** indefinitely. If premium and standard requests keep arriving, free requests sit in the queue forever. Free users see timeout errors, retry, amplify the load, and the system degrades.

What you want is a priority queue with a **fairness guarantee**: premium requests are served first, but free requests are guaranteed service within a bounded wait time.

## The Strategy

**Priority scheduling with aging-based starvation prevention.**

`PrioritySourceObj` is a priority queue that doubles as a `PullObj` source with `Peekable` support — exactly what `ScheduledTaskPoolRunner` needs. Each request is enqueued with a base priority reflecting its tier:

| Tier | Base Priority |
|------|---------------|
| Premium | 100 |
| Standard | 50 |
| Free | 10 |

Higher priority means "serve first." When multiple requests are queued, the runner always starts the one with the highest *effective* priority.

**Effective priority = base priority + min(agingRate × wait_ms, maxAgeBoost)**

With `agingRate: 0.005` and `maxAgeBoost: 45`:

- A **fresh premium** request has effective priority 100. It beats everything.
- A **fresh free** request has effective priority 10. It loses to everything.
- A **free request waiting 9 seconds** has effective priority 10 + min(0.005 × 9000, 45) = 10 + 45 = **55**. It now overtakes a fresh standard request (50).
- A free request's effective priority **caps at 55** (10 + 45). It can never reach 100, so a fresh premium request always wins.

This produces a three-regime behavior:

1. **Low load:** All requests are served immediately. Priority is irrelevant.
2. **Moderate load:** Premium requests jump the queue. Standard and free requests wait longer but are served within seconds as aging boosts their effective priority.
3. **High load:** Premium requests still get served first. Free requests wait longer (up to the aging cap) but are guaranteed service — they cannot starve because their effective priority eventually exceeds fresh standard requests.

## Architecture

```
Incoming Requests
  |
  |  enqueue(task, priority)
  |    premium -> priority 100
  |    standard -> priority 50
  |    free -> priority 10
  v
PrioritySourceObj<ScheduledTask>
  |  agingRate: 0.005  (+5 priority / second)
  |  maxAgeBoost: 45   (free caps at 55)
  |
  |  peek() / next() — highest effective priority first
  v
ScheduledTaskPoolRunner('broker')
  |
  +-- capacity: ResourceCapacitySource { slots: 4 }
  |       |
  |       |  canAcquire({ slots: 1 })
  |       |  acquireImmediate({ slots: 1 })
  |       |  release({ slots: 1 })
  |       |
  v
for await (envelope of runner.runTasks(false))
  -> FINAL { taskId, value: { tier: 'premium', latency: 120 } }
  -> FINAL { taskId, value: { tier: 'free', latency: 3400 } }
  -> ...
```

The runner's lifecycle drives the system:

1. **Peek** the priority source for the highest-effective-priority request.
2. **Check** whether a slot is available: `capacity.canAcquire({ slots: 1 })`.
3. **Acquire** the slot and start the LLM call.
4. When the call completes, **release** the slot and yield a `FINAL` envelope.
5. The released slot wakes the runner's fill loop, which peeks again.

Because `PrioritySourceObj` re-evaluates effective priority on every `peek()`, aging happens automatically. A free request that has been waiting since step 1 has a higher effective priority by step 5.

## Implementation

### Request simulation

Each request simulates an LLM completion call with a variable duration. Requests arrive in a burst — all 30 enqueued at once — to demonstrate priority ordering under contention:

```typescript
type Tier = 'premium' | 'standard' | 'free';

const TIER_PRIORITY: Record<Tier, number> = {
  premium: 100,
  standard: 50,
  free: 10,
};

const requests: Array<{ tier: Tier; id: number }> = [
  ...Array.from({ length: 5 }, (_, i) => ({ tier: 'premium' as Tier, id: i + 1 })),
  ...Array.from({ length: 10 }, (_, i) => ({ tier: 'standard' as Tier, id: i + 1 })),
  ...Array.from({ length: 15 }, (_, i) => ({ tier: 'free' as Tier, id: i + 1 })),
];
```

### Priority source setup

`PrioritySourceObj` is generic over the item type. Here each item is a `ScheduledTask` — the type `ScheduledTaskPoolRunner` expects:

```typescript
const source = new PrioritySourceObj<ScheduledTask<string, string>>({
  agingRate: 0.005,    // +5 effective priority per second of wait
  maxAgeBoost: 45,     // free caps at 10 + 45 = 55
});
```

### Enqueuing requests

Each request becomes a `ScheduledTask` enqueued at its tier's base priority. The runner function simulates an LLM call:

```typescript
const rng = makeRng(42);

for (const req of requests) {
  const key = `${req.tier}-${req.id}`;
  source.enqueue(
    {
      key,
      cost: { slots: 1 },
      runner: async () => {
        const latency = 200 + Math.floor(rng() * 300); // 200-500ms
        await sleep(latency);
        return `${key}:${latency}ms`;
      },
    },
    TIER_PRIORITY[req.tier],
  );
}

// Signal that no more requests will arrive
source.closeSource();
```

### Runner loop

The runner consumes from the priority source with 4 concurrent LLM slots:

```typescript
const capacity = new ResourceCapacitySource({ slots: 4 });
const runner = new ScheduledTaskPoolRunner<string, string>(
  'broker',
  source,
  capacity,
);

const results: Array<{ key: string; position: number }> = [];
let position = 0;

for await (const envelope of runner.runTasks(false)) {
  if (envelope.type === 'FINAL') {
    position++;
    const key = String(envelope.value).split(':')[0];
    results.push({ key, position });
    console.log(`[${position}] ${envelope.value}`);
  }
}
```

### Analyzing the results

After all requests complete, group by tier and compute average completion position:

```typescript
for (const tier of ['premium', 'standard', 'free'] as Tier[]) {
  const tierResults = results.filter(r => r.key.startsWith(tier));
  const avgPosition = tierResults.reduce((s, r) => s + r.position, 0)
    / tierResults.length;
  console.log(`${tier}: avg completion position = ${avgPosition.toFixed(1)}`);
}
```

For the full runnable version, see [`examples/priority-request-routing.ts`](../examples/priority-request-routing.ts).

## What to Observe

Expected console output (abbreviated):

```
[1] premium-1:347ms
[2] premium-2:289ms
[3] premium-3:412ms
[4] premium-4:231ms
[5] premium-5:356ms
[6] standard-1:278ms
[7] standard-2:445ms
...
[16] standard-10:312ms
[17] free-1:267ms
[18] free-2:398ms
...
[30] free-14:344ms

premium:  avg completion position = 3.0
standard: avg completion position = 11.0
free:     avg completion position = 23.5
```

Key observations:

| Phase | What happens |
|-------|-------------|
| **Initial burst** | All 30 requests enqueued simultaneously. 4 slots are available. The first 4 tasks to start are all premium (priority 100). |
| **Premium drain** | As slots free up, remaining premium requests are served next. All 5 premium requests complete first. |
| **Standard phase** | With premium exhausted, standard requests (priority 50) are highest. They are served in roughly FIFO order among themselves. |
| **Free phase with aging** | Free requests have been waiting since the initial burst. By now their effective priority (10 + aging boost) may exceed fresh standard requests if any were to arrive. With no more arrivals, they drain in FIFO order. |
| **No starvation** | All 30 requests complete. Free-tier average position is higher (worse) than premium, but no request times out. |

The exact positions depend on simulated LLM call durations (seeded RNG), but the ordering invariant — premium before standard before free — holds consistently.

## How Aging Prevents Starvation

The critical scenario is **sustained load** where premium and standard requests keep arriving. Without aging, free requests would starve. With aging:

```
t=0s:   free-1 enqueued, effective priority = 10
t=2s:   free-1 effective priority = 10 + (0.005 × 2000) = 20
t=6s:   free-1 effective priority = 10 + (0.005 × 6000) = 40
t=8s:   free-1 effective priority = 10 + (0.005 × 8000) = 50  ← ties with fresh standard
t=9s:   free-1 effective priority = 10 + min(0.005 × 9000, 45) = 55  ← beats fresh standard
```

After 9 seconds, `free-1` overtakes any newly-arriving standard request. The FIFO tiebreaker ensures that among free requests with the same effective priority, the oldest is served first.

The `maxAgeBoost: 45` cap means a free request's effective priority never exceeds 55. A fresh premium request at 100 always wins. This preserves the tier hierarchy while bounding worst-case wait time.

## Variations

### Continuous arrival (long-running broker)

The example uses a closed burst for clarity. In a real broker, requests arrive continuously. Replace `closeSource()` with a long-running producer:

```typescript
const source = new PrioritySourceObj<ScheduledTask<string, string>>({
  agingRate: 0.005,
  maxAgeBoost: 45,
});

// Producer: enqueue requests as they arrive from the API gateway
apiGateway.on('request', (req) => {
  source.enqueue(
    {
      key: req.id,
      cost: { slots: 1 },
      runner: () => llmService.complete(req.prompt),
    },
    TIER_PRIORITY[req.tier],
  );
});

// Consumer: run indefinitely
const runner = new ScheduledTaskPoolRunner('broker', source, capacity);
for await (const envelope of runner.runTasks(false)) {
  if (envelope.type === 'FINAL') sendResponse(envelope);
  if (envelope.type === 'ERROR') sendError(envelope);
}
```

The `PrioritySourceObj` stays open (no `closeSource()` call), so the runner blocks on its `WaitObject` when the queue is empty and wakes when new requests are enqueued.

### Per-tier reserved capacity

Combine with the reserve/release pattern from [Adaptive Capacity](./adaptive-capacity.md) to guarantee minimum slots per tier:

```typescript
// Total: 8 slots
const capacity = new ResourceCapacitySource({ slots: 8 });

// Reserve 2 slots exclusively for premium
// (Premium tasks use a separate capacity source)
const premiumCapacity = new ResourceCapacitySource({ slots: 2 });
const sharedCapacity = new ResourceCapacitySource({ slots: 6 });

// Route premium to premiumCapacity, others to sharedCapacity
// Use two runners or a PushDistributeObj to split by tier
```

This ensures premium users always have 2 slots available, even during load spikes.

### Variable cost per tier

Premium requests might use larger models (more tokens, more compute). Reflect this in the task cost:

```typescript
const TIER_COST: Record<Tier, ResourceCost> = {
  premium: { slots: 2, tokens: 8000 },  // larger model, more tokens
  standard: { slots: 1, tokens: 4000 },
  free: { slots: 1, tokens: 2000 },     // smaller model, fewer tokens
};

const capacity = new ResourceCapacitySource({
  slots: 8,
  tokens: 32000,  // total token budget
});
```

The runner's peek-check-acquire protocol handles multi-resource costs atomically.

### Load shedding for free tier

Under extreme load, drop free-tier requests that have waited too long:

```typescript
// Before enqueuing, check queue depth
if (tier === 'free' && source.size > 50) {
  sendResponse(req, { status: 503, message: 'Service busy, try again later' });
  return;
}
```

Or use a timeout wrapper in the runner function:

```typescript
runner: async () => {
  const result = await Promise.race([
    llmService.complete(req.prompt),
    sleep(30_000).then(() => { throw new Error('timeout'); }),
  ]);
  return result;
},
```

### Tiered aging rates

Instead of a uniform aging rate, use per-tier aging rates by enqueuing at different base priorities and relying on the global aging rate, or by adjusting the base priority to encode the aging trajectory:

```typescript
// Encode desired service level into base priority:
// Premium: 100 (served first, aging irrelevant)
// Standard: 50 (moderate aging boost needed to overtake premium)
// Free: 10 (needs significant aging to reach standard levels)
//
// With agingRate=0.005 and maxAgeBoost=45:
//   Premium effective range: [100, 145]
//   Standard effective range: [50, 95]
//   Free effective range: [10, 55]
//
// Ranges overlap only at the edges, preserving tier hierarchy.
```

## See Also

- [Conceptual Guide -- Scheduling](../concepts.md#6-scheduling-dependency-graphs-priority-and-resource-management) -- Design philosophy and how the scheduling primitives fit together
- [Flow Control -- Capacity-Gated Scheduling](../flow-control.md#7-capacity-gated-scheduling) -- Theory of peek-check-acquire lifecycle and multi-resource scheduling
- [Scheduling Reference](../reference/scheduling.md) -- Complete API for `PrioritySourceObj`, `ResourceCapacitySource`, `ScheduledTaskPoolRunner`, `ScheduledTask`, and `TaskProgressEnvelope`
- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- `SourceObj`, `Peekable`, and the pull model that scheduling sources implement
- [Use Case 4: Multi-Resource Scheduling](./multi-resource-scheduling.md) -- Static multi-resource budgets (complements the priority approach here)
- [Use Case 5: Adaptive Capacity](./adaptive-capacity.md) -- Dynamic concurrency scaling (can be combined with priority routing)
