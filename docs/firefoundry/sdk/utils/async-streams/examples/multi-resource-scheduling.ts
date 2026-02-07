/**
 * Multi-Resource Scheduling Example
 *
 * Demonstrates capacity-gated scheduling with multi-resource budgets.
 * Three media processing tasks have different GPU and CPU requirements.
 * The scheduler ensures tasks only start when their full resource cost
 * can be satisfied atomically.
 *
 * Run: npx tsx multi-resource-scheduling.ts
 *
 * See: ../use-cases/multi-resource-scheduling.md
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

// ---------------------------------------------------------------------------
// TaskSource — a peek-able pull source backed by an array of ScheduledTasks
// ---------------------------------------------------------------------------

class TaskSource
  extends SourceObj<ScheduledTask<string, string>>
  implements Peekable<ScheduledTask<string, string>>
{
  private idx = 0;

  constructor(
    private readonly tasks: Array<ScheduledTask<string, string>>,
  ) {
    super();
  }

  /** Look at the next task without consuming it. */
  peek(): ScheduledTask<string, string> | undefined {
    return this.tasks[this.idx];
  }

  /** Yield tasks one at a time. The runner calls next() to consume. */
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
  // --- Define three media processing tasks with heterogeneous costs ---

  const tasks: Array<ScheduledTask<string, string>> = [
    // encode: heavy GPU usage, moderate CPU
    {
      key: 'encode',
      cost: { gpu: 2, cpu: 1 },
      runner: async () => {
        await sleep(450);
        return 'encode:done';
      },
    },

    // features: streaming task that yields intermediate progress
    {
      key: 'features',
      cost: { gpu: 1, cpu: 2 },
      runner: async function* () {
        await sleep(120);
        yield 'features:25%';
        await sleep(120);
        yield 'features:75%';
        await sleep(120);
        return 'features:done';
      },
    },

    // thumbs: lightweight task
    {
      key: 'thumbs',
      cost: { gpu: 1, cpu: 1 },
      runner: async () => {
        await sleep(220);
        return 'thumbs:done';
      },
    },
  ];

  // --- Create the source, capacity manager, and runner ---

  const source = new TaskSource(tasks);

  // Total budget: 2 GPUs, 3 CPUs
  // encode alone uses all 2 GPUs, so features and thumbs must wait.
  // Once encode finishes, features (gpu:1) + thumbs (gpu:1) fit together.
  const capacity = new ResourceCapacitySource({ gpu: 2, cpu: 3 });

  const runner = new ScheduledTaskPoolRunner<string, string>(
    'demo',
    source,
    capacity,
  );

  // --- Consume progress envelopes ---

  for await (const e of runner.runTasks(false)) {
    if (e.type === 'INTERMEDIATE') {
      console.log(`[INTERMEDIATE] taskId=${e.taskId} value=${e.value}`);
    }
    if (e.type === 'FINAL') {
      console.log(`[FINAL] taskId=${e.taskId} value=${e.value}`);
    }
    if (e.type === 'ERROR') {
      console.log(`[ERROR] taskId=${e.taskId} error=${String(e.error)}`);
    }
    console.log(`  available=${JSON.stringify(capacity.available)}`);
  }

  console.log('done: all scheduled tasks finished');
}

main().catch(console.error);
