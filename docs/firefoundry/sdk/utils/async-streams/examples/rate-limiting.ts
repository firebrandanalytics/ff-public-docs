/**
 * Rate-Limiting and Usage Quotas Example
 *
 * Demonstrates QuotaCapacitySource for rate-limiting patterns where consumed
 * capacity is NOT restored on task completion. Capacity is only replenished
 * by a periodic timer.
 *
 * The example models an API rate limit of 10 requests per "window" (2 seconds
 * in this demo), processing 35 total requests. It shows:
 *
 * 1. First window:  10 requests fire quickly, then the runner blocks.
 * 2. Timer reset:   Quota resets, next 10 requests fire.
 * 3. Second reset:  Another 10 fire.
 * 4. Final window:  Only 5 needed, quota partially used.
 *
 * Also demonstrates a token-bucket variant where capacity refills gradually
 * instead of resetting all at once.
 *
 * Run: npx tsx rate-limiting.ts
 *
 * See: ../use-cases/rate-limiting.md
 */

import {
  SourceObj,
  QuotaCapacitySource,
  ScheduledTaskPoolRunner,
  type Peekable,
  type ScheduledTask,
} from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// RequestSource — a peek-able source with a .pending counter
// ---------------------------------------------------------------------------

class RequestSource
  extends SourceObj<ScheduledTask<string, string>>
  implements Peekable<ScheduledTask<string, string>>
{
  private idx = 0;

  constructor(
    private readonly tasks: Array<ScheduledTask<string, string>>,
  ) {
    super();
  }

  get pending(): number {
    return this.tasks.length - this.idx;
  }

  peek(): ScheduledTask<string, string> | undefined {
    return this.tasks[this.idx];
  }

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
// Demo 1: Periodic Reset (API Rate Limit)
// ---------------------------------------------------------------------------

async function demoPeriodicReset(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Demo 1: API Rate Limit (periodic reset)');
  console.log('  10 requests per 2-second window, 35 total requests');
  console.log('='.repeat(60));
  console.log();

  // --- Generate 35 API requests (each completes in ~20ms) ---

  const tasks: Array<ScheduledTask<string, string>> = Array.from(
    { length: 35 },
    (_, i) => ({
      key: `req-${i + 1}`,
      cost: { requests: 1 },
      runner: async () => {
        await sleep(15 + Math.floor(Math.random() * 10));
        return `req-${i + 1}:200`;
      },
    }),
  );

  // --- Set up quota: 10 requests per window ---

  const quota = new QuotaCapacitySource({ requests: 10 });
  const source = new RequestSource(tasks);
  const runner = new ScheduledTaskPoolRunner<string, string>(
    'api-rate-limit',
    source,
    quota,
  );

  // Reset quota every 2 seconds (short interval for demo purposes)
  quota.startPeriodicReset(2000);

  // --- Process all requests ---

  let completed = 0;
  let windowNum = 1;
  let windowStart = Date.now();

  for await (const e of runner.runTasks(false)) {
    if (e.type === 'FINAL') {
      completed++;

      // Detect window boundary (when quota was just reset)
      const elapsed = Date.now() - windowStart;
      if (elapsed > 1900) {
        windowNum++;
        windowStart = Date.now();
        console.log(`\n  --- Window ${windowNum} (quota reset) ---\n`);
      }

      const remaining = (quota.available as { requests: number }).requests;
      console.log(
        `  [${String(completed).padStart(2)}] ${e.value}  ` +
          `remaining=${remaining}  pending=${source.pending}`,
      );
    }
    if (e.type === 'ERROR') {
      console.error(`  [ERROR] ${e.taskId}: ${e.error}`);
    }
  }

  quota.stopTimer();

  console.log();
  console.log(
    `  done: ${completed} requests across ${windowNum} windows`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Demo 2: Token Bucket (Gradual Refill)
// ---------------------------------------------------------------------------

async function demoTokenBucket(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Demo 2: Token Bucket (gradual refill)');
  console.log('  Max 8 tokens, refill 2 every 500ms, 20 total requests');
  console.log('='.repeat(60));
  console.log();

  const tasks: Array<ScheduledTask<string, string>> = Array.from(
    { length: 20 },
    (_, i) => ({
      key: `tok-${i + 1}`,
      cost: { tokens: 1 },
      runner: async () => {
        await sleep(10 + Math.floor(Math.random() * 20));
        return `tok-${i + 1}:ok`;
      },
    }),
  );

  const bucket = new QuotaCapacitySource({ tokens: 8 });
  const source = new RequestSource(tasks);
  const runner = new ScheduledTaskPoolRunner<string, string>(
    'token-bucket',
    source,
    bucket,
  );

  // Refill 2 tokens every 500ms (max 8)
  bucket.startPeriodicIncrement(500, { tokens: 2 });

  let completed = 0;
  const start = Date.now();

  for await (const e of runner.runTasks(false)) {
    if (e.type === 'FINAL') {
      completed++;
      const elapsed = Date.now() - start;
      const remaining = (bucket.available as { tokens: number }).tokens;
      console.log(
        `  [${String(completed).padStart(2)}] ${e.value}  ` +
          `tokens=${remaining}  +${elapsed}ms`,
      );
    }
  }

  bucket.stopTimer();

  const totalTime = Date.now() - start;
  console.log();
  console.log(
    `  done: ${completed} requests in ${totalTime}ms ` +
      `(bucket refill paced the throughput)`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Demo 3: Multi-Resource Quota
// ---------------------------------------------------------------------------

async function demoMultiResourceQuota(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Demo 3: Multi-Resource Quota');
  console.log('  100 requests + 500 MB bandwidth per window');
  console.log('  Mix of small (1 MB) and large (100 MB) requests');
  console.log('='.repeat(60));
  console.log();

  // Mix of small and large requests
  const tasks: Array<ScheduledTask<string, string>> = [];
  for (let i = 0; i < 15; i++) {
    const isLarge = i % 4 === 0; // every 4th request is a large upload
    tasks.push({
      key: `${isLarge ? 'upload' : 'api'}-${i + 1}`,
      cost: {
        requests: 1,
        bandwidth_mb: isLarge ? 100 : 1,
      },
      runner: async () => {
        await sleep(isLarge ? 50 : 15);
        return `${isLarge ? 'upload' : 'api'}-${i + 1}:ok`;
      },
    });
  }

  const quota = new QuotaCapacitySource({
    requests: 100,
    bandwidth_mb: 500,
  });
  const source = new RequestSource(tasks);
  const runner = new ScheduledTaskPoolRunner<string, string>(
    'multi-quota',
    source,
    quota,
  );

  // Reset every 3 seconds
  quota.startPeriodicReset(3000);

  let completed = 0;
  for await (const e of runner.runTasks(false)) {
    if (e.type === 'FINAL') {
      completed++;
      const avail = quota.available as {
        requests: number;
        bandwidth_mb: number;
      };
      console.log(
        `  [${String(completed).padStart(2)}] ${String(e.value).padEnd(16)} ` +
          `requests=${avail.requests}  bandwidth=${avail.bandwidth_mb}MB`,
      );
    }
  }

  quota.stopTimer();
  console.log();
  console.log(`  done: ${completed} requests (bandwidth was the bottleneck)`);
  console.log();
}

// ---------------------------------------------------------------------------
// Run all demos
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await demoPeriodicReset();
  await demoTokenBucket();
  await demoMultiResourceQuota();
}

main().catch(console.error);
