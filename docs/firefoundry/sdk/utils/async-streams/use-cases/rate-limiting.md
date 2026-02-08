# Use Case 6: Rate-Limiting and Usage Quotas

Model external API rate limits, daily usage caps, or token budgets so that a job processing pipeline automatically blocks when the quota is exhausted and resumes when it resets.

## The Problem

A pipeline sends requests to an external API that enforces a rate limit: 100 requests per minute. Exceeding the limit returns HTTP 429 errors and can trigger account suspension.

With a regular `ResourceCapacitySource`, completing a request calls `release()` and immediately frees the slot. That models a resource pool (like GPU memory), not a rate limit. If you have 100 slots and tasks complete in under a minute, you can churn through far more than 100 requests per minute.

What you need is a capacity source where:

1. **Acquiring** a unit consumes it permanently for the current window.
2. **Releasing** (on task completion) does **not** restore capacity.
3. A **periodic timer** refills the quota at the start of each window.

## The Strategy

**Quota-gated scheduling with periodic reset.**

`QuotaCapacitySource` extends `ResourceCapacitySource` with one key override: `release()` is a no-op. The `ScheduledTaskPoolRunner` still calls `release(cost)` when a task completes, but in quota mode that does nothing. Capacity only comes back when the timer fires `reset()`.

The runner's internal loop works exactly as before:

1. Peek at the next task's cost.
2. Call `canAcquire(cost)` — if quota is exhausted, block on `waitObj`.
3. When the timer fires `reset()`, it signals `waitObj`, unblocking the runner.
4. Acquire and start the task.

No code changes are needed in the runner or the task definitions — the only difference is the capacity source type.

## Architecture

```
TaskSource (100+ queued requests)
  |
  |  peek() -> { key:'req-1', cost:{ requests: 1 } }
  |  canAcquire({ requests: 1 }) -> true (until quota exhausted)
  v
ScheduledTaskPoolRunner('api-client')
  |
  +-- capacity: QuotaCapacitySource { requests: 100 }
  |       |
  |       +---- Timer: reset() every 60,000 ms
  |       |
  |       |  acquire: requests--
  |       |  release: no-op (consumed)
  |       |  reset: requests = 100 (timer tick)
  |       |
  v
for await (envelope of runner.runTasks(false))
  -> FINAL { taskId, value: 'req-1:200' }
  -> FINAL { taskId, value: 'req-2:200' }
  -> ...
  -> (blocks when quota exhausted)
  -> (resumes after timer reset)
```

## Implementation

### Task source

The same `SourceObj + Peekable` pattern used in other scheduling use cases:

```typescript
class RequestSource extends SourceObj<ScheduledTask<string, string>>
  implements Peekable<ScheduledTask<string, string>> {

  private idx = 0;

  constructor(
    private readonly tasks: Array<ScheduledTask<string, string>>
  ) { super(); }

  get pending(): number {
    return this.tasks.length - this.idx;
  }

  peek(): ScheduledTask<string, string> | undefined {
    return this.tasks[this.idx];
  }

  protected override async* pull_impl():
    AsyncGenerator<ScheduledTask<string, string>> {
    for (const task of this.tasks) {
      this.idx++;
      yield task;
    }
  }
}
```

### Task definitions

Each API request costs 1 quota unit:

```typescript
const tasks: Array<ScheduledTask<string, string>> = Array.from(
  { length: 250 },
  (_, i) => ({
    key: `req-${i + 1}`,
    cost: { requests: 1 },
    runner: async () => {
      // Simulate API call (30-100ms latency)
      await sleep(30 + Math.floor(Math.random() * 70));
      return `req-${i + 1}:200`;
    },
  }),
);
```

### Wiring with QuotaCapacitySource

```typescript
import { QuotaCapacitySource, ScheduledTaskPoolRunner } from '@firebrandanalytics/shared-utils';

const source   = new RequestSource(tasks);
const quota    = new QuotaCapacitySource({ requests: 100 });
const runner   = new ScheduledTaskPoolRunner<string, string>(
  'api-client', source, quota,
);

// Reset quota every 60 seconds (mimics the API's rate limit window)
quota.startPeriodicReset(60_000);

let completed = 0;
for await (const e of runner.runTasks(false)) {
  if (e.type === 'FINAL') {
    completed++;
    console.log(`[${completed}] ${e.value}  remaining=${quota.available.requests}`);
  }
}

quota.stopTimer();
console.log(`done: ${completed} requests completed`);
```

For the full runnable version (including token-bucket and multi-resource quota demos), see [`examples/rate-limiting.ts`](../examples/rate-limiting.ts).

## What to Observe

With 250 tasks, 100 quota per minute, and tasks completing in ~65ms average:

```
[1] req-1:200  remaining=99
[2] req-2:200  remaining=98
...
[100] req-100:200  remaining=0
  (runner blocks — quota exhausted)
  (timer fires after ~60s — quota reset to 100)
[101] req-101:200  remaining=99
...
[200] req-200:200  remaining=0
  (runner blocks again)
  (timer fires)
[201] req-201:200  remaining=99
...
[250] req-250:200  remaining=50
done: 250 requests completed
```

Key observations:

| Phase | What happens |
|-------|-------------|
| **First window** | 100 requests fire quickly (tasks complete in ~65ms each). Quota hits 0. |
| **Blocked** | Runner's fill loop calls `canAcquire({ requests: 1 })` → false. It awaits `waitObj`. Release on task completion is a no-op — no capacity freed. |
| **Timer reset** | Timer fires `reset()`. Available jumps to 100. `waitObj` is signaled. Runner wakes and starts the next batch. |
| **Final window** | Only 50 of the 100 quota are needed. 50 remain unused. |

## Variations

### Token bucket (gradual refill)

Instead of a hard reset, add tokens gradually. This smooths out burst behavior:

```typescript
const bucket = new QuotaCapacitySource({ tokens: 100 });
// Add 2 tokens every second (120/min), capped at 100
bucket.startPeriodicIncrement(1000, { tokens: 2 });
```

With this pattern, a consumer that uses tokens steadily sees a smooth flow. A burst that exhausts all 100 tokens must wait for gradual refill rather than a single window reset.

### Multi-resource quotas

Track multiple quota dimensions independently:

```typescript
const quota = new QuotaCapacitySource({
  requests: 100,       // 100 requests per minute
  bandwidth_mb: 500,   // 500 MB per minute
});

quota.startPeriodicReset(60_000);

// Large file upload costs more bandwidth
const uploadTask: ScheduledTask<string, string> = {
  key: 'upload-large',
  cost: { requests: 1, bandwidth_mb: 50 },
  runner: async () => { /* ... */ return 'uploaded'; },
};
```

The runner blocks whenever *any* resource in the cost is unavailable. 10 large uploads (10 requests, 500 MB) would exhaust bandwidth before request count.

### External reset (daily quota)

For quotas controlled by external events (daily cap, billing cycle), skip the timer and call `reset()` directly:

```typescript
const dailyQuota = new QuotaCapacitySource({ api_calls: 1000 });
// No timer — external system calls this at midnight
// dailyQuota.reset();
```

### Combined with concurrency limits

Layer a quota on top of a concurrency pool. Use the quota as a parent:

```typescript
// Rate limit: 100 requests/minute
const quota = new QuotaCapacitySource({ requests: 100 });
quota.startPeriodicReset(60_000);

// Concurrency: max 5 in-flight (resource pool — releases restore capacity)
const pool = new ResourceCapacitySource({ requests: 5 }, quota);

// The pool's release() restores concurrency slots.
// The quota's release() is a no-op (consumed permanently).
// Both checks must pass: concurrent count <= 5 AND total this window <= 100.
```

This enforces both limits simultaneously: at most 5 concurrent requests, and at most 100 total per minute.

## See Also

- [Conceptual Guide -- Scheduling](../concepts.md#6-scheduling-dependency-graphs-priority-and-resource-management) -- Design philosophy and how the scheduling primitives fit together
- [Scheduling Reference](../reference/scheduling.md) -- Complete API for `QuotaCapacitySource`, `ResourceCapacitySource`, `ScheduledTaskPoolRunner`, and related types
- [Flow Control -- Quota and Rate-Limiting](../flow-control.md#quota-and-rate-limiting-patterns-quotacapacitysource) -- Theory behind quota-based flow control
- [Use Case 4: Multi-Resource Scheduling](./multi-resource-scheduling.md) -- Resource pool patterns (complements the quota pattern)
- [Use Case 5: Adaptive Capacity](./adaptive-capacity.md) -- Dynamic scaling of resource pools
