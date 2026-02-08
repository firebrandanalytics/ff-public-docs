/**
 * Built-In Transforms and Extensible Registries
 *
 * Demonstrates the three extensible transform systems:
 *   1. TextNormalizerRegistry — 19 built-in string normalizers
 *   2. ParserRegistry — JSON + locale-aware number/currency parsing
 *   3. CoerceFormat — Intl-based date and number formatting
 *
 * Also shows how to register custom normalizers and parsers.
 *
 * Run:
 *   npx tsx built-in-transforms-and-registries.ts
 */

import {
    ValidationFactory,
    Copy,
    Coerce,
    CoerceParse,
    CoerceFormat,
    CoerceTrim,
    CoerceType,
    NormalizeText,
    NormalizeTextChain,
    UseSinglePassValidation,
    ValidateRequired,
    ValidatePattern,
    ValidateLength,
    TextNormalizerRegistry,
    ParserRegistry,
} from '@firebrandanalytics/shared-utils/validation';

// ── Helpers ─────────────────────────────────────────────────────────────────

function header(title: string): void {
    console.log(`\n${'─'.repeat(2)} ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

function showField(label: string, input: unknown, output: unknown): void {
    const inp = JSON.stringify(input);
    const out = JSON.stringify(output);
    console.log(`  ${label.padEnd(16)} ${inp.padEnd(34)} → ${out}`);
}

// ── Demo 1: Built-in text normalizers ───────────────────────────────────────

@UseSinglePassValidation()
class ContactInfo {
    @NormalizeText('email')
    email!: string;

    @NormalizeText('phone')
    phoneDigits!: string;

    @NormalizeText('phone-formatted')
    phoneDisplay!: string;

    @NormalizeText('url')
    website!: string;

    @NormalizeText('slug')
    username!: string;

    @NormalizeText('us-zip')
    zip!: string;

    @NormalizeText('whitespace')
    bio!: string;

    @NormalizeText('currency')
    salaryRaw!: string;

    @NormalizeText('credit-card')
    cardDigits!: string;

    @NormalizeText('credit-card-formatted')
    cardDisplay!: string;

    @NormalizeText('ssn-formatted')
    ssn!: string;

    @NormalizeText('remove-diacritics')
    searchName!: string;

    @NormalizeText('html-entities')
    htmlContent!: string;

    @NormalizeText('control-strip')
    cleanText!: string;
}

async function demoTextNormalizers(): Promise<void> {
    header('Demo 1: Built-In Text Normalizers');
    console.log(`  ${TextNormalizerRegistry.list().length} normalizers available: ${TextNormalizerRegistry.list().join(', ')}\n`);

    const factory = new ValidationFactory();
    const raw = {
        email: '  Alice.Smith@EXAMPLE.COM  ',
        phoneDigits: '(555) 867-5309',
        phoneDisplay: '5558675309',
        website: 'example.COM/About',
        username: 'Héllo Wörld! 2024',
        zip: '7701',
        bio: '  too   many   spaces   here  ',
        salaryRaw: '$1,234.56',
        cardDigits: '4111-1111-1111-1111',
        cardDisplay: '4111111111111111',
        ssn: '123456789',
        searchName: 'José García',
        htmlContent: '&lt;b&gt;Hello&lt;/b&gt; &amp; welcome',
        cleanText: 'hello\u200Bworld',
    };

    const result = await factory.create(ContactInfo, raw);

    showField('email:', raw.email, result.email);
    showField('phone:', raw.phoneDigits, result.phoneDigits);
    showField('phone-fmt:', raw.phoneDisplay, result.phoneDisplay);
    showField('url:', raw.website, result.website);
    showField('slug:', raw.username, result.username);
    showField('zip:', raw.zip, result.zip);
    showField('whitespace:', raw.bio, result.bio);
    showField('currency:', raw.salaryRaw, result.salaryRaw);
    showField('credit-card:', raw.cardDigits, result.cardDigits);
    showField('card-fmt:', raw.cardDisplay, result.cardDisplay);
    showField('ssn-fmt:', raw.ssn, result.ssn);
    showField('diacritics:', raw.searchName, result.searchName);
    showField('html-decode:', raw.htmlContent, result.htmlContent);
    showField('ctrl-strip:', JSON.stringify(raw.cleanText), result.cleanText);
}

// ── Demo 2: Normalizer chaining ─────────────────────────────────────────────

@UseSinglePassValidation()
class InternationalSlug {
    @NormalizeTextChain(['unicode-nfc', 'remove-diacritics', 'whitespace', 'slug'])
    slug!: string;
}

async function demoNormalizerChaining(): Promise<void> {
    header('Demo 2: Normalizer Chaining (@NormalizeTextChain)');
    console.log('  Chain: unicode-nfc → remove-diacritics → whitespace → slug\n');

    const factory = new ValidationFactory();

    const testCases = [
        '  Ça  fait  plaisir,  José!  ',
        '  Ünïcödé   Tëst   Strïng  ',
        '  Ñoño & Müller: A Story  ',
    ];

    for (const input of testCases) {
        const result = await factory.create(InternationalSlug, { slug: input });
        showField('chain:', input, result.slug);
    }
}

// ── Demo 3: Built-in parsers ────────────────────────────────────────────────

@UseSinglePassValidation()
class JSONConfig {
    @CoerceParse('json')
    config!: Record<string, any>;
}

@UseSinglePassValidation()
class LocalizedNumbers {
    @CoerceParse('number', { locale: 'de-DE' })
    germanNumber!: number;

    @CoerceParse('number', { locale: 'en-US' })
    americanNumber!: number;

    @CoerceParse('currency', { locale: 'en-US', currency: 'USD' })
    price!: number;

    @CoerceParse('currency', { locale: 'en-US', currency: 'USD', allowParentheses: true })
    negativePrice!: number;
}

async function demoParsers(): Promise<void> {
    header('Demo 3: Built-In Parsers (@CoerceParse)');
    console.log(`  Parsers available: ${ParserRegistry.list().join(', ')}\n`);

    const factory = new ValidationFactory();

    // JSON parsing
    const jsonRaw = { config: '{"debug": true, "level": "verbose"}' };
    const jsonResult = await factory.create(JSONConfig, jsonRaw);
    showField('json:', jsonRaw.config, jsonResult.config);

    // Locale-aware number parsing
    const numRaw = {
        germanNumber: '1.234,56',
        americanNumber: '1,234.56',
        price: '$1,234.56',
        negativePrice: '($1,234.56)',
    };
    const numResult = await factory.create(LocalizedNumbers, numRaw);

    showField('de-DE number:', numRaw.germanNumber, numResult.germanNumber);
    showField('en-US number:', numRaw.americanNumber, numResult.americanNumber);
    showField('currency:', numRaw.price, numResult.price);
    showField('negative:', numRaw.negativePrice, numResult.negativePrice);
}

// ── Demo 4: Date and number formatting ──────────────────────────────────────

@UseSinglePassValidation()
class FormattedReceipt {
    @Copy()
    @CoerceFormat('date', { format: 'medium-date', locales: 'en-US' })
    orderDate!: string;

    @Copy()
    @CoerceFormat('date', { format: 'iso-date' })
    isoDate!: string;

    @Copy()
    @CoerceFormat('number', {
        locales: 'en-US',
        numberOptions: { style: 'currency', currency: 'USD' },
    })
    total!: string;

    @Copy()
    @CoerceFormat('number', {
        locales: 'de-DE',
        numberOptions: { style: 'currency', currency: 'EUR' },
    })
    euroTotal!: string;

    @Copy()
    @CoerceFormat('number', {
        locales: 'en-US',
        numberOptions: { style: 'percent', minimumFractionDigits: 1 },
    })
    taxRate!: string;
}

async function demoFormatting(): Promise<void> {
    header('Demo 4: Formatting (@CoerceFormat)');
    console.log('  Convert dates and numbers to display-ready strings.\n');

    const factory = new ValidationFactory();

    const raw = {
        orderDate: '2024-03-15',
        isoDate: 'March 15, 2024',
        total: 1234.56,
        euroTotal: 1234.56,
        taxRate: 0.085,
    };

    const result = await factory.create(FormattedReceipt, raw);

    showField('medium-date:', raw.orderDate, result.orderDate);
    showField('iso-date:', raw.isoDate, result.isoDate);
    showField('USD:', raw.total, result.total);
    showField('EUR:', raw.euroTotal, result.euroTotal);
    showField('percent:', raw.taxRate, result.taxRate);
}

// ── Demo 5: Custom normalizer ───────────────────────────────────────────────

// Register a custom normalizer for company codes
TextNormalizerRegistry.register({
    name: 'company-code',
    description: 'Normalize company codes to uppercase with dashes',
    normalize(input: string): string {
        return input.trim().toUpperCase().replace(/[\s_]+/g, '-');
    },
});

@UseSinglePassValidation()
class VendorRecord {
    @NormalizeText('company-code')
    vendorCode!: string;

    @NormalizeText('company-code')
    partnerCode!: string;
}

async function demoCustomNormalizer(): Promise<void> {
    header('Demo 5: Custom Normalizer (TextNormalizerRegistry.register)');
    console.log('  Registered custom "company-code" normalizer.\n');

    const factory = new ValidationFactory();

    const raw = {
        vendorCode: 'acme  corp_intl',
        partnerCode: '  global_tech  solutions  ',
    };

    const result = await factory.create(VendorRecord, raw);

    showField('vendor:', raw.vendorCode, result.vendorCode);
    showField('partner:', raw.partnerCode, result.partnerCode);
}

// ── Demo 6: Custom parser ───────────────────────────────────────────────────

// Register a custom CSV row parser
ParserRegistry.register({
    name: 'csv-row',
    description: 'Parse a single CSV row into an array of strings',
    parse(input: string): string[] {
        return input.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
    },
});

@UseSinglePassValidation()
class ImportRecord {
    @CoerceParse('csv-row')
    fields!: string[];
}

async function demoCustomParser(): Promise<void> {
    header('Demo 6: Custom Parser (ParserRegistry.register)');
    console.log('  Registered custom "csv-row" parser.\n');

    const factory = new ValidationFactory();

    const testCases = [
        '"Alice","Smith","Engineer"',
        '"Bob","Jones","Designer"',
        '"Carol","Williams","Manager"',
    ];

    for (const raw of testCases) {
        const result = await factory.create(ImportRecord, { fields: raw });
        console.log(`  ${raw.padEnd(40)} → ${JSON.stringify(result.fields)}`);
    }
}

// ── Demo 7: Combining normalizers with validation ───────────────────────────

@UseSinglePassValidation()
class RegistrationForm {
    @ValidateRequired()
    @NormalizeText('email')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    email!: string;

    @ValidateRequired()
    @NormalizeText('phone')
    @ValidateLength(10, 11)
    phone!: string;

    @ValidateRequired()
    @NormalizeText('us-zip')
    @ValidatePattern(/^\d{5}$/)
    zip!: string;
}

async function demoNormalizeThenValidate(): Promise<void> {
    header('Demo 7: Normalize + Validate Pipeline');
    console.log('  Normalize first, then validate the cleaned value.\n');

    const factory = new ValidationFactory();

    // Valid input
    const raw = {
        email: '  USER@example.COM  ',
        phone: '(555) 123-4567',
        zip: '07701',
    };

    const result = await factory.create(RegistrationForm, raw);

    showField('email:', raw.email, result.email);
    showField('phone:', raw.phone, result.phone);
    showField('zip:', raw.zip, result.zip);

    // Invalid input — too-short phone after normalization
    try {
        await factory.create(RegistrationForm, {
            email: 'valid@test.com',
            phone: '555',      // Only 3 digits after normalization
            zip: '07701',
        });
        console.log('\n  Unexpectedly accepted short phone.');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n  Short phone rejected: ${msg.slice(0, 80)}`);
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log('=== Built-In Transforms and Extensible Registries ===');
    console.log('Demonstrating TextNormalizerRegistry, ParserRegistry, and CoerceFormat.\n');

    await demoTextNormalizers();
    await demoNormalizerChaining();
    await demoParsers();
    await demoFormatting();
    await demoCustomNormalizer();
    await demoCustomParser();
    await demoNormalizeThenValidate();

    console.log('\n' + '─'.repeat(57));
    console.log('Done. All demos completed.');
}

main().catch(console.error);
