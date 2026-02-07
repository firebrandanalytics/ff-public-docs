/**
 * demand-paced-ingestion.ts
 *
 * Demonstrates signal-based demand pull with bounded prefetch.
 *
 * A simulated sensor source produces readings at variable intervals.
 * A consumer processes them in batches of 5, with eager prefetch to
 * reduce latency and a timeout guard to prevent indefinite blocking.
 *
 * Run:  npx tsx demand-paced-ingestion.ts
 */

import {
    PullChain,
    SourceObj,
} from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
    new Promise<void>(r => setTimeout(r, ms));

/** Returns a delay that is baseMs +/- a random spread. */
const jitter = (baseMs: number, spreadMs: number): number =>
    baseMs + Math.floor(Math.random() * spreadMs);

// ---------------------------------------------------------------------------
// Source: simulated sensor that produces readings at variable rates
// ---------------------------------------------------------------------------

class SensorSource extends SourceObj<number> {
    private readonly count: number;
    private readonly baseDelayMs: number;

    constructor(count: number, baseDelayMs: number) {
        super();
        this.count = count;
        this.baseDelayMs = baseDelayMs;
    }

    protected override async *pull_impl(): AsyncGenerator<number, number | undefined, void> {
        for (let i = 1; i <= this.count; i++) {
            // Simulate variable production rate
            await sleep(jitter(this.baseDelayMs, 40));
            yield i;
        }
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const totalReadings = 20;
    const started = Date.now();

    console.log('--- demand-paced-ingestion ---');
    console.log(`Producing ${totalReadings} sensor readings, consuming in batches of 5.\n`);

    // Build the pull pipeline:
    //   SensorSource  -->  eager(2)  -->  timeout(300ms)  -->  window(5)  -->  consumer
    //
    // - eager(2):      Pre-fetches up to 2 readings so the next batch starts
    //                  filling while the consumer is still processing.
    // - timeout(300):  If a single reading takes longer than 300 ms, skip it
    //                  instead of blocking forever.  (throw_on_timeout = false)
    // - window(5):     Group individual readings into batches of 5.

    const pipeline = PullChain
        .from(new SensorSource(totalReadings, 30))
        .eager(2)
        .timeout(300, false)   // non-throwing: continue on timeout
        .window(5);

    let batchNo = 0;

    // The for-await loop is the demand signal. Each iteration implicitly
    // calls pipeline.next(), which pulls through the entire chain.
    for await (const batch of pipeline) {
        batchNo++;

        // Simulate slow batch processing (120 ms per batch).
        await sleep(120);

        const elapsed = Date.now() - started;
        console.log(
            `[${String(elapsed).padStart(5)}ms]  batch=${batchNo}  ` +
            `size=${batch.length}  values=[${batch.join(', ')}]`
        );
    }

    // Note: PullWindowObj returns a partial window (< 5 items) as the
    // generator's return value, which is NOT yielded by for-await.
    // If you need the partial tail, use pipeline.next() manually and
    // inspect result.done / result.value.

    const elapsed = Date.now() - started;
    console.log(`\n[${elapsed}ms]  Done. Consumed ${batchNo} full batches.`);
    console.log(
        'Partial last window (if any) is the generator return value, ' +
        'not yielded by for-await.'
    );
}

main().catch(console.error);
