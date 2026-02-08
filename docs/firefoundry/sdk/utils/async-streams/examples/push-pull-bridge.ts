/**
 * push-pull-bridge.ts
 *
 * Demonstrates bridging a push-based producer with a pull-based consumer
 * using PushPullBufferObj. A fast market-data producer pushes ticks into
 * the bridge; a slower analytics consumer pulls windowed batches out.
 *
 * Run:  npx tsx push-pull-bridge.ts
 */

import {
    PushPullBufferObj,
    PullChain,
} from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
    new Promise<void>(r => setTimeout(r, ms));

/** A single market-data tick. */
type Tick = {
    seq: number;
    price: number;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const totalTicks = 30;
    const windowSize = 5;

    console.log('--- push-pull-bridge ---');
    console.log(
        `Producing ${totalTicks} ticks (push), ` +
        `consuming in windows of ${windowSize} (pull).\n`
    );

    const started = Date.now();

    // -----------------------------------------------------------------------
    // Create the bridge
    // -----------------------------------------------------------------------
    // PushPullBufferObj<T> exposes:
    //   .sink   -- a PushObj<T> that producers call .next(value) on
    //   .source -- a PullObj<T> that consumers iterate with for-await
    //
    // Internally it shares an Array<T> buffer between a SinkCollectObj (push
    // side appends) and a SourceBufferObj (pull side shifts). A WaitObject
    // coordinates the two: the push side signals "data available" after each
    // write; the pull side waits for that signal when the buffer is empty.

    const bridge = new PushPullBufferObj<Tick>();

    // -----------------------------------------------------------------------
    // Producer (push side): emit ticks at variable ~30-80 ms intervals
    // -----------------------------------------------------------------------

    const producer = (async () => {
        let price = 100.0;
        for (let seq = 1; seq <= totalTicks; seq++) {
            // Random walk for price
            price += (Math.random() - 0.5) * 0.8;
            const tick: Tick = { seq, price: Number(price.toFixed(2)) };

            await bridge.sink.next(tick);

            const delay = 30 + Math.floor(Math.random() * 50);
            await sleep(delay);
        }

        // Signal that no more data is coming. This causes the pull side's
        // for-await loop to terminate after draining remaining items.
        await bridge.sink.return();
    })();

    // -----------------------------------------------------------------------
    // Consumer (pull side): pull ticks in windows of 5 with slower processing
    // -----------------------------------------------------------------------

    let consumed = 0;
    let windowNo = 0;

    // Wrap bridge.source in a PullChain to use the fluent .window() method.
    const pullPipeline = PullChain.from(bridge.source).window(windowSize);

    for await (const bucket of pullPipeline) {
        windowNo++;
        consumed += bucket.length;

        // Compute analytics on the window
        const prices = bucket.map(t => t.price);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const seqs = bucket.map(t => t.seq);

        const elapsed = Date.now() - started;
        console.log(
            `[${String(elapsed).padStart(5)}ms]  window=${windowNo}  ` +
            `consumed=${consumed}/${totalTicks}  ` +
            `seqs=[${seqs.join(',')}]  ` +
            `avg=${avg.toFixed(2)}  range=[${min.toFixed(2)}, ${max.toFixed(2)}]`
        );

        // Simulate slower analytics processing
        await sleep(120);
    }

    // Ensure producer has finished (it should have by now)
    await producer;

    const elapsed = Date.now() - started;
    console.log(
        `\n[${elapsed}ms]  Done. ` +
        `consumed=${consumed}  windows=${windowNo}`
    );

    // If totalTicks is not evenly divisible by windowSize, the last partial
    // window is the generator's return value -- not yielded by for-await.
    // To capture it, you would call pullPipeline.next() manually and check
    // result.done === true with a non-undefined result.value.
    if (totalTicks % windowSize !== 0) {
        console.log(
            `Note: ${totalTicks % windowSize} trailing tick(s) in the partial ` +
            `last window are the generator return value, not yielded by for-await.`
        );
    }
}

main().catch(console.error);
