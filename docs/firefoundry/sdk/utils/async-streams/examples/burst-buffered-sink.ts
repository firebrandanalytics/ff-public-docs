/**
 * burst-buffered-sink.ts
 *
 * Demonstrates bounded-buffer push pipelines with serialization,
 * sampling, and batched writes to a slow downstream sink.
 *
 * A fast producer pushes 80 events through:
 *   serial() -> filter(sampling) -> window(10) -> SlowBatchSink
 *
 * Run:  npx tsx burst-buffered-sink.ts
 */

import {
    PushChainBuilder,
    PushObj,
} from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
    new Promise<void>(r => setTimeout(r, ms));

/**
 * Simple seeded PRNG so output is reproducible across runs.
 * Uses a linear congruential generator (LCG).
 */
const makeRng = (seed: number): (() => number) => {
    let x = seed >>> 0;
    return () => {
        x = (1664525 * x + 1013904223) >>> 0;
        return x / 0x100000000;
    };
};

// ---------------------------------------------------------------------------
// Sink: simulates a slow database batch writer
// ---------------------------------------------------------------------------

class SlowBatchSink extends PushObj<number[]> {
    public batchCount = 0;
    public itemCount = 0;

    protected override async next_impl(batch: number[]): Promise<IteratorResult<void>> {
        // Simulate slow I/O: 120 ms per batch write
        await sleep(120);

        this.batchCount++;
        this.itemCount += batch.length;

        console.log(
            `  [sink]  batch=${this.batchCount}  size=${batch.length}  ` +
            `first=${batch[0]}  last=${batch[batch.length - 1]}`
        );

        return { done: false, value: undefined };
    }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const totalEvents = 80;
    const rng = makeRng(7);

    console.log('--- burst-buffered-sink ---');
    console.log(
        `Producing ${totalEvents} events. ` +
        `~20% sampled out, batched in windows of 10.\n`
    );

    const started = Date.now();

    // Build the push pipeline from head to tail:
    //
    //   producer.next(value)
    //     --> serial()        Serialize concurrent pushes so the generator-based
    //                         sink processes one at a time.
    //     --> filter(~80%)    Probabilistic sampling: drop ~20% of events.
    //     --> window(10)      Accumulate 10 items into an array before forwarding.
    //     --> SlowBatchSink   Writes each batch with 120 ms latency.

    const sink = new SlowBatchSink();

    const chain = PushChainBuilder.start<number>()
        .serial()
        .filter(() => rng() > 0.2)
        .window(10)
        .into(sink);

    // -----------------------------------------------------------------------
    // IMPORTANT: Priming call for PushSerialObj
    // -----------------------------------------------------------------------
    // PushSerialObj wraps an internal generator. The first next() call primes
    // the generator -- standard JS generator semantics mean the *sent* value
    // on the first next() is NOT captured by yield. The generator advances to
    // the first yield point and pauses; the value we pass (-1 here) is lost.
    //
    // This is an intentional API behavior, not a bug. Always issue one
    // priming call before sending real data through a chain that uses serial().

    await chain.next(-1 as any);

    // -----------------------------------------------------------------------
    // Burst production: fire all 80 events as fast as possible
    // -----------------------------------------------------------------------
    // Because serial() is in the chain, concurrent next() calls queue up
    // inside the generator. Without serial(), they would race through the
    // filter and window stages concurrently, corrupting shared state.

    console.log('[producer]  Firing all events...');
    const writes: Array<Promise<IteratorResult<void>>> = [];
    for (let i = 1; i <= totalEvents; i++) {
        writes.push(chain.next(i));
    }

    // Wait for all queued writes to drain through the pipeline.
    await Promise.all(writes);

    // Signal the pipeline that no more data is coming.
    await chain.return();

    const elapsed = Date.now() - started;
    console.log(
        `\n[summary]  produced=${totalEvents}  ` +
        `delivered=${sink.itemCount}  ` +
        `batches=${sink.batchCount}  ` +
        `elapsed=${elapsed}ms`
    );
    console.log(
        `[summary]  drop rate=${(
            ((totalEvents - sink.itemCount) / totalEvents) * 100
        ).toFixed(1)}%`
    );
}

main().catch(console.error);
