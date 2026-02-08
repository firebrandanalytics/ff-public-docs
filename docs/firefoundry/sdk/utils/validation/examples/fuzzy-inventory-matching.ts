/**
 * Fuzzy Inventory Matching
 *
 * Demonstrates how @CoerceFromSet matches misspelled product names, status
 * values, and numeric price tiers against canonical sets provided at runtime
 * via context. Covers fuzzy string matching, synonym maps, numeric tolerance,
 * and object matching with selectors.
 *
 * Run:
 *   npx tsx fuzzy-inventory-matching.ts
 */

import {
    ValidationFactory,
    Copy,
    CoerceFromSet,
    CoerceType,
    ValidateRequired,
    ValidateRange,
} from '@firebrandanalytics/shared-utils/validation';

// ── Context interfaces ──────────────────────────────────────────────────────

interface InventoryContext {
    productCatalog: string[];
    validStatuses: string[];
    priceTiers: number[];
}

interface ProductCatalogContext {
    products: { id: number; name: string; sku: string }[];
}

// ── Validated classes ───────────────────────────────────────────────────────

/** Fuzzy product matching against a flat string catalog. */
class ProductOrder {
    @ValidateRequired()
    @Copy()
    orderId!: string;

    @CoerceFromSet<InventoryContext>(
        ctx => ctx.productCatalog,
        { strategy: 'fuzzy', fuzzyThreshold: 0.7 }
    )
    product!: string;

    @CoerceType('number')
    @ValidateRange(1, 10000)
    quantity!: number;
}

/** Status matching with synonyms for common misspellings and alternate phrases. */
class ShipmentUpdate {
    @ValidateRequired()
    @Copy()
    trackingId!: string;

    @CoerceFromSet<InventoryContext>(
        ctx => ctx.validStatuses,
        {
            strategy: 'fuzzy',
            fuzzyThreshold: 0.6,
            synonyms: {
                'Shipped':    ['shiped', 'shipd', 'sent', 'dispatched'],
                'In Transit': ['in transit', 'on the way', 'en route'],
                'Delivered':  ['deliverd', 'recieved', 'arrived'],
                'Pending':    ['pending', 'waiting', 'queued'],
                'Cancelled':  ['cancled', 'canceled', 'voided'],
            },
        }
    )
    status!: string;
}

/** Numeric price-tier snapping with tolerance. */
class PricedItem {
    @ValidateRequired()
    @Copy()
    itemName!: string;

    @CoerceFromSet<InventoryContext>(
        ctx => ctx.priceTiers,
        { strategy: 'numeric', numericTolerance: 1.0 }
    )
    priceTier!: number;
}

/** Object matching using a selector -- returns the full catalog object. */
class CatalogOrder {
    @ValidateRequired()
    @Copy()
    orderId!: string;

    @CoerceFromSet<ProductCatalogContext>(
        ctx => ctx.products,
        {
            strategy: 'fuzzy',
            fuzzyThreshold: 0.7,
            selector: (product: { name: string }) => product.name,
        }
    )
    product!: { id: number; name: string; sku: string };
}

// ── Shared context data ─────────────────────────────────────────────────────
const inventoryContext: InventoryContext = {
    productCatalog: [
        'MacBook Pro',
        'MacBook Air',
        'iPad Pro',
        'iPhone 15',
        'AirPods Max',
        'Apple Watch Ultra',
        'Mac Mini',
        'Studio Display',
    ],
    validStatuses: ['Pending', 'Shipped', 'In Transit', 'Delivered', 'Cancelled'],
    priceTiers:    [49.99, 99.99, 149.99, 249.99, 499.99, 999.99],
};

const catalogContext: ProductCatalogContext = {
    products: [
        { id: 101, name: 'MacBook Pro', sku: 'MBP-2024-14' },
        { id: 102, name: 'MacBook Air', sku: 'MBA-2024-13' },
        { id: 103, name: 'iPad Pro',    sku: 'IPP-2024-12' },
        { id: 104, name: 'iPhone 15',   sku: 'IP15-256' },
        { id: 105, name: 'AirPods Max', sku: 'APM-2024' },
    ],
};

const factory = new ValidationFactory();

// ── Helpers ─────────────────────────────────────────────────────────────────
function header(title: string): void {
    console.log(`\n${'─'.repeat(2)} ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

function showMatch(input: unknown, output: unknown, note: string): void {
    const inp = JSON.stringify(input);
    const out = JSON.stringify(output);
    console.log(`  ${inp.padEnd(22)} => ${out.padEnd(22)} (${note})`);
}

// ── Demo 1: Basic fuzzy product matching ────────────────────────────────────

async function demoFuzzyProducts(): Promise<void> {
    header('Demo 1: Basic Fuzzy Product Matching');

    const testCases = [
        { orderId: 'PO-001', product: 'macbok pro',   quantity: '5'  },
        { orderId: 'PO-002', product: 'ipd pro',      quantity: '10' },
        { orderId: 'PO-003', product: 'airpods maks', quantity: '20' },
        { orderId: 'PO-004', product: 'Mac Mini',     quantity: '3'  },
        { orderId: 'PO-005', product: 'aple watch',   quantity: '7'  },
    ];

    for (const raw of testCases) {
        const result = await factory.create(ProductOrder, raw, { context: inventoryContext });
        showMatch(raw.product, result.product, 'fuzzy, threshold 0.7');
    }
}

// ── Demo 2: Status matching with synonyms ───────────────────────────────────

async function demoStatusSynonyms(): Promise<void> {
    header('Demo 2: Status Matching with Synonyms');

    const testCases = [
        { trackingId: 'TRK-001', status: 'shiped' },
        { trackingId: 'TRK-002', status: 'on the way' },
        { trackingId: 'TRK-003', status: 'deliverd' },
        { trackingId: 'TRK-004', status: 'cancled' },
        { trackingId: 'TRK-005', status: 'Pending' },
        { trackingId: 'TRK-006', status: 'dispatched' },
    ];

    for (const raw of testCases) {
        const result = await factory.create(ShipmentUpdate, raw, { context: inventoryContext });
        const note = inventoryContext.validStatuses.some(
            s => s.toLowerCase() === raw.status.toLowerCase()
        )
            ? 'exact match'
            : 'synonym / fuzzy';
        showMatch(raw.status, result.status, note);
    }
}

// ── Demo 3: Numeric price-tier matching ─────────────────────────────────────

async function demoNumericMatching(): Promise<void> {
    header('Demo 3: Numeric Price-Tier Matching');

    const testCases = [
        { itemName: 'Widget A',  priceTier: 250 },
        { itemName: 'Widget B',  priceTier: 100.5 },
        { itemName: 'Widget C',  priceTier: 50 },
        { itemName: 'Widget D',  priceTier: 499.5 },
        { itemName: 'Widget E',  priceTier: 149.99 },
    ];

    for (const raw of testCases) {
        const result = await factory.create(PricedItem, raw, { context: inventoryContext });
        const distance = Math.abs(raw.priceTier - result.priceTier).toFixed(2);
        showMatch(raw.priceTier, result.priceTier, `numeric, distance ${distance}`);
    }
}

// ── Demo 4: Object matching with selector ───────────────────────────────────

async function demoObjectMatching(): Promise<void> {
    header('Demo 4: Object Matching with Selector');

    const testCases = [
        { orderId: 'CO-001', product: 'macbok pro' },
        { orderId: 'CO-002', product: 'ipd pro' },
        { orderId: 'CO-003', product: 'airpods maks' },
    ];

    for (const raw of testCases) {
        const result = await factory.create(CatalogOrder, raw, { context: catalogContext });
        console.log(`  ${JSON.stringify(raw.product).padEnd(22)} => ${JSON.stringify(result.product)}`);
    }
    console.log('\n  Note: The full catalog object (id, name, sku) is returned, not just the name.');
}

// ── Demo 5: Threshold rejection ─────────────────────────────────────────────

async function demoThresholdRejection(): Promise<void> {
    header('Demo 5: Threshold Rejection');

    try {
        await factory.create(ProductOrder,
            { orderId: 'PO-999', product: 'xylophone', quantity: '1' },
            { context: inventoryContext },
        );
        console.log('  Unexpectedly matched -- this should not happen.');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  Input:   "xylophone"`);
        console.log(`  Result:  Rejected (no candidate above threshold 0.7)`);
        console.log(`  Error:   ${msg.slice(0, 100)}`);
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log('=== Fuzzy Inventory Matching ===');
    console.log('Matching misspelled values against canonical sets using @CoerceFromSet.\n');
    await demoFuzzyProducts();
    await demoStatusSynonyms();
    await demoNumericMatching();
    await demoObjectMatching();
    await demoThresholdRejection();
    console.log('\n' + '─'.repeat(57));
    console.log('Done. All demos completed.');
}

main().catch(console.error);
