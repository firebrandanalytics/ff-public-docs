/**
 * conversational-pipeline.ts
 *
 * Demonstrates BidirectionalChain for multi-stage conversational
 * request-response processing. Each user message flows through:
 *
 *   identity -> sanitize -> enrich -> generate -> format -> response
 *
 * Shows: .identity(), .map(), .then(), .tap(), .fromGenerator()
 *
 * Run:  npx tsx conversational-pipeline.ts
 */

import { BidirectionalChain } from '@firebrandanalytics/shared-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Enriched message with conversation context, produced by the enrich stage. */
interface EnrichedMessage {
    text: string;
    turn: number;
    timestamp: number;
    history: string[];
}

/** Final structured response returned to the caller. */
interface FormattedResponse {
    reply: string;
    turn: number;
    processingMs: number;
}

// ---------------------------------------------------------------------------
// Generator-based response stage (for the fromGenerator() demo)
// ---------------------------------------------------------------------------

/**
 * An async generator that produces responses based on enriched messages.
 * Maintains internal state via the generator's suspended execution context.
 *
 * The first `yield` is the "initial yield" -- its value is discarded by the
 * BidirectionalChain.fromGenerator() adapter during automatic priming.
 * After priming, each `yield` sends a response out and receives the next
 * EnrichedMessage in.
 */
async function* responseGenerator(): AsyncGenerator<string, any, EnrichedMessage> {
    // Initial yield: value '' is discarded during priming.
    // After priming, `msg` receives the first real EnrichedMessage.
    let msg: EnrichedMessage = yield '';

    while (true) {
        let reply: string;

        if (msg.turn === 1) {
            // First turn: welcome message
            reply = `Welcome! You said: "${msg.text}"`;
        } else {
            // Subsequent turns: echo with context
            reply = `[Turn ${msg.turn}] Echo: "${msg.text}" (history: ${msg.history.length} msgs)`;
        }

        // Yield the reply out, receive next message in
        msg = yield reply;
    }
}

// ---------------------------------------------------------------------------
// Pipeline 1: Using .then() for stateful stages (closure-based)
// ---------------------------------------------------------------------------

/**
 * Builds the main conversational pipeline using closure-based stages.
 *
 * Pipeline stages:
 *   1. identity<string>()  - Starting point, accepts raw user input
 *   2. .map()              - Sanitize: trim, lowercase, handle empty input
 *   3. .tap()              - Log sanitized input
 *   4. .then()             - Enrich: add turn number, timestamp, history
 *   5. .tap()              - Log enrichment metadata
 *   6. .then()             - Generate: produce a response from enriched context
 *   7. .tap()              - Log generated response
 *   8. .map()              - Format: wrap in a structured response envelope
 */
function buildClosurePipeline(): BidirectionalChain<string, FormattedResponse> {
    // Shared state for the format stage to capture turn info from enrich.
    // This demonstrates how .tap() can bridge information between stages
    // when the type signature of a later .map() doesn't include it.
    let currentTurn = 0;
    let stageStart = 0;

    return BidirectionalChain.identity<string>()

        // --- Stage 1: Input sanitization (stateless) ---
        // .map() is correct for pure transforms. No state, no side effects.
        .map((raw: string): string => {
            stageStart = Date.now();
            const trimmed = raw.trim();
            if (trimmed.length === 0) return '[empty]';
            if (trimmed.length > 500) return trimmed.slice(0, 500) + '...';
            return trimmed.toLowerCase();
        })

        // --- Tap: log sanitized input ---
        // .tap() observes the value without modifying it. The same value
        // that enters the tap exits unchanged.
        .tap(sanitized => {
            console.log(`  [sanitize] "${sanitized}"`);
        })

        // --- Stage 2: Context enrichment (stateful) ---
        // .then() accepts a factory that runs once and returns a processor.
        // The factory closes over `turn` and `history`, giving the processor
        // private state that persists across calls.
        .then<EnrichedMessage>(() => {
            let turn = 0;
            const history: string[] = [];

            return (text: string): EnrichedMessage => {
                turn++;
                history.push(text);
                currentTurn = turn; // share with format stage via closure

                return {
                    text,
                    turn,
                    timestamp: Date.now(),
                    history: [...history], // defensive copy
                };
            };
        })

        // --- Tap: log enrichment metadata ---
        .tap(msg => {
            console.log(`  [enrich]   turn=${msg.turn}  history=${msg.history.length}`);
        })

        // --- Stage 3: Response generation (stateful) ---
        // Another .then() stage. The factory returns a function that
        // generates responses based on the enriched message context.
        .then<string>(() => {
            return (msg: EnrichedMessage): string => {
                if (msg.turn === 1) {
                    return `Welcome! You said: "${msg.text}"`;
                }
                return (
                    `[Turn ${msg.turn}] Echo: "${msg.text}" ` +
                    `(history: ${msg.history.length} msgs)`
                );
            };
        })

        // --- Tap: log generated response ---
        .tap(reply => {
            console.log(`  [generate] "${reply}"`);
        })

        // --- Stage 4: Output formatting (stateless) ---
        // .map() wraps the reply string into a structured response object.
        // Uses `currentTurn` captured from the enrich tap above.
        .map((reply: string): FormattedResponse => {
            const result: FormattedResponse = {
                reply,
                turn: currentTurn,
                processingMs: Date.now() - stageStart,
            };
            console.log(`  [format]   {reply, turn=${result.turn}}`);
            return result;
        });
}

// ---------------------------------------------------------------------------
// Pipeline 2: Using .fromGenerator() for the response stage
// ---------------------------------------------------------------------------

/**
 * Builds a pipeline that uses BidirectionalChain.fromGenerator() for the
 * response generation stage, demonstrating generator-based stateful stages.
 *
 * fromGenerator() handles generator priming automatically -- the caller
 * never has to deal with the "first .next() is discarded" JS generator
 * quirk.
 */
function buildGeneratorPipeline(): BidirectionalChain<string, string> {
    // Build the generator stage as a separate chain.
    // fromGenerator() calls gen.next(undefined) internally to prime it,
    // then each subsequent .next(input) sends input to the generator and
    // returns the yielded output.
    const genStage = BidirectionalChain.fromGenerator<EnrichedMessage, string>(
        () => responseGenerator(),
    );

    return BidirectionalChain.identity<string>()

        // Sanitize (same as above)
        .map((raw: string): string => {
            const trimmed = raw.trim();
            if (trimmed.length === 0) return '[empty]';
            return trimmed.toLowerCase();
        })

        // Enrich (same as above)
        .then<EnrichedMessage>(() => {
            let turn = 0;
            const history: string[] = [];
            return (text: string): EnrichedMessage => {
                turn++;
                history.push(text);
                return {
                    text,
                    turn,
                    timestamp: Date.now(),
                    history: [...history],
                };
            };
        })

        // Generate -- delegate to the generator-based chain.
        // We wrap genStage.next() inside a .then() processor so it
        // integrates into the outer pipeline's type flow.
        .then<string>(() => {
            return async (msg: EnrichedMessage): Promise<string> => {
                const result = await genStage.next(msg);
                return result.value;
            };
        })

        .tap(reply => {
            console.log(`  [generate] "${reply}"`);
        });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const messages = [
        '  Hello World  ',  // leading/trailing whitespace to sanitize
        'How are you?',     // normal message
        '  ',               // empty after trim -- triggers [empty] sentinel
        'Goodbye!',         // final message
    ];

    // -----------------------------------------------------------------------
    // Part 1: Closure-based pipeline
    // -----------------------------------------------------------------------

    console.log('--- conversational-pipeline ---');
    console.log(
        `Processing ${messages.length} user messages through a multi-stage pipeline.\n`,
    );

    const closurePipeline = buildClosurePipeline();

    for (const msg of messages) {
        console.log(`> User: "${msg}"`);

        // Each .next() call sends a message through all stages and returns
        // the fully formatted response. No priming needed -- BidirectionalChain
        // uses function-based stages, not generators, so the first .next()
        // call is NOT discarded.
        const result = await closurePipeline.next(msg);

        console.log(`< Bot:  ${JSON.stringify(result.value)}\n`);
    }

    // Signal the pipeline that no more data is coming.
    await closurePipeline.return();

    // -----------------------------------------------------------------------
    // Part 2: Generator-based pipeline
    // -----------------------------------------------------------------------

    console.log('--- generator-based pipeline ---');
    console.log(
        'Running the same conversation through a fromGenerator()-based response stage.\n',
    );

    const generatorPipeline = buildGeneratorPipeline();

    for (const msg of messages) {
        console.log(`> User: "${msg}"`);
        const result = await generatorPipeline.next(msg);
        console.log(`< Bot:  ${JSON.stringify(result.value)}\n`);
    }

    await generatorPipeline.return();

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------

    console.log(
        `[summary]  turns=${messages.length}  ` +
        `pipeline_stages=${closurePipeline.length}`,
    );
}

main().catch(console.error);
