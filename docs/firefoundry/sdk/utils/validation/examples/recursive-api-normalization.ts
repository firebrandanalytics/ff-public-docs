/**
 * Recursive API Normalization
 *
 * Demonstrates how to normalize deeply nested third-party API responses that
 * have inconsistent key casing, extra whitespace, and variable structure.
 * Covers class-level @MatchingStrategy for fuzzy key lookup, @DefaultTransforms
 * for blanket string cleaning, @ValidatedClass for nested sub-objects, and
 * @RecursiveValues for dynamic deep normalization.
 *
 * Run:  npx tsx recursive-api-normalization.ts
 */

import {
  ValidationFactory,
  ValidatedClass,
  MatchingStrategy,
  DefaultTransforms,
  ManageAll,
  CoerceTrim,
  CoerceCase,
  ValidateRequired,
  ValidatePattern,
  RecursiveValues,
  ValidationError,
} from '@firebrandanalytics/shared-utils/validation';

// ── Reusable styles ──────────────────────────────────────────

/** Auto-trim applied to every string property via @DefaultTransforms. */
class TrimStyle {
  @CoerceTrim()
  value!: string;
}

// ── Nested validated classes ─────────────────────────────────

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class Address {
  @CoerceCase('lower') @ValidateRequired() street!: string;
  @CoerceCase('lower') @ValidateRequired() city!: string;
  @CoerceCase('upper') state!: string;
  @ValidatePattern(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code') zipCode!: string;
}

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class ContactInfo {
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
  email!: string;

  @CoerceTrim()
  phone!: string;
}

// ── Top-level API response class ─────────────────────────────

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@DefaultTransforms({ string: TrimStyle })
@ManageAll()
class APICustomer {
  @CoerceCase('lower') @ValidateRequired() firstName!: string;
  @CoerceCase('lower') @ValidateRequired() lastName!: string;
  @ValidatedClass(Address) address!: Address;
  @ValidatedClass(ContactInfo) contactInfo!: ContactInfo;
  @CoerceCase('lower') accountType!: string;
}

// ── Dynamic payload class using @RecursiveValues ─────────────

@MatchingStrategy({ strategy: 'fuzzy', threshold: 0.7 })
@ManageAll()
class DynamicConfig {
  @CoerceTrim() @ValidateRequired() configName!: string;

  @RecursiveValues()
  @CoerceTrim()
  @CoerceCase('lower')
  settings!: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────

function printJson(label: string, obj: unknown): void {
  console.log(`\n--- ${label} ---`);
  for (const line of JSON.stringify(obj, null, 2).split('\n')) {
    console.log('  ' + line);
  }
}

function printFlat(label: string, obj: Record<string, unknown>, prefix = ''): void {
  if (!prefix) console.log(`\n--- ${label} ---`);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'function') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      printFlat(label, value as Record<string, unknown>, path);
    } else {
      const display = typeof value === 'string' ? `"${value}"` : String(value);
      console.log(`  ${path.padEnd(25)} : ${display}`);
    }
  }
}

// ── Demo 1 -- Nested API response normalization ──────────────

async function demoNestedNormalization(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 1: Nested API Response');
  console.log('========================================');

  const messyResponse = {
    'First_Name': '  JANE  ',
    '  LAST NAME ': '  DOE  ',
    'ADDRESS': {
      'STREET_address': '  123 MAIN ST  ',
      'City': '  SPRINGFIELD  ',
      'STATE': '  il  ',
      'Zip_Code': '62701',
    },
    'Contact_Info': {
      'E_MAIL': '  JANE.DOE@EXAMPLE.COM  ',
      'PHONE': '  (555) 123-4567  ',
    },
    'account_TYPE': '  PREMIUM  ',
  };

  printJson('Messy API response', messyResponse);
  const customer = await factory.create(APICustomer, messyResponse);
  printFlat('After normalization', customer as unknown as Record<string, unknown>);
}

// ── Demo 2 -- Same class, different API casing conventions ───

async function demoMultipleVersions(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 2: Different API Versions');
  console.log('========================================');

  const versions: { label: string; data: Record<string, unknown> }[] = [
    { label: 'v1 (snake_case)', data: {
      first_name: '  ALICE  ', last_name: '  SMITH  ',
      address: { street: '  456 OAK AVE  ', city: '  PORTLAND  ', state: '  or  ', zip_code: '97201' },
      contact_info: { email: '  ALICE@EXAMPLE.COM  ', phone: '  555-987-6543  ' },
      account_type: '  STANDARD  ',
    }},
    { label: 'v2 (UPPER_CASE)', data: {
      FIRST_NAME: '  BOB  ', LAST_NAME: '  JOHNSON  ',
      ADDRESS: { STREET: '  789 PINE RD  ', CITY: '  SEATTLE  ', STATE: '  wa  ', ZIP_CODE: '98101' },
      CONTACT_INFO: { EMAIL: '  BOB.J@EXAMPLE.COM  ', PHONE: '  (206) 555-0100  ' },
      ACCOUNT_TYPE: '  ENTERPRISE  ',
    }},
    { label: 'v3 (PascalCase)', data: {
      FirstName: '  CAROL  ', LastName: '  WILLIAMS  ',
      Address: { StreetAddress: '  321 ELM BLVD  ', City: '  DENVER  ', State: '  co  ', ZipCode: '80201' },
      ContactInfo: { Email: '  CAROL.W@EXAMPLE.COM  ', Phone: '  303-555-0200  ' },
      AccountType: '  BASIC  ',
    }},
  ];

  for (const { label, data } of versions) {
    const c = await factory.create(APICustomer, data);
    console.log(`\n  -- ${label} --`);
    console.log(`  name : "${c.firstName} ${c.lastName}"  city: "${c.address.city}"  state: "${c.address.state}"`);
    console.log(`  email: "${c.contactInfo.email}"  account: "${c.accountType}"`);
  }
}

// ── Demo 3 -- Dynamic config with @RecursiveValues ──────────

async function demoDynamicConfig(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 3: Dynamic Config (RecursiveValues)');
  console.log('========================================');

  const messyConfig = {
    Config_Name: '  APP_SETTINGS  ',
    Settings: {
      DATABASE: { HOST: '  LOCALHOST  ', PORT: '  5432  ', DB_NAME: '  MY_DATABASE  ' },
      CACHE:    { PROVIDER: '  REDIS  ', TTL: '  3600  ' },
      FLAGS:    { ENABLE_BETA: '  TRUE  ', DEBUG_MODE: '  FALSE  ' },
    },
  };

  printJson('Messy config', messyConfig);
  const config = await factory.create(DynamicConfig, messyConfig);
  console.log(`\n--- After normalization ---`);
  console.log(`  configName: "${config.configName}"`);
  printJson('settings (all values trimmed + lowercased)', config.settings);
}

// ── Demo 4 -- Error handling for unmatchable keys ────────────

async function demoErrorHandling(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 4: Error Handling');
  console.log('========================================');

  const badResponse = {
    xyzzy: '  JANE  ',             // cannot fuzzy-match "firstName"
    surname: '  DOE  ',            // cannot fuzzy-match "lastName"
    ADDRESS: {
      STREET_address: '  123 MAIN ST  ', City: '  SPRINGFIELD  ',
      STATE: '  il  ', Zip_Code: '62701',
    },
    Contact_Info: { E_MAIL: '  JANE@EXAMPLE.COM  ', PHONE: '  555-0000  ' },
    account_TYPE: '  PREMIUM  ',
  };

  try {
    await factory.create(APICustomer, badResponse);
    console.log('  Unexpectedly succeeded.');
  } catch (err: unknown) {
    const msg = err instanceof ValidationError
      ? `${err.propertyPath}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    console.log('  Input has keys that cannot fuzzy-match required properties.');
    console.log(`  Error: ${msg.slice(0, 120)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Recursive API Normalization ===');
  console.log('Normalizing inconsistent API responses with fuzzy key');
  console.log('matching and recursive value transforms.\n');

  const factory = new ValidationFactory();

  await demoNestedNormalization(factory);
  await demoMultipleVersions(factory);
  await demoDynamicConfig(factory);
  await demoErrorHandling(factory);

  console.log('\n' + '='.repeat(40));
  console.log(' Done. All demos completed.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
