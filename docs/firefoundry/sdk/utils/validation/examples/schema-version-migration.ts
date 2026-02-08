/**
 * Schema Version Migration
 *
 * Demonstrates how to use discriminated unions and version-specific
 * transformation classes to migrate data from multiple schema versions
 * into a single canonical structure.
 *
 * Run:  npx tsx schema-version-migration.ts
 */

import {
  ValidationFactory,
  Copy,
  Discriminator,
  DerivedFrom,
  Validate,
  Staging,
} from '@firebrandanalytics/shared-utils/validation';

// ---------------------------------------------------------------------------
// Canonical output type -- all version classes produce this shape
// ---------------------------------------------------------------------------

type CanonicalPreferences = {
  version: number;
  appearance: { colorTheme: string; fontScale: number; language: string };
  alerts: { channels: string[] };
};

// ---------------------------------------------------------------------------
// V1 migration: flat fields -> canonical V3
// Input shape: { version: 1, theme: "dark", fontSize: 16 }
// ---------------------------------------------------------------------------

class V1Preferences {
  @Discriminator(1)
  version: number;

  @DerivedFrom(
    ['$.theme', '$.fontSize'],
    ([theme, fontSize]: [string | undefined, number | undefined]) => ({
      colorTheme: theme ?? 'light',
      fontScale: typeof fontSize === 'number' ? fontSize : 14,
      language: 'en',
    })
  )
  appearance: { colorTheme: string; fontScale: number; language: string };

  @DerivedFrom('$.version', () => ({ channels: ['email'] }))
  alerts: { channels: string[] };
}

// ---------------------------------------------------------------------------
// V2 migration: categorized fields -> canonical V3
// Input shape: { version: 2, display: { theme, fontSize },
//                notifications: { email: true, push: false } }
// ---------------------------------------------------------------------------

class V2Preferences {
  @Discriminator(2)
  version: number;

  @DerivedFrom(
    ['$.display.theme', '$.display.fontSize'],
    ([theme, fontSize]: [string | undefined, number | undefined]) => ({
      colorTheme: theme ?? 'light',
      fontScale: typeof fontSize === 'number' ? fontSize : 14,
      language: 'en',
    })
  )
  appearance: { colorTheme: string; fontScale: number; language: string };

  @DerivedFrom(
    ['$.notifications.email', '$.notifications.push'],
    ([email, push]: [boolean | undefined, boolean | undefined]) => {
      const channels: string[] = [];
      if (email) channels.push('email');
      if (push) channels.push('push');
      if (channels.length === 0) channels.push('email');
      return { channels };
    }
  )
  alerts: { channels: string[] };
}

// ---------------------------------------------------------------------------
// V3 pass-through: input already matches canonical shape
// ---------------------------------------------------------------------------

class V3Preferences {
  @Discriminator(3)
  version: number;

  @Copy()
  appearance: { colorTheme: string; fontScale: number; language: string };

  @Copy()
  alerts: { channels: string[] };
}

// ---------------------------------------------------------------------------
// V1 with @Staging: intermediate values removed from final output
// ---------------------------------------------------------------------------

class V1WithStaging {
  @Discriminator(1)
  version: number;

  @DerivedFrom('$.theme')
  @Staging()
  rawTheme: string;

  @DerivedFrom('$.fontSize')
  @Staging()
  rawFontSize: number;

  @DerivedFrom(
    ['rawTheme', 'rawFontSize'],
    ([theme, fontSize]: [string | undefined, number | undefined]) => ({
      colorTheme: theme ?? 'light',
      fontScale: typeof fontSize === 'number' ? fontSize : 14,
      language: 'en',
    })
  )
  @Validate(
    (a: { fontScale: number }) => a.fontScale >= 10 && a.fontScale <= 24,
    'Font scale must be between 10 and 24'
  )
  appearance: { colorTheme: string; fontScale: number; language: string };

  @DerivedFrom('$.version', () => ({ channels: ['email'] }))
  alerts: { channels: string[] };
}

// ---------------------------------------------------------------------------
// Migration registry and test data
// ---------------------------------------------------------------------------

const MIGRATIONS = [V1Preferences, V2Preferences, V3Preferences];

const testInputs: Record<string, any>[] = [
  { version: 1, theme: 'dark', fontSize: 16 },
  { version: 1, theme: 'light' },  // missing fontSize -- default applied
  { version: 2, display: { theme: 'dark', fontSize: 16 },
    notifications: { email: true, push: false } },
  { version: 2, display: { theme: 'light', fontSize: 14 },
    notifications: { email: true, push: true } },
  { version: 3, appearance: { colorTheme: 'dark', fontScale: 16, language: 'en' },
    alerts: { channels: ['email'] } },
  { version: 3, appearance: { colorTheme: 'light', fontScale: 14, language: 'fr' },
    alerts: { channels: ['email', 'push', 'sms'] } },
];

// -- Helpers ---------------------------------------------------------------

function fmt(prefs: CanonicalPreferences): string {
  const { appearance: a, alerts } = prefs;
  const ch = alerts.channels.map((c) => `"${c}"`).join(', ');
  return `{ colorTheme: "${a.colorTheme}", fontScale: ${a.fontScale}, `
    + `language: "${a.language}", channels: [${ch}] }`;
}

function heading(title: string): void {
  console.log();
  console.log(`-- ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

// -- Demo 1: Migrate all three versions ------------------------------------

async function demoMigrateAll(factory: ValidationFactory): Promise<void> {
  heading('Demo 1: Migrate V1, V2, and V3 inputs to canonical V3');

  for (const input of testInputs) {
    const result = await factory.create(MIGRATIONS, input) as unknown as CanonicalPreferences;
    console.log(`  V${input.version} ${JSON.stringify(input)}`);
    console.log(`     -> ${fmt(result)}`);
    console.log();
  }
}

// -- Demo 2: Equivalence check ---------------------------------------------

async function demoEquivalence(factory: ValidationFactory): Promise<void> {
  heading('Demo 2: Equivalence (same data encoded in V1, V2, V3)');

  const equivalent = [
    { version: 1, theme: 'dark', fontSize: 16 },
    { version: 2, display: { theme: 'dark', fontSize: 16 },
      notifications: { email: true, push: false } },
    { version: 3, appearance: { colorTheme: 'dark', fontScale: 16, language: 'en' },
      alerts: { channels: ['email'] } },
  ];

  const results: CanonicalPreferences[] = [];
  for (const input of equivalent) {
    const r = await factory.create(MIGRATIONS, input) as unknown as CanonicalPreferences;
    results.push(r);
    console.log(`  V${input.version} -> ${fmt(r)}`);
  }

  const allMatch = results.every(
    (r) =>
      r.appearance.colorTheme === results[0].appearance.colorTheme &&
      r.appearance.fontScale === results[0].appearance.fontScale &&
      r.appearance.language === results[0].appearance.language &&
      JSON.stringify(r.alerts.channels) === JSON.stringify(results[0].alerts.channels)
  );

  console.log();
  console.log(allMatch
    ? '  All three versions produced identical canonical output.'
    : '  WARNING: Outputs differ across versions!');
}

// -- Demo 3: @Staging removes intermediate properties ----------------------

async function demoStaging(factory: ValidationFactory): Promise<void> {
  heading('Demo 3: @Staging for intermediate migration values');

  const STAGING_MIGRATIONS = [V1WithStaging, V2Preferences, V3Preferences];
  const input = { version: 1, theme: 'dark', fontSize: 16 };
  const result = await factory.create(STAGING_MIGRATIONS, input) as unknown as CanonicalPreferences;

  console.log(`  Input:  ${JSON.stringify(input)}`);
  console.log(`  Output: ${fmt(result)}`);

  const stagingAbsent = !('rawTheme' in result) && !('rawFontSize' in result);
  console.log(`  Staging properties absent from output: ${stagingAbsent ? 'yes' : 'NO -- leaked!'}`);
}

// -- Demo 4: Validation after migration ------------------------------------

async function demoValidation(factory: ValidationFactory): Promise<void> {
  heading('Demo 4: Post-migration validation catches bad legacy data');

  const STAGING_MIGRATIONS = [V1WithStaging, V2Preferences, V3Preferences];

  // Valid record
  const good = { version: 1, theme: 'dark', fontSize: 16 };
  const goodResult = await factory.create(STAGING_MIGRATIONS, good) as unknown as CanonicalPreferences;
  console.log(`  Valid:   fontSize 16 -> fontScale ${goodResult.appearance.fontScale} (accepted)`);

  // Invalid record: fontSize outside allowed range
  const bad = { version: 1, theme: 'dark', fontSize: 4 };
  try {
    await factory.create(STAGING_MIGRATIONS, bad);
    console.log('  Invalid: fontSize 4 -> accepted (unexpected)');
  } catch (err: any) {
    console.log(`  Invalid: fontSize 4 -> rejected: "${err.message}"`);
  }
}

// -- main ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Schema Version Migration ===');

  const factory = new ValidationFactory();

  await demoMigrateAll(factory);
  await demoEquivalence(factory);
  await demoStaging(factory);
  await demoValidation(factory);

  console.log();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
