# Schema Version Migration

Handle evolving data schemas with discriminated unions and version-specific transformation classes.

---

## The Problem

Your application has been running for years. User preferences data has gone through three schema versions as the product evolved:

- **V1 (2022)** stored flat fields: `{ version: 1, theme: "dark", fontSize: 14 }`.
- **V2 (2023)** grouped them under categories: `{ version: 2, display: { theme: "dark", fontSize: 14 }, notifications: { email: true, push: false } }`.
- **V3 (2024)** added new fields and renamed others: `{ version: 3, appearance: { colorTheme: "dark", fontScale: 14, language: "en" }, alerts: { channels: ["email"] } }`.

You need to read all three versions from your database and produce a canonical V3 structure so your application logic only deals with one shape. The traditional approach is a chain of `if/else` checks and manual migration functions -- tedious, error-prone, and scattered across your codebase. Every time you add V4, you touch the migration ladder again.

What you want is a set of self-contained transformation classes, one per version, each knowing how to reshape its own input into the canonical output. The library routes to the right class automatically based on the version field.

## The Strategy

**Discriminated union with version-specific transformation classes.** Each version gets its own class decorated to produce the canonical V3 structure. The `@Discriminator` decorator marks the version field, and `factory.create` receives an array of all version classes. At runtime, the library inspects the `version` property, selects the matching class, and runs its decorator pipeline.

| Aspect | Approach |
|--------|----------|
| Discriminator property | `version` field present on every record |
| Routing | `factory.create([V1Class, V2Class, V3Class], rawData)` inspects the discriminator and dispatches |
| Per-version reshaping | `@DerivedFrom` with JSONPath and transform functions maps old field locations to canonical positions |
| Default values | Transform functions supply sensible defaults for fields that did not exist in earlier versions |
| Pass-through | The canonical version class uses `@Copy()` since no reshaping is needed |

## Architecture

```
  Versioned input
  (version: 1, 2, or 3)
         |
         v
  +-----------------+
  | factory.create(  |
  |   [V1, V2, V3], |
  |   rawData       |
  | )                |
  +-----------------+
         |
         +--- version === 1 ---> V1Preferences (flat -> nested, add defaults)
         |
         +--- version === 2 ---> V2Preferences (rename categories, convert types)
         |
         +--- version === 3 ---> V3Preferences (pass-through)
         |
         v
  Canonical V3 output
  {
    version: 3,
    appearance: { colorTheme, fontScale, language },
    alerts: { channels: [...] }
  }
```

Each version class is self-contained. It reads from the raw input using `@DerivedFrom` with JSONPath expressions specific to that version's field layout, applies any necessary type conversions or default values, and outputs the canonical V3 shape. The factory never needs `if/else` logic -- it delegates entirely to the decorator metadata.

## Implementation

### 1. Define the canonical output type

All version classes produce this shape:

```typescript
type CanonicalPreferences = {
  version: number;
  appearance: {
    colorTheme: string;
    fontScale: number;
    language: string;
  };
  alerts: {
    channels: string[];
  };
};
```

### 2. V1 migration class: flat fields to nested V3

V1 input has `theme` and `fontSize` at the root level. There are no notification settings and no language field, so defaults are supplied.

```typescript
class V1Preferences {
  @Discriminator(1)
  version!: number;

  @DerivedFrom('version', (_v: number, { raw }: { raw: any }) => ({
    colorTheme: raw.theme ?? 'light',
    fontScale: typeof raw.fontSize === 'number' ? raw.fontSize : 14,
    language: 'en',
  }))
  appearance!: { colorTheme: string; fontScale: number; language: string };

  @DerivedFrom('version', () => ({
    channels: ['email'],
  }))
  alerts!: { channels: string[] };
}
```

`@DerivedFrom('version', fn)` derives from the `version` property (which is always set by the discriminator), and the transform function accesses the raw V1 fields through `ctx.raw`. The `alerts` property has no V1 source data, so the transform ignores the input and returns a sensible default.

### 3. V2 migration class: rename and restructure

V2 input has `display.theme`, `display.fontSize`, `notifications.email`, and `notifications.push`. These map to V3's `appearance` and `alerts` with renamed keys and a structural change (boolean flags become a channels array).

```typescript
class V2Preferences {
  @Discriminator(2)
  version!: number;

  @DerivedFrom('version', (_v: number, { raw }: { raw: any }) => ({
    colorTheme: raw.display?.theme ?? 'light',
    fontScale: typeof raw.display?.fontSize === 'number' ? raw.display.fontSize : 14,
    language: 'en',
  }))
  appearance!: { colorTheme: string; fontScale: number; language: string };

  @DerivedFrom('version', (_v: number, { raw }: { raw: any }) => {
    const channels: string[] = [];
    if (raw.notifications?.email) channels.push('email');
    if (raw.notifications?.push) channels.push('push');
    if (channels.length === 0) channels.push('email');
    return { channels };
  })
  alerts!: { channels: string[] };
}
```

The `alerts` transform converts V2's boolean notification flags into V3's channels array.

### 4. V3 pass-through class

V3 input already matches the canonical shape. `@Copy()` passes each property through unchanged.

```typescript
class V3Preferences {
  @Discriminator(3)
  version!: number;

  @Copy()
  appearance!: { colorTheme: string; fontScale: number; language: string };

  @Copy()
  alerts!: { channels: string[] };
}
```

### 5. Create and run

```typescript
const factory = new ValidationFactory();

const MIGRATIONS = [V1Preferences, V2Preferences, V3Preferences];

// V1 input
const v1Data = { version: 1, theme: 'dark', fontSize: 16 };
const fromV1 = await factory.create(MIGRATIONS, v1Data);

// V2 input
const v2Data = {
  version: 2,
  display: { theme: 'dark', fontSize: 16 },
  notifications: { email: true, push: false },
};
const fromV2 = await factory.create(MIGRATIONS, v2Data);

// V3 input
const v3Data = {
  version: 3,
  appearance: { colorTheme: 'dark', fontScale: 16, language: 'en' },
  alerts: { channels: ['email'] },
};
const fromV3 = await factory.create(MIGRATIONS, v3Data);

// All three produce the same canonical V3 structure
console.log(fromV1.appearance);  // { colorTheme: 'dark', fontScale: 16, language: 'en' }
console.log(fromV2.alerts);      // { channels: ['email'] }
console.log(fromV3.appearance);  // { colorTheme: 'dark', fontScale: 16, language: 'en' }
```

## What to Observe

When you run the [companion example](../examples/schema-version-migration.ts), three different version inputs all produce identical canonical output:

```
=== Schema Version Migration ===

--- V1 Input ---
  { version: 1, theme: "dark", fontSize: 16 }

--- V2 Input ---
  { version: 2, display: { theme: "dark", fontSize: 16 }, notifications: { email: true, push: false } }

--- V3 Input ---
  { version: 3, appearance: { colorTheme: "dark", fontScale: 16, language: "en" }, alerts: { channels: ["email"] } }

--- All outputs (canonical V3) ---
  V1 -> { appearance: { colorTheme: "dark", fontScale: 16, language: "en" }, alerts: { channels: ["email"] } }
  V2 -> { appearance: { colorTheme: "dark", fontScale: 16, language: "en" }, alerts: { channels: ["email"] } }
  V3 -> { appearance: { colorTheme: "dark", fontScale: 16, language: "en" }, alerts: { channels: ["email"] } }
```

All three results are structurally identical. Your application code never needs to know which version the data came from.

| Concept | Explanation |
|---------|-------------|
| **Discriminator routing** | The factory reads `version` from the raw input and selects the class whose `@Discriminator` value matches. No `if/else` in your code. |
| **JSONPath sourcing** | `@DerivedFrom('$.display.theme')` reaches into the raw input regardless of how deeply the field is nested. Each version class knows its own field layout. |
| **Default injection** | When a field did not exist in an older version (e.g., `language` in V1), the transform function returns a default. This is explicit and version-specific. |
| **Pass-through** | V3 uses `@Copy()` because the input already matches the canonical shape. No unnecessary transformation overhead. |
| **Adding V4** | When V4 arrives, you add a `V4Preferences` class and append it to the migrations array. No existing classes change. |

## Variations

### 1. Using @Staging for intermediate values during migration

When a migration requires multiple steps -- for example, parsing a legacy string field before reshaping it -- use `@Staging()` to mark intermediate properties that should not appear in the final output.

```typescript
class V1Preferences {
  @Discriminator(1)
  version!: number;

  // Extract the legacy comma-separated channels string into a staging property
  @JSONPath('$.notificationChannels')
  @Staging()
  rawChannels!: string;

  @DerivedFrom('rawChannels', (raw: string | undefined) => ({
    channels: raw ? raw.split(',').map((s: string) => s.trim()) : ['email'],
  }))
  alerts!: { channels: string[] };
}
```

The `rawChannels` property participates in the pipeline (other properties can derive from it) but is removed from the final instance after validation completes.

### 2. Adding validation to migrated data

Apply `@Validate` after the migration transform to catch data that is structurally correct but semantically invalid. This is especially useful for older records that may contain values outside current business rules.

```typescript
class V1Preferences {
  @Discriminator(1)
  version!: number;

  @DerivedFrom('version', (_v: number, { raw }: { raw: any }) => ({
    colorTheme: raw.theme ?? 'light',
    fontScale: typeof raw.fontSize === 'number' ? raw.fontSize : 14,
    language: 'en',
  }))
  @Validate(
    (appearance) =>
      ['light', 'dark', 'system'].includes(appearance.colorTheme) ||
      `Unknown theme "${appearance.colorTheme}"`,
    'Theme must be light, dark, or system'
  )
  @Validate(
    (appearance) =>
      appearance.fontScale >= 10 && appearance.fontScale <= 24 ||
      'Font scale must be between 10 and 24',
    'Font scale range check'
  )
  appearance!: { colorTheme: string; fontScale: number; language: string };
}
```

### 3. Handling missing version field with fallback

Legacy data may not have a version field at all. Use `@DerivedFrom` with a fallback to infer the version from the data shape, then feed the inferred version into the discriminator.

```typescript
class VersionDetector {
  @DerivedFrom('$.version', (v, ctx) => {
    if (v != null) return v;
    // No version field -- infer from structure
    if (ctx.raw?.appearance) return 3;
    if (ctx.raw?.display) return 2;
    return 1; // Flat fields = V1
  })
  @Discriminator(null as any) // dynamic
  version: number;
}
```

Alternatively, add the version field in a preprocessing step before calling `factory.create`:

```typescript
function ensureVersion(data: any): any {
  if (data.version != null) return data;
  if (data.appearance) return { ...data, version: 3 };
  if (data.display) return { ...data, version: 2 };
  return { ...data, version: 1 };
}

const result = await factory.create(MIGRATIONS, ensureVersion(rawData));
```

### 4. Nested discriminated unions for sub-objects

When sub-objects also evolve independently, apply the same pattern at the nested level using `@ValidatedClass` with an array of version classes.

```typescript
class AlertSettingsV1 {
  @Discriminator(1)
  alertVersion!: number;

  @DerivedFrom('alertVersion', (_v: number, { raw }: { raw: any }) => ({
    channels: raw.emailEnabled ? ['email'] : [],
  }))
  config!: { channels: string[] };
}

class AlertSettingsV2 {
  @Discriminator(2)
  alertVersion!: number;

  @Copy()
  config!: { channels: string[] };
}

class UserPreferences {
  @Copy()
  version!: number;

  @Copy()
  appearance!: { colorTheme: string; fontScale: number; language: string };

  // The alerts sub-object has its own version and migration classes
  @ValidatedClass([AlertSettingsV1, AlertSettingsV2])
  alerts!: AlertSettingsV1 | AlertSettingsV2;
}
```

This keeps parent and child migrations decoupled. Each can evolve on its own cadence.

## See Also

- [Conceptual Guide](../concepts.md) -- Design philosophy, decorator pipeline model, discriminated unions
- [API Reference](../validation-library-reference.md) -- `@Discriminator`, `@DiscriminatedUnion`, `@DerivedFrom`, `@Staging` signatures
- [Getting Started](../validation-library-getting-started.md) -- `ValidationFactory` basics, first validated class
- [Intermediate Guide](../validation-library-intermediate.md) -- Discriminated unions introduction, data versioning pattern
- [Fuzzy Inventory Matching (use case)](./fuzzy-inventory-matching.md) -- Context-driven fuzzy matching with `@CoerceFromSet`
- [Runnable example](../examples/schema-version-migration.ts) -- Self-contained TypeScript program you can execute with `npx tsx`
