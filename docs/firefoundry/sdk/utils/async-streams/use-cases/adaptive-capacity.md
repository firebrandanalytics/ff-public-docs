# Use Case 5: Adaptive Capacity

Dynamically scale effective concurrency up or down based on observed backlog, so a job processing system handles both 24-job surges and 3-job lulls without wasting resources or building backlogs.

## The Problem

A job processing system consumes work items from a queue. The arrival rate varies: during peak hours there may be 24 queued jobs; during quiet periods, only 3. A fixed concurrency limit forces you to choose between two bad options:

- **Set it high (e.g., 6).** During low load, all 3 jobs run immediately, but 6 database connections, 6 thread pool slots, and 6 chunks of memory are reserved even though only 3 are needed. The idle resources are unavailable to other services.
- **Set it low (e.g., 2).** During high load, 22 jobs sit in the queue while only 2 run. Latency spikes. Users complain.

What you want is a concurrency limit that reacts to the observed backlog: scale up when work is piling up, scale down when the queue is nearly empty.

The challenge is implementing this without oscillation. A naive approach that checks "if backlog > 5, add a slot; if backlog < 5, remove a slot" will flap between scaling up and scaling down on every control loop tick, destabilizing throughput. You need **hysteresis**: different thresholds for scaling up and scaling down, with a dead zone in between where the system holds steady.

## The Strategy

**Capacity-gated scheduling with dynamic scaling via reserve/release pattern.**

The trick is to create a `ResourceCapacitySource` with the maximum possible capacity (e.g., 6 slots), then pre-acquire some of those slots as "reserved." The scheduler only sees the unreserved slots, so effective concurrency starts low. A concurrent control loop monitors the backlog and adjusts the reservation:

- **Scale up:** Release a reserved slot back to the capacity pool. The scheduler can now run one more concurrent task.
- **Scale down:** Acquire a slot from the capacity pool into the reserve. The scheduler loses one concurrency slot.

This works because `ResourceCapacitySource` supports both `acquireImmediate()` (to reserve a slot) and `release()` (to unreserve a slot), and both operations signal the scheduler's internal wait loop via the `waitObj`. The control loop and the scheduler can run concurrently because JavaScript is single-threaded -- `acquireImmediate` and `release` are synchronous calls that complete within a single event loop tick.

## Architecture

```
QueueSource (24 jobs)
  |
  |  .pending -> 24 (backlog metric)
  |  peek() / next()
  v
ScheduledTaskPoolRunner('adaptive')
  |
  +-- capacity: ResourceCapacitySource { slots: 6 }
  |       |
  |       |  effective = total - reserved
  |       |  starts at: 6 - 3 = 3
  |       |
  |       +<---- Control Loop (runs concurrently)
  |               |
  |               |  every 200ms:
  |               |    backlog > 10 && reserved > 0
  |               |      -> release(1) -> effective++
  |               |    backlog < 4 && reserved < 4
  |               |      -> acquireImmediate(1) -> effective--
  |               |
  v
for await (envelope of runner.runTasks(false))
  -> FINAL { taskId, value: 'job-1:ok' }
  -> FINAL { taskId, value: 'job-2:ok' }
  -> ...
```

The control loop and the runner share the same `ResourceCapacitySource`. When the control loop calls `release()`, the capacity source signals its internal `waitObj`, which wakes the runner's fill loop to start more tasks. When the control loop calls `acquireImmediate()`, no signal is needed -- the runner simply finds fewer available slots on its next scheduling cycle.

## The Reserve/Release Pattern

The pattern works in four steps:

**Step 1: Create capacity with the total maximum.**

```typescript
const totalSlots = 6;
const capacity = new ResourceCapacitySource({ slots: totalSlots });
```

At this point, `capacity.available` is `{ slots: 6 }`. The scheduler could run 6 tasks concurrently.

**Step 2: Pre-acquire some slots as "reserved."**

```typescript
let reserved = 3;
capacity.acquireImmediate({ slots: reserved });
// capacity.available is now { slots: 3 }
// effective concurrency = totalSlots - reserved = 3
```

The scheduler sees only 3 available slots, so it starts at most 3 concurrent tasks.

**Step 3: Monitor backlog and adjust.**

```typescript
// Scale up: release a reserved slot
if (backlog > 10 && reserved > 0) {
  capacity.release({ slots: 1 });
  reserved--;
  // effective concurrency increases by 1
}

// Scale down: reserve an additional slot
if (backlog < 4 && reserved < 4 && capacity.canAcquire({ slots: 1 })) {
  capacity.acquireImmediate({ slots: 1 });
  reserved++;
  // effective concurrency decreases by 1
}
```

Note the asymmetric thresholds: scale up when backlog exceeds 10, scale down when it drops below 4. The gap between 4 and 10 is the hysteresis band where no scaling action is taken.

Also note the `canAcquire` check before `acquireImmediate` in the scale-down branch. If all slots are currently in use by running tasks, there are no free slots to reserve. The `canAcquire` check prevents acquiring a slot that does not exist.

**Step 4: Include bounds.**

The `reserved < 4` guard prevents scaling down below 2 effective slots (6 - 4 = 2). Similarly, `reserved > 0` prevents scaling up beyond the total capacity.

## Implementation

The full implementation has three parts: the queue source, the runner loop, and the control loop.

### Queue source

The source exposes a `pending` property so the control loop can read the backlog without consuming tasks:

```typescript
class QueueSource extends SourceObj<ScheduledTask<string, string>>
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

### Task generation

Each of the 24 jobs costs 1 slot and runs for a variable duration between 80 and 300 ms. A seeded random number generator ensures reproducible output:

```typescript
const rng = makeRng(11);
const tasks: Array<ScheduledTask<string, string>> = Array.from(
  { length: 24 },
  (_, i) => ({
    key: `job-${i + 1}`,
    cost: { slots: 1 },
    runner: async () => {
      await sleep(80 + Math.floor(rng() * 220));
      return `job-${i + 1}:ok`;
    },
  }),
);
```

### Runner and control loop

The runner and the control loop are launched as concurrent promises with `Promise.all`:

```typescript
const runLoop = (async () => {
  for await (const e of runner.runTasks(false)) {
    if (e.type === 'FINAL') completed++;
  }
  runnerDone = true;
})();

const controlLoop = (async () => {
  while (!runnerDone) {
    const backlog = source.pending;
    if (backlog > 10 && reserved > 0) {
      capacity.release({ slots: 1 });
      reserved--;
      console.log(`[ctrl] scale-up -> effective=${totalSlots - reserved}`);
    } else if (backlog < 4 && reserved < 4
               && capacity.canAcquire({ slots: 1 })) {
      capacity.acquireImmediate({ slots: 1 });
      reserved++;
      console.log(`[ctrl] scale-down -> effective=${totalSlots - reserved}`);
    }
    console.log(
      `[ctrl] backlog=${backlog} completed=${completed} ` +
      `effective=${totalSlots - reserved}`
    );
    await sleep(200);
  }
})();

await Promise.all([runLoop, controlLoop]);
```

The control loop ticks every 200 ms. On each tick, it reads the source's `pending` count (the backlog), applies the scaling decision, and logs the current state.

For the full runnable version, see [`examples/adaptive-capacity.ts`](../examples/adaptive-capacity.ts).

## What to Observe

Expected console output (abbreviated):

```
[ctrl] backlog=24 completed=0 effective=3
[ctrl] scale-up -> effective=4
[ctrl] backlog=20 completed=1 effective=4
[ctrl] scale-up -> effective=5
[ctrl] backlog=14 completed=5 effective=5
[ctrl] scale-up -> effective=6
[ctrl] backlog=9 completed=9 effective=6
[ctrl] backlog=5 completed=13 effective=6
[ctrl] backlog=2 completed=18 effective=6
[ctrl] scale-down -> effective=5
[ctrl] backlog=0 completed=22 effective=5
[ctrl] scale-down -> effective=4
[done] completed=24 finalAvailable=6
```

Key observations:

| Phase | What happens |
|-------|-------------|
| **Startup (backlog=24)** | Effective concurrency is 3 (conservative). The control loop sees backlog > 10 and starts scaling up. |
| **Ramp-up** | Each control tick releases one reserved slot. Effective concurrency grows: 3 -> 4 -> 5 -> 6. |
| **Steady state** | Backlog is between 4 and 10. No scaling action is taken. The hysteresis band keeps things stable. |
| **Drain** | Backlog drops below 4. The control loop scales down by reserving slots. Effective concurrency shrinks. |
| **Final** | All 24 jobs complete. `finalAvailable` shows slots: 6 -- all capacity returned, accounting for both task releases and control-loop adjustments. |

The exact numbers depend on task durations (seeded RNG) and control loop timing, but the pattern -- ramp up, hold steady, ramp down -- is consistent across runs.

## Variations

### Cooldown timer

Add a cooldown to prevent scaling actions from firing on consecutive ticks:

```typescript
let lastScaleTime = 0;
const COOLDOWN_MS = 500;

if (backlog > 10 && reserved > 0 && Date.now() - lastScaleTime > COOLDOWN_MS) {
  capacity.release({ slots: 1 });
  reserved--;
  lastScaleTime = Date.now();
}
```

This is useful when the control loop ticks faster than 200 ms or when the task durations are very short.

### Multi-slot scaling

Scale by more than one slot at a time for faster response to large backlog changes:

```typescript
const scaleFactor = Math.min(
  Math.floor((backlog - 10) / 5),  // 1 extra slot per 5 excess items
  reserved,                         // never release more than what is reserved
);
if (scaleFactor > 0) {
  capacity.release({ slots: scaleFactor });
  reserved -= scaleFactor;
}
```

### External metrics

Replace the backlog check with external metrics (queue depth from a message broker, CPU utilization, latency percentile):

```typescript
const controlLoop = async () => {
  while (!runnerDone) {
    const queueDepth = await messageQueue.getApproximateCount();
    const cpuPercent = os.loadavg()[0] / os.cpus().length * 100;

    if (queueDepth > 100 && cpuPercent < 70 && reserved > 0) {
      capacity.release({ slots: 1 });
      reserved--;
    } else if (queueDepth < 10 && reserved < maxReserved) {
      capacity.acquireImmediate({ slots: 1 });
      reserved++;
    }

    await sleep(1000);
  }
};
```

### Multi-resource scaling

The reserve/release pattern works with any resource dimension:

```typescript
const capacity = new ResourceCapacitySource({
  slots: 6,
  memory_gb: 24,
});

// Reserve 3 slots and 12 GB
capacity.acquireImmediate({ slots: 3, memory_gb: 12 });

// Scale up: release 1 slot and 4 GB
capacity.release({ slots: 1, memory_gb: 4 });
```

This lets you independently scale concurrency and memory budget in response to different metrics.

## See Also

- [Conceptual Guide -- Scheduling](../concepts.md#6-scheduling-dependency-graphs-priority-and-resource-management) -- Design philosophy and how the scheduling primitives fit together
- [Scheduling Reference](../reference/scheduling.md) -- Complete API for `ResourceCapacitySource`, `ScheduledTaskPoolRunner`, `ScheduledTask`, and `TaskProgressEnvelope`
- [Pull Obj Classes Reference](../reference/pull-obj-classes.md) -- `SourceObj`, `Peekable`, and the pull model that scheduling sources implement
- [Scheduling Fundamentals Tutorial](../tutorials/scheduling-fundamentals.md) -- Step-by-step introduction to dependency graphs, priority, and resource management
- [Use Case 4: Multi-Resource Scheduling](./multi-resource-scheduling.md) -- Static multi-resource budgets (complements the dynamic approach shown here)
