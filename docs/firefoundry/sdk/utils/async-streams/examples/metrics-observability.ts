/**
 * Metrics and Observability Example
 *
 * Demonstrates the two built-in metrics collectors:
 *
 * 1. DefaultChainMetricsCollector -- turnstiles for throughput measurement and
 *    inter-stage latency tracking across a PullChain pipeline.
 *
 * 2. DefaultCapacityMetricsCollector -- acquire/reject/release counting,
 *    per-resource utilization, and rolling-window rates on a
 *    ResourceCapacitySource.
 *
 * The example builds a 3-stage pipeline that uppercases and filters messages,
 * gates each batch behind a resource pool, and prints a combined metrics
 * snapshot at the end.
 *
 * Run: npx tsx metrics-observability.ts
 *
 * See: ../use-cases/metrics-observability.md
 */

import {
  SourceBufferObj,
  PullChain,
  ResourceCapacitySource,
  DefaultChainMetricsCollector,
  DefaultCapacityMetricsCollector,
  type RollingWindowStats,
} from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Format a RollingWindowStats object into a readable string. */
function fmtStats(s: RollingWindowStats): string {
  if (s.count === 0) return '(no observations)';
  return (
    `count=${s.count}  avg=${s.avg.toFixed(2)}ms  ` +
    `min=${s.min?.toFixed(2) ?? '-'}ms  max=${s.max?.toFixed(2) ?? '-'}ms`
  );
}

/** Right-pad a string to a given width. */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

// ---------------------------------------------------------------------------
// Demo 1: Chain Metrics -- Turnstile throughput and inter-stage latency
// ---------------------------------------------------------------------------

async function demoChainMetrics(): Promise<void> {
  console.log('='.repeat(64));
  console.log('Demo 1: Chain Metrics (turnstiles and inter-stage latency)');
  console.log('  50 messages through uppercase -> filter(even IDs) pipeline');
  console.log('='.repeat(64));
  console.log();

  type Message = { id: number; text: string };

  const collector = new DefaultChainMetricsCollector();

  const messages: Message[] = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    text: `message-${i}`,
  }));

  const source = new SourceBufferObj(messages, true);

  const results = await PullChain.from(source)
    // -- Turnstile: count items entering the pipeline --
    .turnstile('ingress', collector)
    .map((msg) => {
      // Simulate a transform with a tiny delay variation
      return { ...msg, text: msg.text.toUpperCase() };
    })
    // -- Turnstile: count items after transform --
    .turnstile('transformed', collector)
    .filter((msg) => msg.id % 2 === 0)
    // -- Turnstile: count items that survive the filter --
    .turnstile('egress', collector)
    .collect();

  console.log(`  Pipeline produced ${results.length} items (of 50 input).`);
  console.log();

  // --- Print chain snapshot ---

  const snap = collector.snapshot();

  console.log('  Turnstiles:');
  for (const [name, ts] of Object.entries(snap.turnstiles)) {
    const rate = ts.throughputPerSec;
    console.log(
      `    ${pad(name, 16)} ${String(ts.passed).padStart(4)} items   ` +
        `throughput ${rate.count}/window`,
    );
  }
  console.log();

  console.log('  Stage Latency:');
  if (Object.keys(snap.stageLatencyMs).length === 0) {
    console.log('    (no latency data -- pipeline was synchronous)');
  }
  for (const [pair, stats] of Object.entries(snap.stageLatencyMs)) {
    console.log(`    ${pad(pair, 28)} ${fmtStats(stats)}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Demo 2: Capacity Metrics -- tryAcquire / reject / release tracking
// ---------------------------------------------------------------------------

async function demoCapacityMetrics(): Promise<void> {
  console.log('='.repeat(64));
  console.log('Demo 2: Capacity Metrics (acquire/reject/release tracking)');
  console.log('  4-slot pool, 20 tasks, some rejected due to contention');
  console.log('='.repeat(64));
  console.log();

  const capacityCollector = new DefaultCapacityMetricsCollector();
  const pool = new ResourceCapacitySource(
    { slots: 4 },
    undefined,
    capacityCollector,
  );

  // Simulate 20 tasks, each acquiring 1 slot.
  // First, fill the pool to capacity, then attempt more (which will be rejected),
  // then release and re-acquire.

  let accepted = 0;
  let rejected = 0;

  // Phase 1: fill the pool (4 slots)
  for (let i = 0; i < 4; i++) {
    const r = pool.tryAcquire({ slots: 1 });
    if (r.ok) accepted++;
    else rejected++;
  }

  // Phase 2: try to acquire 3 more while pool is full -- these are rejected
  for (let i = 0; i < 3; i++) {
    const r = pool.tryAcquire({ slots: 1 });
    if (r.ok) accepted++;
    else rejected++;
  }

  console.log(
    `  After initial burst: ${accepted} accepted, ${rejected} rejected`,
  );

  // Phase 3: release 2 slots, then acquire 2 more
  pool.release({ slots: 1 });
  pool.release({ slots: 1 });

  for (let i = 0; i < 2; i++) {
    const r = pool.tryAcquire({ slots: 1 });
    if (r.ok) accepted++;
    else rejected++;
  }

  // Phase 4: release all remaining
  pool.release({ slots: 1 });
  pool.release({ slots: 1 });
  pool.release({ slots: 1 });
  pool.release({ slots: 1 });

  console.log(`  Final tally: ${accepted} accepted, ${rejected} rejected`);
  console.log();

  // --- Print capacity snapshot ---

  const snap = capacityCollector.snapshot();

  console.log('  Totals:');
  console.log(
    `    acquireAccepted  ${snap.totals.acquireAccepted}    ` +
      `acquireRejected  ${snap.totals.acquireRejected}    ` +
      `releases  ${snap.totals.release}`,
  );
  console.log();

  console.log('  In-Flight (acquired minus released):');
  for (const [res, count] of Object.entries(snap.inFlightByResource)) {
    console.log(`    ${pad(res, 12)} ${count}`);
  }
  console.log();

  console.log('  Utilization (0.0 = idle, 1.0 = saturated):');
  for (const [res, ratio] of Object.entries(snap.utilizationByResource)) {
    console.log(`    ${pad(res, 12)} ${ratio.toFixed(4)}`);
  }
  console.log();

  console.log('  Rejected Capacity by Resource:');
  for (const [res, amount] of Object.entries(
    snap.requestedRejectedByResource,
  )) {
    console.log(`    ${pad(res, 12)} ${amount} units`);
  }
  console.log();

  console.log('  Rolling Rates:');
  console.log(
    `    accepts/sec   ${fmtStats(snap.rates.acquireAcceptedPerSec)}`,
  );
  console.log(
    `    rejects/sec   ${fmtStats(snap.rates.acquireRejectedPerSec)}`,
  );
  console.log(
    `    releases/sec  ${fmtStats(snap.rates.releasePerSec)}`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Demo 3: Combined -- Resource-gated pipeline with both collectors
// ---------------------------------------------------------------------------

async function demoCombined(): Promise<void> {
  console.log('='.repeat(64));
  console.log('Demo 3: Combined (resource-gated pipeline with both collectors)');
  console.log('  3-slot pool, 6 task batches, each runs a metered pull chain');
  console.log('='.repeat(64));
  console.log();

  const capacityMetrics = new DefaultCapacityMetricsCollector();
  const chainMetrics = new DefaultChainMetricsCollector();

  const pool = new ResourceCapacitySource(
    { slots: 3 },
    undefined,
    capacityMetrics,
  );

  let totalItems = 0;

  for (let batch = 0; batch < 6; batch++) {
    const r = pool.tryAcquire({ slots: 1 });
    if (!r.ok) {
      console.log(`  Batch ${batch}: REJECTED (pool full)`);
      // Release a slot to unblock
      pool.release({ slots: 1 });
      // Retry
      const retry = pool.tryAcquire({ slots: 1 });
      if (!retry.ok) {
        console.log(`  Batch ${batch}: still rejected after release, skipping`);
        continue;
      }
    }

    // Each batch processes 5 items through a metered pipeline
    const data = Array.from({ length: 5 }, (_, i) => batch * 100 + i);
    const source = new SourceBufferObj(data, true);

    const results = await PullChain.from(source)
      .turnstile('batch-in', chainMetrics)
      .map((x) => x * 2)
      .turnstile('batch-doubled', chainMetrics)
      .filter((x) => x % 4 === 0)
      .turnstile('batch-out', chainMetrics)
      .collect();

    totalItems += results.length;

    // Simulate async work completion
    await sleep(5);

    pool.release({ slots: 1 });
    console.log(
      `  Batch ${batch}: ${results.length} items produced  ` +
        `pool-utilization=${(
          (pool.limits as Record<string, number>).slots -
          (pool.available as Record<string, number>).slots
        ) / (pool.limits as Record<string, number>).slots}`,
    );
  }

  console.log();
  console.log(`  Total items produced: ${totalItems}`);
  console.log();

  // --- Print combined snapshot ---

  const capSnap = capacityMetrics.snapshot();
  const chainSnap = chainMetrics.snapshot();

  console.log('  -- Capacity Snapshot --');
  console.log(
    `    accepted=${capSnap.totals.acquireAccepted}  ` +
      `rejected=${capSnap.totals.acquireRejected}  ` +
      `released=${capSnap.totals.release}`,
  );
  console.log(
    `    in-flight: ${JSON.stringify(capSnap.inFlightByResource)}`,
  );
  console.log(
    `    utilization: ${JSON.stringify(
      Object.fromEntries(
        Object.entries(capSnap.utilizationByResource).map(([k, v]) => [
          k,
          v.toFixed(4),
        ]),
      ),
    )}`,
  );
  console.log();

  console.log('  -- Chain Snapshot --');
  console.log('    Turnstiles:');
  for (const [name, ts] of Object.entries(chainSnap.turnstiles)) {
    console.log(`      ${pad(name, 16)} ${ts.passed} items`);
  }

  console.log('    Stage Latency:');
  if (Object.keys(chainSnap.stageLatencyMs).length === 0) {
    console.log('      (synchronous -- latency is sub-millisecond)');
  }
  for (const [pair, stats] of Object.entries(chainSnap.stageLatencyMs)) {
    console.log(`      ${pad(pair, 28)} ${fmtStats(stats)}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Run all demos
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await demoChainMetrics();
  await demoCapacityMetrics();
  await demoCombined();

  console.log('='.repeat(64));
  console.log('All demos complete.');
  console.log('='.repeat(64));
}

main().catch(console.error);
