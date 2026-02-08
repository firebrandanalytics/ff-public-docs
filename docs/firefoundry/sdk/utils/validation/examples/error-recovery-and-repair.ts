/**
 * Error Recovery and Repair
 *
 * Demonstrates per-field error handling using @Catch for deterministic
 * fallbacks and @AICatchRepair for AI-powered repair. Shows how critical
 * fields fail loudly while optional fields degrade gracefully.
 *
 * Run:
 *   npx tsx error-recovery-and-repair.ts
 */

import {
    ValidationFactory,
    CoerceParse,
    CoerceType,
    CoerceTrim,
    ValidateRequired,
    ValidatePattern,
    ValidateRange,
    Catch,
    AICatchRepair,
    Examples,
    ValidationError,
} from '@firebrandanalytics/shared-utils/validation';

// ── Mock AI handler ──────────────────────────────────────────────────────────
// Simulates AI repair for standalone execution. In production, replace with
// a real LLM call:
//
//   const factory = new ValidationFactory({
//       aiHandler: async (params, prompt) => {
//           const response = await openai.chat.completions.create({
//               model: 'gpt-4',
//               messages: [{ role: 'user', content: prompt }],
//           });
//           return response.choices[0].message.content;
//       },
//   });

function createMockAIHandler() {
    const repairs: Record<string, string> = {
        'Jan 32nd, 2024':    '2024-02-01',
        'next Tuesday':      '2024-07-09',
        'Q3 2024':           '2024-07-01',
        'sometime in March': '2024-03-15',
        '13/25/2024':        '2024-12-25',
    };

    return async (params: { value: unknown; propertyKey: string }, prompt: string): Promise<string> => {
        const raw = String(params.value);
        const repaired = repairs[raw];
        if (repaired) {
            console.log(`    [mock AI] Repaired "${raw}" -> "${repaired}"`);
            return repaired;
        }
        throw new Error(`Mock AI handler has no repair mapping for: "${raw}"`);
    };
}

// ── Validated class ──────────────────────────────────────────────────────────

class DataImport {
    @ValidateRequired()
    @CoerceTrim()
    source!: string;

    // Optional: malformed JSON falls back to empty object
    @CoerceParse('json')
    @Catch((error: Error, value: unknown) => {
        console.log(`    [catch] metadata: falling back to {} for ${JSON.stringify(value)}`);
        return {};
    })
    metadata!: Record<string, unknown>;

    // Optional: weird dates get AI repair
    @CoerceType('date')
    @AICatchRepair('Fix this to a valid ISO 8601 date. The value may use non-standard formatting.')
    @Examples(['2024-01-15', '2024-06-30T12:00:00Z'], 'ISO 8601 date')
    eventDate!: Date;

    // Optional: non-numeric priority falls back to 0
    @CoerceType('number')
    @Catch((error: Error, value: unknown) => {
        console.log(`    [catch] priority: falling back to 0 for ${JSON.stringify(value)}`);
        return 0;
    })
    @ValidateRange(0, 10)
    priority!: number;

    // Critical: invalid email MUST fail loudly -- no @Catch
    @CoerceTrim()
    @ValidateRequired()
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
    @Examples(['user@example.com', 'admin@company.org'], 'Valid email address')
    email!: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const factory = new ValidationFactory({ aiHandler: createMockAIHandler() });

function header(title: string): void {
    console.log(`\n${'─'.repeat(2)} ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

function fmt(v: unknown): string {
    if (v instanceof Date) return v.toISOString();
    return typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
}

function printRecord(label: string, obj: Record<string, unknown>): void {
    console.log(`  ${label}:`);
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'function') continue;
        console.log(`    ${k.padEnd(14)}: ${fmt(v)}`);
    }
}

function dateStr(d: unknown): string {
    return d instanceof Date ? d.toISOString().split('T')[0] : String(d);
}

// ── Demo 1: All optional fields recover ──────────────────────────────────────

async function demoRecoverableFlaws(): Promise<void> {
    header('Demo 1: Recoverable Flaws');

    const input = {
        source: '  legacy-crm  ',
        metadata: '{name: "test",}',       // malformed JSON
        eventDate: 'Jan 32nd, 2024',       // impossible date
        priority: 'high',                   // string instead of number
        email: 'jane@example.com',         // valid
    };

    printRecord('Input', input);
    console.log('\n  Recovery trace:');
    const result = await factory.create(DataImport, input);
    console.log();
    printRecord('Output', result as unknown as Record<string, unknown>);
}

// ── Demo 2: AI repair for various date formats ──────────────────────────────

async function demoAIDateRepair(): Promise<void> {
    header('Demo 2: AI Date Repair');

    const dateInputs = ['Q3 2024', 'sometime in March', '13/25/2024'];

    for (const dateValue of dateInputs) {
        const input = {
            source: 'test-harness', metadata: '{}',
            eventDate: dateValue, priority: '5', email: 'test@example.com',
        };
        console.log(`\n  Attempting: eventDate = "${dateValue}"`);
        try {
            const result = await factory.create(DataImport, input);
            console.log(`  Result:     eventDate = ${dateStr(result.eventDate)}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`  Failed:     ${msg.slice(0, 80)}`);
        }
    }
}

// ── Demo 3: Critical field failure ───────────────────────────────────────────

async function demoCriticalFailure(): Promise<void> {
    header('Demo 3: Critical Field Failure (email has no @Catch)');

    const invalidEmails = ['not-an-email', '', 'missing-at-sign.com', '   @no-local-part.com'];

    for (const emailValue of invalidEmails) {
        const input = {
            source: 'external-api', metadata: '{"valid": true}',
            eventDate: '2024-06-15', priority: '5', email: emailValue,
        };
        try {
            await factory.create(DataImport, input);
            console.log(`\n  email = ${JSON.stringify(emailValue)}: Unexpectedly passed`);
        } catch (err) {
            const label = JSON.stringify(emailValue);
            if (err instanceof ValidationError) {
                console.log(`\n  email = ${label.padEnd(28)} -> ValidationError`);
                console.log(`    message  : ${err.message}`);
                console.log(`    property : ${err.propertyPath}`);
                console.log(`    rule     : ${err.rule}`);
                if (err.examples) console.log(`    examples : ${JSON.stringify(err.examples)}`);
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`\n  email = ${label.padEnd(28)} -> Error: ${msg.slice(0, 60)}`);
            }
        }
    }
}

// ── Demo 4: Mixed batch -- some recover, some fail ───────────────────────────

async function demoBatchProcessing(): Promise<void> {
    header('Demo 4: Batch Processing (mixed outcomes)');

    const batch = [
        { source: 'csv-import',   metadata: '{"region": "NA"}', eventDate: '2024-03-15',      priority: '7',      email: 'alice@example.com' },
        { source: 'partner-feed', metadata: 'not json at all',  eventDate: 'next Tuesday',     priority: 'urgent', email: 'bob@partner.io' },
        { source: 'manual-entry', metadata: '{}',               eventDate: '2024-12-01',       priority: '3',      email: 'bad-email' },
        { source: 'webhook',      metadata: '{trailing: comma,}', eventDate: 'Q3 2024',        priority: 'none',   email: 'webhook@service.com' },
    ];

    console.log(`\n  Processing ${batch.length} records...\n`);

    const results = await Promise.allSettled(
        batch.map(record => factory.create(DataImport, record)),
    );

    let ok = 0, fail = 0;
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
            ok++;
            const o = r.value;
            console.log(
                `  [OK]   #${i + 1} (${o.source}): ` +
                `email=${o.email}, date=${dateStr(o.eventDate)}, priority=${o.priority}`,
            );
        } else {
            fail++;
            const e = r.reason;
            const msg = e instanceof ValidationError
                ? `${e.propertyPath}: ${e.message}`
                : e instanceof Error ? e.message : String(e);
            console.log(`  [FAIL] #${i + 1} (${batch[i].source}): ${msg}`);
        }
    }
    console.log(`\n  Summary: ${ok} succeeded, ${fail} failed out of ${batch.length}`);
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log('=== Error Recovery and Repair ===');
    console.log('Demonstrates @Catch fallbacks, @AICatchRepair for AI repair,');
    console.log('and critical fields that fail loudly with clear error messages.\n');

    await demoRecoverableFlaws();
    await demoAIDateRepair();
    await demoCriticalFailure();
    await demoBatchProcessing();

    console.log('\n' + '─'.repeat(57));
    console.log('Done. All demos completed.');
}

main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
