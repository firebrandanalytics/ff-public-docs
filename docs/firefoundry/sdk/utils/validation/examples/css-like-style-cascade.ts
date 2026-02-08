/**
 * CSS-Like Style Cascade
 *
 * Demonstrates the four-level cascade for default transforms:
 *   Factory defaults < Class @DefaultTransforms < @UseStyle < Direct decorators
 *
 * Styles are defined once as reusable classes and inherited everywhere,
 * with overrides at any level — just like CSS specificity.
 *
 * Run:
 *   npx tsx css-like-style-cascade.ts
 */

import {
    ValidationFactory,
    Copy,
    Coerce,
    CoerceTrim,
    CoerceCase,
    DefaultTransforms,
    UseStyle,
    UseSinglePassValidation,
    ManageAll,
    ValidatePattern,
    ValidateRequired,
} from '@firebrandanalytics/shared-utils/validation';

// ── Style classes ──────────────────────────────────────────────────────────
// Styles define reusable formatting rules on a `value` property.

/** Baseline: trim whitespace. */
class TrimStyle {
    @CoerceTrim()
    value!: string;
}

/** Data-storage standard: trim + lowercase. */
class TrimLowerStyle {
    @CoerceTrim()
    @CoerceCase('lower')
    value!: string;
}

/** Display standard: trim + title case. */
class TrimTitleStyle {
    @CoerceTrim()
    @CoerceCase('title')
    value!: string;
}

/** Email normalization: trim, lowercase, pattern validation. */
class EmailStyle {
    @CoerceTrim()
    @CoerceCase('lower')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    value!: string;
}

/** Phone normalization: strip non-digit characters. */
class PhoneDigitsStyle {
    @Coerce((v: string) => String(v).replace(/\D/g, ''))
    value!: string;
}

/** Composed style: builds on TrimLowerStyle + adds pattern check. */
class SecureEmailStyle {
    @UseStyle(TrimLowerStyle)
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    value!: string;
}

// ── Validated classes ──────────────────────────────────────────────────────

/**
 * Level 1: Factory default only.
 * No @DefaultTransforms — inherits TrimStyle from the factory.
 */
@UseSinglePassValidation()
class ProductListing {
    @ValidateRequired()
    @Copy()
    title!: string;

    @Copy()
    description!: string;

    @Copy()
    category!: string;
}

/**
 * Level 2: Class-level override.
 * @DefaultTransforms replaces the factory's TrimStyle with TrimLowerStyle.
 * All managed string properties get trim + lowercase instead of just trim.
 */
@UseSinglePassValidation()
@DefaultTransforms({ string: TrimLowerStyle })
class ContactRecord {
    @Copy()
    firstName!: string;

    @Copy()
    lastName!: string;

    /** Level 3: Property @UseStyle overrides class default for this property. */
    @UseStyle(EmailStyle)
    email!: string;

    /** Level 4: Direct decorator — @CoerceCase('title') runs after class defaults. */
    @Copy()
    @CoerceCase('title')
    displayName!: string;

    /** Level 3: PhoneDigitsStyle strips to digits. */
    @UseStyle(PhoneDigitsStyle)
    phone!: string;
}

/**
 * Another class-level override: uppercase for audit logs.
 */
@UseSinglePassValidation()
@DefaultTransforms({ string: TrimTitleStyle })
class AuditEntry {
    @Copy()
    action!: string;

    @Copy()
    actor!: string;

    /** Inline override: lowercase for machine-readable details. */
    @Copy()
    @CoerceCase('lower')
    details!: string;
}

/**
 * Uses @ManageAll so properties don't need individual @Copy().
 * Combined with class-level @DefaultTransforms, every listed property
 * gets the default style with zero per-property decoration.
 */
@UseSinglePassValidation()
@ManageAll({ include: ['name', 'email', 'city', 'state'] })
@DefaultTransforms({ string: TrimLowerStyle })
class AddressForm {
    name!: string;
    email!: string;
    city!: string;
    state!: string;
}

/**
 * Style composition: SecureEmailStyle composes TrimLowerStyle + pattern.
 */
@UseSinglePassValidation()
class StrictContact {
    @ValidateRequired()
    @Copy()
    name!: string;

    @UseStyle(SecureEmailStyle)
    email!: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function header(title: string): void {
    console.log(`\n${'─'.repeat(2)} ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

function showField(label: string, input: unknown, output: unknown): void {
    const inp = JSON.stringify(input);
    const out = JSON.stringify(output);
    console.log(`  ${label.padEnd(18)} ${inp.padEnd(28)} → ${out}`);
}

// ── Demo 1: Factory-level defaults ──────────────────────────────────────────

async function demoFactoryDefaults(): Promise<void> {
    header('Demo 1: Factory-Level Defaults');
    console.log('  ProductListing inherits TrimStyle from the factory.\n');

    const factory = new ValidationFactory({
        defaultTransforms: { string: TrimStyle },
    });

    const raw = {
        title: '  Widget Pro  ',
        description: '  A premium widget for professionals.  ',
        category: '  Home & Garden  ',
    };

    const result = await factory.create(ProductListing, raw);

    showField('title:', raw.title, result.title);
    showField('description:', raw.description, result.description);
    showField('category:', raw.category, result.category);
}

// ── Demo 2: Class-level override ────────────────────────────────────────────

async function demoClassOverride(): Promise<void> {
    header('Demo 2: Class-Level Override (@DefaultTransforms)');
    console.log('  ContactRecord overrides factory TrimStyle with TrimLowerStyle.\n');

    const factory = new ValidationFactory({
        defaultTransforms: { string: TrimStyle },
    });

    const raw = {
        firstName: '  ALICE  ',
        lastName: '  WONDERLAND  ',
        email: '  Alice@Example.COM  ',
        displayName: '  alice wonderland  ',
        phone: '  (555) 867-5309  ',
    };

    const result = await factory.create(ContactRecord, raw);

    showField('firstName:', raw.firstName, result.firstName);
    showField('lastName:', raw.lastName, result.lastName);
    showField('email:', raw.email, result.email);
    showField('displayName:', raw.displayName, result.displayName);
    showField('phone:', raw.phone, result.phone);

    console.log('\n  firstName/lastName: class default (trim + lower)');
    console.log('  email: @UseStyle(EmailStyle) — trim + lower + pattern');
    console.log('  displayName: class default + @CoerceCase(\'title\') override');
    console.log('  phone: @UseStyle(PhoneDigitsStyle) — strip non-digits');
}

// ── Demo 3: Multiple factories, same class ──────────────────────────────────

async function demoMultipleFactories(): Promise<void> {
    header('Demo 3: Multiple Factories, Same Class');
    console.log('  Same class produces different output based on factory defaults.\n');

    const storagePipeline = new ValidationFactory({
        defaultTransforms: { string: TrimLowerStyle },
    });

    const displayPipeline = new ValidationFactory({
        defaultTransforms: { string: TrimTitleStyle },
    });

    @UseSinglePassValidation()
    class UserName {
        @Copy()
        name!: string;
    }

    const raw = { name: '  JOHN DOE  ' };

    const stored = await storagePipeline.create(UserName, raw);
    const display = await displayPipeline.create(UserName, raw);

    showField('storage:', raw.name, stored.name);
    showField('display:', raw.name, display.name);
}

// ── Demo 4: @ManageAll with defaults ────────────────────────────────────────

async function demoManageAll(): Promise<void> {
    header('Demo 4: @ManageAll — Zero Per-Property Decoration');
    console.log('  AddressForm uses @ManageAll so no @Copy() is needed.\n');

    const factory = new ValidationFactory();

    const raw = {
        name: '  JANE DOE  ',
        email: '  Jane@EXAMPLE.com  ',
        city: '  NEW YORK  ',
        state: '  NY  ',
    };

    const result = await factory.create(AddressForm, raw);

    showField('name:', raw.name, result.name);
    showField('email:', raw.email, result.email);
    showField('city:', raw.city, result.city);
    showField('state:', raw.state, result.state);
}

// ── Demo 5: Audit log with different class defaults ─────────────────────────

async function demoAuditLog(): Promise<void> {
    header('Demo 5: Audit Log — Another Class Override');
    console.log('  AuditEntry uses TrimTitleStyle as its class default.\n');

    const factory = new ValidationFactory({
        defaultTransforms: { string: TrimStyle },
    });

    const raw = {
        action: '  user login  ',
        actor: '  admin user  ',
        details: '  IP: 192.168.1.1, Browser: CHROME  ',
    };

    const result = await factory.create(AuditEntry, raw);

    showField('action:', raw.action, result.action);
    showField('actor:', raw.actor, result.actor);
    showField('details:', raw.details, result.details);

    console.log('\n  action/actor: class default (TrimTitleStyle → trim + title case)');
    console.log('  details: class default + @CoerceCase(\'lower\') override');
}

// ── Demo 6: Style composition ───────────────────────────────────────────────

async function demoStyleComposition(): Promise<void> {
    header('Demo 6: Style Composition (@UseStyle Nesting)');
    console.log('  SecureEmailStyle composes TrimLowerStyle + pattern check.\n');

    const factory = new ValidationFactory();

    const raw = {
        name: '  Bob Smith  ',
        email: '  BOB@Company.COM  ',
    };

    const result = await factory.create(StrictContact, raw);

    showField('name:', raw.name, result.name);
    showField('email:', raw.email, result.email);

    // Also show that invalid emails are rejected
    try {
        await factory.create(StrictContact, {
            name: 'Test',
            email: 'not-an-email',
        });
        console.log('\n  Unexpectedly accepted invalid email.');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n  Invalid email rejected: ${msg.slice(0, 80)}`);
    }
}

// ── Demo 7: Full cascade in one class ───────────────────────────────────────

async function demoFullCascade(): Promise<void> {
    header('Demo 7: Full Cascade — All Four Levels');
    console.log('  Factory default → class override → @UseStyle → inline decorator.\n');

    const factory = new ValidationFactory({
        defaultTransforms: { string: TrimStyle },  // Level 1
    });

    @UseSinglePassValidation()
    @DefaultTransforms({ string: TrimLowerStyle })  // Level 2: overrides factory
    class FullCascadeDemo {
        @Copy()
        basic!: string;          // Gets class default (trim + lower)

        @UseStyle(EmailStyle)    // Level 3: email-specific style
        email!: string;

        @Copy()
        @CoerceCase('upper')     // Level 4: inline override to uppercase
        code!: string;

        @Copy()
        inheritsDefault!: string; // Gets class default (trim + lower)
    }

    const raw = {
        basic: '  Hello World  ',
        email: '  User@Example.COM  ',
        code: '  abc-123  ',
        inheritsDefault: '  SOME VALUE  ',
    };

    const result = await factory.create(FullCascadeDemo, raw);

    showField('basic:', raw.basic, result.basic);
    showField('email:', raw.email, result.email);
    showField('code:', raw.code, result.code);
    showField('inheritsDefault:', raw.inheritsDefault, result.inheritsDefault);

    console.log('\n  basic:           class default (trim + lower)');
    console.log('  email:           @UseStyle(EmailStyle) overrides class default');
    console.log('  code:            class default (trim + lower) + @CoerceCase(\'upper\') wins');
    console.log('  inheritsDefault: class default (trim + lower)');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log('=== CSS-Like Style Cascade ===');
    console.log('Demonstrating four-level cascade: Factory < Class < @UseStyle < Inline\n');

    await demoFactoryDefaults();
    await demoClassOverride();
    await demoMultipleFactories();
    await demoManageAll();
    await demoAuditLog();
    await demoStyleComposition();
    await demoFullCascade();

    console.log('\n' + '─'.repeat(57));
    console.log('Done. All demos completed.');
}

main().catch(console.error);
