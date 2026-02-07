/**
 * Priority Request Routing (QoS) Example
 *
 * Demonstrates tiered user priority with aging-based starvation prevention.
 * Premium users get served first, but free-tier users are guaranteed service
 * within a bounded wait time thanks to PrioritySourceObj's aging mechanism.
 *
 * Run: npx tsx priority-request-routing.ts
 *
 * See: ../use-cases/priority-request-routing.md
 */

import {
  PrioritySourceObj,
  ResourceCapacitySource,
  ScheduledTaskPoolRunner,
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
// Tier configuration
// ---------------------------------------------------------------------------

type Tier = 'premium' | 'standard' | 'free';

const TIER_PRIORITY: Record<Tier, number> = {
  premium: 100,
  standard: 50,
  free: 10,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // --- Request definitions ---
  // 30 total requests arriving simultaneously: 5 premium, 10 standard, 15 free

  const requests: Array<{ tier: Tier; id: number }> = [
    ...Array.from({ length: 5 }, (_, i) => ({
      tier: 'premium' as Tier,
      id: i + 1,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      tier: 'standard' as Tier,
      id: i + 1,
    })),
    ...Array.from({ length: 15 }, (_, i) => ({
      tier: 'free' as Tier,
      id: i + 1,
    })),
  ];

  // --- Priority source with aging ---
  // agingRate: 0.005 = +5 effective priority per second of wait time
  // maxAgeBoost: 45 = free-tier caps at 10 + 45 = 55 effective priority
  //   (beats fresh standard at 50, never reaches premium at 100)

  const source = new PrioritySourceObj<ScheduledTask<string, string>>({
    agingRate: 0.005,
    maxAgeBoost: 45,
  });

  // --- Enqueue all requests as a burst ---

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

  // No more requests will arrive in this example
  source.closeSource();

  // --- Capacity: 4 concurrent LLM inference slots ---

  const capacity = new ResourceCapacitySource({ slots: 4 });

  // --- Runner ---

  const runner = new ScheduledTaskPoolRunner<string, string>(
    'broker',
    source,
    capacity,
  );

  // --- Consume results and track completion order ---

  const results: Array<{ key: string; tier: Tier; position: number }> = [];
  let position = 0;

  console.log('--- Request completion order ---\n');

  for await (const envelope of runner.runTasks(false)) {
    if (envelope.type === 'FINAL') {
      position++;
      const value = String(envelope.value);
      const key = value.split(':')[0];
      const tier = key.split('-')[0] as Tier;
      results.push({ key, tier, position });
      console.log(`  [${String(position).padStart(2)}] ${value}`);
    } else if (envelope.type === 'ERROR') {
      console.error(`  [ERR] ${envelope.error}`);
    }
  }

  // --- Summary statistics ---

  console.log('\n--- Summary by tier ---\n');

  for (const tier of ['premium', 'standard', 'free'] as Tier[]) {
    const tierResults = results.filter((r) => r.tier === tier);
    const positions = tierResults.map((r) => r.position);
    const avgPosition =
      positions.reduce((sum, p) => sum + p, 0) / positions.length;
    const minPos = Math.min(...positions);
    const maxPos = Math.max(...positions);

    console.log(
      `  ${tier.padEnd(8)} ` +
        `count=${String(tierResults.length).padStart(2)}  ` +
        `avg_position=${avgPosition.toFixed(1).padStart(4)}  ` +
        `range=[${minPos}, ${maxPos}]`,
    );
  }

  console.log(
    `\n--- All ${results.length} requests served (no starvation) ---`,
  );
}

main().catch(console.error);
