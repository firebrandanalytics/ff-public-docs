/**
 * LLM Output Canonicalization
 *
 * Demonstrates how to clean and normalize structured data extracted by LLMs.
 * Covers type coercion (string-to-number, string-to-date), whitespace trimming,
 * case normalization, phone number formatting, email cleanup, and pattern validation.
 *
 * Run:  npx tsx llm-output-canonicalization.ts
 */

import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceType,
  CoerceCase,
  Coerce,
  ValidateRange,
  ValidatePattern,
  ValidateLength,
  UseStyle,
  DefaultTransforms,
  ManageAll,
  Examples,
  DerivedFrom,
  ValidationError,
} from '@firebrandanalytics/shared-utils/validation';

// ============================================================
// Reusable styles
// ============================================================

class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
  value!: string;
}

class SkuStyle {
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{3}-\d{3}$/, 'SKU must match AAA-999 format')
  value!: string;
}

// ============================================================
// Class 1 -- Basic LLM order canonicalization
// ============================================================

class LLMOrder {
  @UseStyle(EmailStyle)
  customer_email!: string;

  @CoerceType('number')
  @ValidateRange(1, 10_000)
  @Examples([1, 50, 250], 'Positive integer quantity')
  quantity!: number;

  @UseStyle(SkuStyle)
  @Examples(['WID-001', 'GAD-002'], 'Product SKU')
  sku!: string;

  @CoerceType('date')
  @ValidateRequired()
  order_date!: Date;

  // Strip non-digit characters to normalize phone numbers from LLM output
  @CoerceTrim()
  @Coerce((v: string) => {
    const digits = v.replace(/\D/g, '');
    // Strip leading US country code '1' if present (11 digits -> 10)
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  })
  @ValidatePattern(/^\d{10}$/, 'Phone must be 10 digits')
  phone!: string;

  @CoerceTrim()
  @CoerceCase('lower')
  priority!: string;
}

// ============================================================
// Class 2 -- Contact card with DefaultTransforms
// ============================================================

class TrimStyle { @CoerceTrim() value!: string; }

@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class LLMContactCard {
  @CoerceCase('title') @ValidateRequired() @ValidateLength(1, 100)
  full_name!: string;

  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email')
  email!: string;

  @Coerce((v: string) => {
    const digits = v.replace(/\D/g, '');
    // Strip leading US country code '1' if present (11 digits -> 10)
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  })
  @ValidatePattern(/^\d{10}$/)
  phone!: string;

  @CoerceCase('lower')
  company!: string;

  @CoerceCase('title')
  job_title!: string;
}

// ============================================================
// Class 3 -- Product listing with derived fields
// ============================================================

const PRICE_TABLE: Record<string, number> = {
  'WID-001': 19.99, 'GAD-002': 49.50, 'TOY-100': 9.99,
};

class LLMProductListing {
  @UseStyle(SkuStyle) @ValidateRequired() sku!: string;
  @CoerceTrim() @CoerceCase('title') @ValidateLength(1, 200) product_name!: string;
  @CoerceType('number') @ValidateRange(1, 10_000) quantity!: number;

  @DerivedFrom('sku', (sku: string) => PRICE_TABLE[sku] ?? 0)
  unit_price!: number;

  @DerivedFrom('quantity', (q: number, { instance }: { instance: any }) =>
    Math.round(q * (instance.unit_price ?? 0) * 100) / 100)
  line_total!: number;
}

// ============================================================
// Helpers
// ============================================================

function fmt(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'string' ? `"${v}"` : String(v);
}

function printObj(label: string, obj: Record<string, unknown>): void {
  console.log(`  ${label}:`);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') continue;
    const tag = v instanceof Date ? 'Date' : typeof v;
    console.log(`    ${k.padEnd(18)}: ${fmt(v).padEnd(32)} (${tag})`);
  }
}

// ============================================================
// Demos
// ============================================================

async function demoOrder(factory: ValidationFactory): Promise<void> {
  console.log('\n--- Demo 1: LLM Order Canonicalization ---\n');

  const raw = {
    customer_email: '  JANE@EXAMPLE.COM  ',
    quantity: '12',
    sku: '  wid-001 ',
    order_date: 'January 15, 2025',
    phone: '(555) 867-5309',
    priority: '  HIGH ',
  };

  printObj('BEFORE', raw);
  const order = await factory.create(LLMOrder, raw);
  console.log();
  printObj('AFTER', order as unknown as Record<string, unknown>);
}

async function demoContact(factory: ValidationFactory): Promise<void> {
  console.log('\n--- Demo 2: Contact Card (DefaultTransforms) ---\n');

  const raw = {
    full_name: '  jOHN   mCcARTHY  ',
    email: '  JOHN.MCCARTHY@EXAMPLE.COM  ',
    phone: '1 (415) 555-0198',
    company: '   ACME WIDGETS INC   ',
    job_title: '  SENIOR ENGINEER  ',
  };

  printObj('BEFORE', raw);
  const contact = await factory.create(LLMContactCard, raw);
  console.log();
  printObj('AFTER', contact as unknown as Record<string, unknown>);
}

async function demoProduct(factory: ValidationFactory): Promise<void> {
  console.log('\n--- Demo 3: Product Listing (Derived Fields) ---\n');

  const raw = { sku: ' wid-001 ', product_name: '  DELUXE WIDGET  ', quantity: '25' };

  printObj('BEFORE', raw);
  const p = await factory.create(LLMProductListing, raw);
  console.log();
  printObj('AFTER', p as unknown as Record<string, unknown>);
  console.log(`    >> ${p.quantity} x $${p.unit_price} = $${p.line_total}`);
}

async function demoBatch(factory: ValidationFactory): Promise<void> {
  console.log('\n--- Demo 4: Batch Processing ---\n');

  const batch = [
    { customer_email: ' BOB@CO.COM ',  quantity: '5',  sku: 'gad-002', order_date: '2025-03-01',    phone: '5551234567',    priority: 'low' },
    { customer_email: 'alice@co.com',   quantity: '20', sku: ' WID-001', order_date: '2025-03-02',    phone: '5559876543',    priority: 'MEDIUM' },
    { customer_email: 'bad-email',      quantity: '-5', sku: 'INVALID',  order_date: '',              phone: 'not-a-phone',   priority: 'high' },   // will fail
    { customer_email: '  EVE@CO.COM ', quantity: '3',  sku: 'toy-100',  order_date: 'March 5, 2025', phone: '(555) 000-1111', priority: '  HIGH ' },
  ];

  console.log(`  Processing ${batch.length} records...\n`);

  const results = await Promise.allSettled(
    batch.map((r) => factory.create(LLMOrder, r))
  );

  let ok = 0, fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      ok++;
      const o = r.value;
      console.log(`  [OK]   #${i + 1}: ${o.customer_email} -- ${o.quantity}x ${o.sku}`);
    } else {
      fail++;
      const e = r.reason;
      const msg = e instanceof ValidationError ? `${e.propertyPath}: ${e.message}` : String(e);
      console.log(`  [FAIL] #${i + 1}: ${msg}`);
    }
  }

  console.log(`\n  Summary: ${ok} succeeded, ${fail} failed out of ${batch.length}`);
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log('=== LLM Output Canonicalization Examples ===');

  const factory = new ValidationFactory();

  await demoOrder(factory);
  await demoContact(factory);
  await demoProduct(factory);
  await demoBatch(factory);

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
