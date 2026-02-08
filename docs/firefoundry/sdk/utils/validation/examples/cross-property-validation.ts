/**
 * Cross-Property Validation
 *
 * Demonstrates how to validate interdependent fields using @CrossValidate,
 * @ObjectRule, and @DerivedFrom with the convergent engine. Covers computed
 * totals, date range checks, conditional shipping requirements, and
 * currency-precise rounding with @CoerceRound.
 *
 * Run:
 *   npx tsx cross-property-validation.ts
 */

import {
  ValidationFactory,
  Copy,
  CoerceType,
  CoerceRound,
  CrossValidate,
  ObjectRule,
  DerivedFrom,
  ValidateRequired,
  ValidateRange,
  Validate,
  ValidationError,
} from '@firebrandanalytics/shared-utils/validation';

// ── Constants ────────────────────────────────────────────────────────────────

const TAX_RATE = 0.08;

// ── OrderForm class ──────────────────────────────────────────────────────────

@ObjectRule((obj) => {
  if (obj.shippingMethod === 'express' && obj.subtotal < 50) {
    return 'Express shipping requires a minimum order of $50';
  }
  return true;
}, 'Express shipping minimum')
class OrderForm {
  @CoerceType('date')
  @ValidateRequired()
  startDate!: Date;

  @CoerceType('date')
  @ValidateRequired()
  @CrossValidate(['startDate'], function (this: OrderForm) {
    if (this.endDate <= this.startDate) {
      return 'End date must be after start date';
    }
    return true;
  }, 'Date range check')
  endDate!: Date;

  @CoerceType('number')
  @ValidateRange(1, 10_000)
  quantity!: number;

  @CoerceType('number')
  @ValidateRange(0.01, 99_999.99)
  unitPrice!: number;

  @Copy()
  @Validate((v: string) =>
    ['standard', 'express'].includes(v) || 'Shipping method must be "standard" or "express"'
  )
  shippingMethod!: string;

  // ── Derived fields ──────────────────────────────────────

  @DerivedFrom(
    ['quantity', 'unitPrice'],
    ([qty, price]: [number, number]) => qty * price
  )
  @CoerceRound({ precision: 2 })
  subtotal!: number;

  @DerivedFrom('subtotal', (subtotal: number) => subtotal * TAX_RATE)
  @CoerceRound({ precision: 2 })
  tax!: number;

  @DerivedFrom('subtotal', (subtotal: number) =>
    subtotal >= 100 ? 0 : 9.99
  )
  @CoerceRound({ precision: 2 })
  shipping!: number;

  @DerivedFrom(
    ['subtotal', 'tax', 'shipping'],
    ([sub, tax, ship]: [number, number, number]) => sub + tax + ship
  )
  @CoerceRound({ precision: 2 })
  total!: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function header(title: string): void {
  console.log(`\n-- ${title} ---`);
}

function errorMessage(err: unknown): string {
  if (err instanceof ValidationError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function printOrder(order: OrderForm): void {
  const shippingNote = order.shipping === 0
    ? '(free: subtotal >= $100)'
    : '(under $100 threshold)';
  console.log(`  subtotal       : $${order.subtotal.toFixed(2)}`);
  console.log(`  tax            : $${order.tax.toFixed(2)}`);
  console.log(`  shipping       : $${order.shipping.toFixed(2)}     ${shippingNote}`);
  console.log(`  total          : $${order.total.toFixed(2)}`);
  console.log(`  dates          : ${order.startDate.toISOString().slice(0, 10)} to ${order.endDate.toISOString().slice(0, 10)}`);
  console.log(`  shippingMethod : ${order.shippingMethod}`);
}

// ── Demo 1: Valid order, large subtotal (free shipping) ──────────────────────

async function demoValidLargeOrder(factory: ValidationFactory): Promise<void> {
  header('Demo 1: Valid Order (Standard Shipping, Large Order)');

  const order = await factory.create(OrderForm, {
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    quantity: 10,
    unitPrice: 25.0,
    shippingMethod: 'standard',
  });

  printOrder(order);
}

// ── Demo 2: Valid order, small subtotal (shipping applies) ───────────────────

async function demoValidSmallOrder(factory: ValidationFactory): Promise<void> {
  header('Demo 2: Valid Order (Standard Shipping, Small Order)');

  const order = await factory.create(OrderForm, {
    startDate: '2025-03-01',
    endDate: '2025-03-15',
    quantity: 3,
    unitPrice: 15.0,
    shippingMethod: 'standard',
  });

  printOrder(order);
}

// ── Demo 3: Date range violation ─────────────────────────────────────────────

async function demoDateRangeViolation(factory: ValidationFactory): Promise<void> {
  header('Demo 3: Date Range Violation');

  try {
    await factory.create(OrderForm, {
      startDate: '2025-06-15',
      endDate: '2025-06-10',
      quantity: 5,
      unitPrice: 10.0,
      shippingMethod: 'standard',
    });
    console.log('  Unexpectedly passed -- this should not happen.');
  } catch (err: unknown) {
    console.log(`  [FAIL] ${errorMessage(err)}`);
  }
}

// ── Demo 4: Express shipping under $50 ───────────────────────────────────────

async function demoExpressUnderMinimum(factory: ValidationFactory): Promise<void> {
  header('Demo 4: Express Shipping Under $50');

  try {
    await factory.create(OrderForm, {
      startDate: '2025-02-01',
      endDate: '2025-02-14',
      quantity: 2,
      unitPrice: 10.0,
      shippingMethod: 'express',
    });
    console.log('  Unexpectedly passed -- this should not happen.');
  } catch (err: unknown) {
    console.log(`  [FAIL] ${errorMessage(err)}`);
  }
}

// ── Demo 5: Valid express order above $50 ────────────────────────────────────

async function demoValidExpressOrder(factory: ValidationFactory): Promise<void> {
  header('Demo 5: Valid Express Order (Above $50)');

  const order = await factory.create(OrderForm, {
    startDate: '2025-04-01',
    endDate: '2025-04-30',
    quantity: 5,
    unitPrice: 15.0,
    shippingMethod: 'express',
  });

  printOrder(order);
}

// ── Demo 6: Batch processing with mixed valid/invalid orders ────────────────

async function demoBatchProcessing(factory: ValidationFactory): Promise<void> {
  header('Demo 6: Batch Processing (Mixed Valid/Invalid)');

  const orders = [
    { startDate: '2025-01-01', endDate: '2025-01-15', quantity: 20, unitPrice: 12.50, shippingMethod: 'standard' },
    { startDate: '2025-02-20', endDate: '2025-02-10', quantity: 3,  unitPrice: 30.00, shippingMethod: 'standard' },
    { startDate: '2025-03-01', endDate: '2025-03-31', quantity: 1,  unitPrice: 8.00,  shippingMethod: 'express'  },
    { startDate: '2025-04-01', endDate: '2025-04-15', quantity: 50, unitPrice: 5.00,  shippingMethod: 'standard' },
    { startDate: '2025-05-01', endDate: '2025-05-31', quantity: 8,  unitPrice: 9.99,  shippingMethod: 'express'  },
  ];

  console.log(`\n  Processing ${orders.length} orders...\n`);

  const results = await Promise.allSettled(
    orders.map((raw) => factory.create(OrderForm, raw))
  );

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successCount++;
      const o = result.value;
      console.log(`  [OK]   Order ${i + 1}: ${o.quantity}x $${o.unitPrice.toFixed(2)} = $${o.total.toFixed(2)} (${o.shippingMethod})`);
    } else {
      failCount++;
      console.log(`  [FAIL] Order ${i + 1}: ${errorMessage(result.reason)}`);
    }
  }

  console.log(`\n  Summary: ${successCount} succeeded, ${failCount} failed out of ${orders.length}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Cross-Property Validation ===');
  console.log('Validating interdependent fields with @CrossValidate, @ObjectRule, and @DerivedFrom.\n');

  const factory = new ValidationFactory();

  await demoValidLargeOrder(factory);
  await demoValidSmallOrder(factory);
  await demoDateRangeViolation(factory);
  await demoExpressUnderMinimum(factory);
  await demoValidExpressOrder(factory);
  await demoBatchProcessing(factory);

  console.log('\n' + '-'.repeat(57));
  console.log('Done. All demos completed.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
