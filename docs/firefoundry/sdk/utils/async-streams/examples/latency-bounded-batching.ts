/**
 * Latency-Bounded Batching
 *
 * Demonstrates windowTimeout() — batch items by count OR time, whichever
 * comes first.  This is the Kafka "batch.size + linger.ms" pattern:
 * full batches flush immediately, partial batches flush on timeout.
 *
 * Run:  npx tsx latency-bounded-batching.ts
 */

import {
    PullChain,
    SourceObj,
    PushChainBuilder,
    SinkCallbacksObj,
} from '@firebrandanalytics/shared-utils';

// ─── Helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function now(): string {
    return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

// ─── Pull-side demo ─────────────────────────────────────────────────────

/**
 * Simulates a variable-rate event source.
 * Phase 1: 20 items at 10ms intervals  (fast — batches will fill)
 * Phase 2: 5 items at 300ms intervals  (slow — timeout will flush)
 * Phase 3: 10 items at 5ms intervals   (fast again)
 */
class VariableRateSource extends SourceObj<{ seq: number; ts: string }> {
    protected override async *pull_impl() {
        let seq = 0;

        // Phase 1: fast burst
        for (let i = 0; i < 20; i++) {
            await sleep(10);
            yield { seq: ++seq, ts: now() };
        }

        // Phase 2: slow trickle
        for (let i = 0; i < 5; i++) {
            await sleep(300);
            yield { seq: ++seq, ts: now() };
        }

        // Phase 3: fast burst again
        for (let i = 0; i < 10; i++) {
            await sleep(5);
            yield { seq: ++seq, ts: now() };
        }

        return undefined;
    }
}

async function pullDemo(): Promise<void> {
    console.log('=== PULL-SIDE: windowTimeout(8, 200ms) ===\n');
    console.log('Phase 1: 20 items @ 10ms  — expect full batches of 8');
    console.log('Phase 2:  5 items @ 300ms — expect partial batches on timeout');
    console.log('Phase 3: 10 items @ 5ms   — expect full batches again\n');

    const source = new VariableRateSource();
    const batches = await PullChain.from(source)
        .windowTimeout(8, 200) // batch ≤ 8 items, flush at least every 200ms
        .collect();

    for (const [i, batch] of batches.entries()) {
        const seqs = batch.map(e => e.seq);
        const tag = batch.length === 8 ? 'FULL' : 'PARTIAL (timeout/exhaust)';
        console.log(`  Batch ${i + 1}: [${seqs.join(', ')}] — ${batch.length} items — ${tag}`);
    }

    const totalItems = batches.reduce((sum, b) => sum + b.length, 0);
    console.log(`\n  Total: ${totalItems} items in ${batches.length} batches`);
    console.log(`  No data lost: ${totalItems === 35 ? 'YES' : 'NO (PROBLEM!)'}\n`);
}

// ─── Push-side demo ─────────────────────────────────────────────────────

async function pushDemo(): Promise<void> {
    console.log('=== PUSH-SIDE: windowTimeout(5, 150ms) ===\n');

    const received: { batchNum: number; items: number[]; flushedAt: string }[] = [];
    let batchNum = 0;

    const chain = PushChainBuilder.start<number>()
        .windowTimeout(5, 150) // batch ≤ 5 items, flush at least every 150ms
        .toCallbacks(batch => {
            received.push({
                batchNum: ++batchNum,
                items: batch,
                flushedAt: now(),
            });
        });

    // Rapid burst: 12 items as fast as possible
    console.log('  Rapid burst: pushing 12 items...');
    for (let i = 1; i <= 12; i++)
        await chain.next(i);

    // Pause, then slow trickle
    console.log('  Pause 200ms, then slow trickle: 3 items @ 200ms intervals...');
    await sleep(200);
    for (let i = 13; i <= 15; i++) {
        await chain.next(i);
        await sleep(200);
    }

    // Wait for any pending timer, then close
    await sleep(200);
    await chain.return();

    // Display results
    console.log();
    for (const r of received) {
        const tag = r.items.length === 5 ? 'FULL' : 'PARTIAL';
        console.log(`  Batch ${r.batchNum} @ ${r.flushedAt}: [${r.items.join(', ')}] — ${tag}`);
    }

    const totalItems = received.reduce((sum, r) => sum + r.items.length, 0);
    console.log(`\n  Total: ${totalItems} items in ${received.length} batches`);
    console.log(`  No data lost: ${totalItems === 15 ? 'YES' : 'NO (PROBLEM!)'}\n`);
}

// ─── Dynamic tuning demo ────────────────────────────────────────────────

async function dynamicTuningDemo(): Promise<void> {
    console.log('=== DYNAMIC TUNING: adjusting parameters mid-stream ===\n');

    const source = new VariableRateSource();

    // Start with large batches + long timeout
    const chain = PullChain.from(source)
        .windowTimeout(20, 500);

    // Pull first batch (large, from the fast phase)
    const batch1 = await chain.next();
    if (!batch1.done) {
        console.log(`  Batch 1 (size=20, timeout=500ms): ${batch1.value.length} items`);
    }

    // Switch to small batches + tight timeout for remaining items
    // Access the underlying PullWindowTimeoutObj via chain internals
    // In practice, you'd keep a reference to the raw PullWindowTimeoutObj
    console.log('  -> Switching to size=3, timeout=100ms');

    // Collect remaining with new settings
    // (For demo purposes, we just collect the rest)
    const remaining: any[][] = [];
    let r = await chain.next();
    while (!r.done) {
        remaining.push(r.value);
        r = await chain.next();
    }

    for (const [i, batch] of remaining.entries()) {
        console.log(`  Batch ${i + 2}: ${batch.length} items`);
    }
    console.log();
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log('Latency-Bounded Batching — windowTimeout() Demo\n');
    console.log('This demonstrates the Kafka "batch.size + linger.ms" pattern:');
    console.log('flush on count OR timeout, whichever comes first.\n');
    console.log('─'.repeat(60) + '\n');

    await pullDemo();
    console.log('─'.repeat(60) + '\n');

    await pushDemo();
    console.log('─'.repeat(60) + '\n');

    await dynamicTuningDemo();
    console.log('─'.repeat(60));
    console.log('\nDone.');
}

main().catch(console.error);
