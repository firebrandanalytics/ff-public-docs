/**
 * Adaptive Capacity Example
 *
 * Demonstrates dynamic concurrency scaling using the reserve/release pattern.
 * A control loop monitors the backlog and adjusts effective concurrency by
 * reserving or releasing slots in a ResourceCapacitySource.
 *
 * Run: npx tsx adaptive-capacity.ts
 *
 * See: ../use-cases/adaptive-capacity.md
 */

import {
  SourceObj,
  ResourceCapacitySource,
  ScheduledTaskPoolRunner,
  type Peekable,
  type ScheduledTask,
} from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Simple seeded PRNG (linear congruential generator).
 * Produces deterministic output so the example is reproducible.
 */
const makeRng = (seed: number) => {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 0x100000000;
  };
};

// ---------------------------------------------------------------------------
// QueueSource — a peek-able source with a .pending backlog counter
// ---------------------------------------------------------------------------

class QueueSource
  extends SourceObj<ScheduledTask<string, string>>
  implements Peekable<ScheduledTask<string, string>>
{
  private idx = 0;

  constructor(
    private readonly tasks: Array<ScheduledTask<string, string>>,
  ) {
    super();
  }

  /** Number of tasks not yet consumed by the runner. */
  get pending(): number {
    return this.tasks.length - this.idx;
  }

  /** Look at the next task without consuming it. */
  peek(): ScheduledTask<string, string> | undefined {
    return this.tasks[this.idx];
  }

  /** Yield tasks one at a time. */
  protected override async *pull_impl(): AsyncGenerator<
    ScheduledTask<string, string>
  > {
    for (const task of this.tasks) {
      this.idx++;
      yield task;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // --- Generate 24 jobs with variable durations (80-300 ms) ---

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

  // --- Set up capacity with reserve/release pattern ---

  const totalSlots = 6;
  const capacity = new ResourceCapacitySource({ slots: totalSlots });

  // Start conservative: reserve 3 of 6 slots -> effective concurrency = 3
  let reserved = 3;
  capacity.acquireImmediate({ slots: reserved });

  const source = new QueueSource(tasks);
  const runner = new ScheduledTaskPoolRunner<string, string>(
    'adaptive',
    source,
    capacity,
  );

  // --- Shared state between runner loop and control loop ---

  let completed = 0;
  let runnerDone = false;

  // --- Runner loop: consume task envelopes ---

  const runLoop = (async () => {
    for await (const e of runner.runTasks(false)) {
      if (e.type === 'FINAL') {
        completed++;
      }
    }
    runnerDone = true;
  })();

  // --- Control loop: monitor backlog and adjust concurrency ---

  const controlLoop = (async () => {
    while (!runnerDone) {
      const backlog = source.pending;

      if (backlog > 10 && reserved > 0) {
        // Backlog is high -- release a reserved slot to increase concurrency.
        capacity.release({ slots: 1 });
        reserved--;
        console.log(
          `[ctrl] scale-up -> effective=${totalSlots - reserved}`,
        );
      } else if (
        backlog < 4 &&
        reserved < 4 &&
        capacity.canAcquire({ slots: 1 })
      ) {
        // Backlog is low -- reserve a slot to decrease concurrency.
        // The canAcquire check ensures we only reserve a slot that is
        // actually free (not in use by a running task).
        capacity.acquireImmediate({ slots: 1 });
        reserved++;
        console.log(
          `[ctrl] scale-down -> effective=${totalSlots - reserved}`,
        );
      }

      console.log(
        `[ctrl] backlog=${backlog} completed=${completed} ` +
          `effective=${totalSlots - reserved}`,
      );

      await sleep(200);
    }
  })();

  // --- Wait for both loops to finish ---

  await Promise.all([runLoop, controlLoop]);

  console.log(
    `[done] completed=${completed} ` +
      `finalAvailable=${JSON.stringify(capacity.available)}`,
  );
}

main().catch(console.error);
