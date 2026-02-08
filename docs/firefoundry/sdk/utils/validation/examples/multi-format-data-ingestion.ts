/**
 * Multi-Format Data Ingestion
 *
 * Demonstrates parsing currency strings, locale-specific numbers, embedded JSON,
 * and mixed date formats into clean typed output using the decorator pipeline.
 *
 * Run:
 *   npx tsx multi-format-data-ingestion.ts
 */

import {
    ValidationFactory,
    CoerceParse,
    CoerceType,
    CoerceRound,
    CoerceFormat,
    CoerceTrim,
    CoerceCase,
    ValidateRequired,
    ValidateRange,
    ValidatePattern,
} from '@firebrandanalytics/shared-utils/validation';

// ---------------------------------------------------------------------------
// 1. FinancialRecord -- multi-currency, European decimals, accounting negatives
// ---------------------------------------------------------------------------

class FinancialRecord {
    @ValidateRequired()
    @CoerceTrim()
    transactionId!: string;

    // US currency string: "$1,234.56" -> 1234.56
    @CoerceParse('currency', { locale: 'en-US' })
    @CoerceRound({ precision: 2 })
    @ValidateRange(0)
    amount!: number;

    // European number format: "1.234,56" -> 1234.56
    @CoerceParse('number', { locale: 'de-DE' })
    @CoerceRound({ precision: 2 })
    europeanTotal!: number;

    // Accounting parentheses: "(500.00)" -> -500.00
    @CoerceParse('currency', { allowParentheses: true })
    @CoerceRound({ precision: 2 })
    adjustment!: number;

    // Embedded JSON string -> parsed object; already-parsed objects pass through
    @CoerceParse('json', { allowNonString: true })
    metadata!: Record<string, unknown>;

    // Accepts ISO strings, natural language dates, or Unix timestamps
    @CoerceType('date', { format: 'loose', allowTimestamps: true })
    @CoerceFormat('date', { format: 'iso-date', timezone: 'utc' })
    transactionDate!: string;
}

// ---------------------------------------------------------------------------
// 2. SalesReport -- locale-aware parse + formatted output
// ---------------------------------------------------------------------------

class SalesReport {
    @ValidateRequired()
    @CoerceTrim()
    @CoerceCase('upper')
    region!: string;

    // Parse any currency string and round to 2 decimal places
    @CoerceParse('currency', { locale: 'en-US' })
    @CoerceRound({ precision: 2 })
    revenue!: number;

    // European decimal -> rounded number
    @CoerceParse('number', { locale: 'de-DE' })
    @CoerceRound({ precision: 1 })
    growthRate!: number;

    // Flexible date input -> ISO date string
    @CoerceType('date', { format: 'loose', allowTimestamps: true })
    @CoerceFormat('date', { format: 'iso-date', timezone: 'utc' })
    reportDate!: string;

    @CoerceTrim()
    @CoerceCase('lower')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
    contactEmail!: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const factory = new ValidationFactory();

function header(title: string): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('='.repeat(60));
}

function dump(label: string, obj: unknown): void {
    console.log(`\n--- ${label} ---`);
    console.log(JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// Demo: FinancialRecord with different source formats
// ---------------------------------------------------------------------------

async function demoFinancialRecords(): Promise<void> {
    header('Financial Records -- Multi-Format Currency & Dates');

    // US payment gateway payload
    const usRecord = await factory.create(FinancialRecord, {
        transactionId: '  TXN-001  ',
        amount: '$1,234.56',
        europeanTotal: '1.234,56',
        adjustment: '(500.00)',
        metadata: '{"region":"NA","priority":1}',
        transactionDate: 'Jan 15, 2024',
    });
    dump('US payment gateway input', usRecord);

    // European ERP payload
    const euRecord = await factory.create(FinancialRecord, {
        transactionId: 'TXN-002',
        amount: '$2,500.00',
        europeanTotal: '2.500,00',
        adjustment: '0.00',
        metadata: { region: 'EMEA', priority: 2 },
        transactionDate: '2024-01-15',
    });
    dump('European ERP input', euRecord);

    // Internal API payload (raw numbers + timestamp)
    const apiRecord = await factory.create(FinancialRecord, {
        transactionId: 'TXN-003',
        amount: '$750.00',
        europeanTotal: '750,00',
        adjustment: '(25.50)',
        metadata: '{"region":"APAC","priority":3}',
        transactionDate: 1705276800000,
    });
    dump('Internal API input (timestamp)', apiRecord);
}

// ---------------------------------------------------------------------------
// Demo: SalesReport with locale-aware formatting
// ---------------------------------------------------------------------------

async function demoSalesReport(): Promise<void> {
    header('Sales Report -- Parse & Re-Format');

    const report = await factory.create(SalesReport, {
        region: '  emea  ',
        revenue: '$1,234,567.89',
        growthRate: '12,5',
        reportDate: 1705276800000,
        contactEmail: '  SALES@EXAMPLE.COM  ',
    });
    dump('Formatted sales report', report);

    const report2 = await factory.create(SalesReport, {
        region: 'na',
        revenue: '$987,654.32',
        growthRate: '8,3',
        reportDate: 'March 1, 2024',
        contactEmail: '  FINANCE@EXAMPLE.COM  ',
    });
    dump('Second region report', report2);
}

// ---------------------------------------------------------------------------
// Demo: Side-by-side comparison of identical values in different formats
// ---------------------------------------------------------------------------

async function demoFormatNormalization(): Promise<void> {
    header('Format Normalization -- Same Value, Different Representations');

    const inputs = [
        { transactionId: 'CMP-A', amount: '$1,234.56', europeanTotal: '1.234,56', adjustment: '0.00',     metadata: '{"source":"csv"}',  transactionDate: '2024-01-15' },
        { transactionId: 'CMP-B', amount: '$1,234.56', europeanTotal: '1.234,56', adjustment: '(0.00)',    metadata: { source: 'api' },    transactionDate: 'Jan 15, 2024' },
        { transactionId: 'CMP-C', amount: '$1,234.56', europeanTotal: '1.234,56', adjustment: '$0.00',     metadata: '{"source":"manual"}', transactionDate: 1705276800000 },
    ];

    for (const input of inputs) {
        const record = await factory.create(FinancialRecord, input);
        console.log(
            `  ${record.transactionId}: amount=${record.amount}, ` +
            `euroTotal=${record.europeanTotal}, adj=${record.adjustment}, ` +
            `date=${record.transactionDate}`
        );
    }

    console.log('\nAll three rows produce identical numeric and date values.');
}

// ---------------------------------------------------------------------------
// Demo: Accounting-format negative numbers
// ---------------------------------------------------------------------------

async function demoAccountingFormat(): Promise<void> {
    header('Accounting Format -- Parenthesized Negatives');

    const positiveRow = await factory.create(FinancialRecord, {
        transactionId: 'ACCT-POS',
        amount: '$500.00',
        europeanTotal: '500,00',
        adjustment: '$120.00',
        metadata: '{}',
        transactionDate: '2024-06-01',
    });

    const negativeRow = await factory.create(FinancialRecord, {
        transactionId: 'ACCT-NEG',
        amount: '$500.00',
        europeanTotal: '500,00',
        adjustment: '(120.00)',
        metadata: '{}',
        transactionDate: '2024-06-01',
    });

    console.log(`  Positive adjustment: ${positiveRow.adjustment}`);
    console.log(`  Negative adjustment: ${negativeRow.adjustment}`);
    console.log('\nParenthesized values are automatically converted to negative numbers.');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    console.log('Multi-Format Data Ingestion');
    console.log('Demonstrates @CoerceParse, @CoerceType, @CoerceRound, and @CoerceFormat');
    console.log('normalizing heterogeneous data into consistent typed output.\n');

    await demoFinancialRecords();
    await demoSalesReport();
    await demoFormatNormalization();
    await demoAccountingFormat();

    console.log('\nDone.');
}

main().catch(console.error);
