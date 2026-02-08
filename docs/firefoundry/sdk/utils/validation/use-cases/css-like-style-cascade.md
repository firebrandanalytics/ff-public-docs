# CSS-Like Style Cascade

Define formatting rules once and apply them everywhere. Override at any level — factory, class, property, or inline — just like CSS specificity.

---

## The Problem

You're normalizing data across dozens of classes. Every string property needs `@CoerceTrim()`. Every number needs `@CoerceType('number')`. You end up decorating every property with the same boilerplate, and when the formatting standard changes, you're updating 50+ properties across 12 files.

Worse, different parts of your system need different defaults. The public API team wants strings trimmed and lowercased for storage. The display layer wants title case. The admin tool wants raw preservation. You need a way to set a baseline and let individual classes or properties opt out.

## The Strategy

**A four-level cascade with increasing specificity.** The validation library borrows the CSS concept of specificity: define broad defaults at the factory level, narrow them at the class level, and override at the property level. More specific rules always win.

| Level | Mechanism | Scope | Priority |
|-------|-----------|-------|----------|
| Factory | `new ValidationFactory({ defaultTransforms: { string: TrimStyle } })` | All classes created by this factory | Lowest |
| Class | `@DefaultTransforms({ string: UpperStyle })` | All managed properties in that class | Medium |
| Property style | `@UseStyle(EmailStyle)` | One specific property | High |
| Property decorator | `@CoerceCase('title')` | One specific property | Highest |

**Key rule:** Class-level `@DefaultTransforms` *replaces* the factory default for that type entirely — it does not merge. This is intentional: it gives each class full control over its defaults without inheriting unwanted behavior.

## Architecture

```
                    ┌──────────────────────────┐
                    │    ValidationFactory      │
                    │  defaultTransforms:       │
                    │    string → TrimStyle     │  ◀── Level 1: Factory default
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │  ContactRecord  │  │  ProductListing│  │  AuditLog       │
     │  @DefaultTransf │  │  (no override) │  │  @DefaultTransf │
     │  string → Lower │  │                │  │  string → Upper │
     └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
             │                   │                    │
             ▼                   ▼                    ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │ email:          │  │ title:         │  │ action:        │
     │  @UseStyle(     │  │  (factory      │  │  (class        │
     │   EmailStyle)   │  │   default)     │  │   default)     │
     │ displayName:    │  │ description:   │  │ details:       │
     │  @CoerceCase(   │  │  (factory      │  │  @CoerceCase(  │
     │   'title')      │  │   default)     │  │   'lower')     │
     └────────────────┘  └────────────────┘  └────────────────┘
```

**Reading the diagram:**

- `ProductListing` has no `@DefaultTransforms`, so it inherits the factory's `TrimStyle` (trim whitespace).
- `ContactRecord` overrides with its own `@DefaultTransforms`, so all its strings get trim + lowercase instead.
- Within `ContactRecord`, `email` uses `@UseStyle(EmailStyle)` for email-specific formatting, and `displayName` uses `@CoerceCase('title')` to override the class-level lowercase.

## Implementation

### 1. Define reusable style classes

Style classes are plain classes with decorators on a `value` property. They serve as named, composable formatting rules.

```typescript
/** Baseline hygiene: trim whitespace from all strings. */
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

/** Email normalization: trim, lowercase, pattern check. */
class EmailStyle {
    @CoerceTrim()
    @CoerceCase('lower')
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    value!: string;
}

/** Phone normalization: strip non-digits. */
class PhoneDigitsStyle {
    @Coerce((v: string) => String(v).replace(/\D/g, ''))
    value!: string;
}
```

### 2. Configure the factory with global defaults

```typescript
const factory = new ValidationFactory({
    defaultTransforms: {
        string: TrimStyle,  // Every managed string property gets trimmed
    },
});
```

Any class created by this factory will have `TrimStyle` applied to its managed string properties — unless the class or property overrides it.

### 3. Define classes at different cascade levels

```typescript
/** Uses factory default: strings get trimmed. */
class ProductListing {
    @Copy()
    title!: string;

    @Copy()
    description!: string;

    @Copy()
    category!: string;
}

/**
 * Overrides factory default at the class level.
 * All strings get trim + lowercase instead of just trim.
 */
@DefaultTransforms({ string: TrimLowerStyle })
class ContactRecord {
    @Copy()
    firstName!: string;   // Gets TrimLowerStyle (trim + lower)

    @Copy()
    lastName!: string;    // Gets TrimLowerStyle (trim + lower)

    @UseStyle(EmailStyle)  // Property-level override: email-specific rules
    email!: string;

    @Copy()
    @CoerceCase('title')   // Inline override: title case for display names
    displayName!: string;  // Gets TrimLowerStyle defaults + title case override

    @UseStyle(PhoneDigitsStyle)  // Strip to digits only
    phone!: string;
}
```

### 4. Create validated instances

```typescript
const product = await factory.create(ProductListing, {
    title: '  Widget Pro  ',
    description: '  A premium widget.  ',
    category: '  Home & Garden  ',
});
// title: "Widget Pro"             ← factory default: trimmed
// description: "A premium widget." ← factory default: trimmed
// category: "Home & Garden"       ← factory default: trimmed

const contact = await factory.create(ContactRecord, {
    firstName: '  ALICE  ',
    lastName: '  WONDERLAND  ',
    email: '  Alice@Example.COM  ',
    displayName: '  alice wonderland  ',
    phone: '  (555) 867-5309  ',
});
// firstName: "alice"            ← class default: trim + lower
// lastName: "wonderland"        ← class default: trim + lower
// email: "alice@example.com"    ← @UseStyle(EmailStyle): trim + lower + validate
// displayName: "Alice Wonderland" ← class default trim + lower, then @CoerceCase title override
// phone: "5558675309"           ← @UseStyle(PhoneDigitsStyle)
```

## What to Observe

When you run the [companion example](../examples/css-like-style-cascade.ts), the output shows each cascade level in action:

```
── Demo 1: Factory-Level Defaults ─────────────────────────
  ProductListing inherits TrimStyle from the factory.
    title:         "  Widget Pro  "                → "Widget Pro"
    description:   "  A premium widget for..."     → "A premium widget for..."
    category:      "  Home & Garden  "             → "Home & Garden"

── Demo 2: Class-Level Override (@DefaultTransforms) ──────
  ContactRecord overrides factory TrimStyle with TrimLowerStyle.
    firstName:     "  ALICE  "                     → "alice"
    lastName:      "  WONDERLAND  "                → "wonderland"
    email:         "  Alice@Example.COM  "         → "alice@example.com"
    displayName:   "  alice wonderland  "          → "Alice Wonderland"
    phone:         "  (555) 867-5309  "            → "5558675309"

── Demo 3: Multiple Factories, Same Class ─────────────────
    storage:       "  JOHN DOE  "                  → "john doe"
    display:       "  JOHN DOE  "                  → "John Doe"

── Demo 5: Audit Log — Another Class Override ─────────────
    action:        "  user login  "                → "User Login"
    details:       "  IP: 192.168.1.1, ..."        → "ip: 192.168.1.1, ..."
```

### Understanding the behavior

| Concept | Explanation |
|---------|-------------|
| **Factory defaults** | Set via `defaultTransforms` in the `ValidationFactory` constructor. Apply to every managed property of the matching type across all classes. |
| **Class override** | `@DefaultTransforms({ string: MyStyle })` on a class *replaces* the factory default for that type entirely. The factory's `TrimStyle` is not applied — only the class's style runs. |
| **Property @UseStyle** | Applies a style class to one property. Additive with defaults — both run, with the style's rules executing after defaults. |
| **Inline override** | Direct decorators like `@CoerceCase('title')` on a property are additive. They execute after defaults and styles. When two coercions affect the same aspect (e.g., case), the later one wins. |
| **Managed properties** | Defaults only apply to properties that have at least one decorator (e.g., `@Copy()`). Undecorated properties are ignored entirely. |
| **Style composition** | Styles can reference other styles via `@UseStyle`. A `TrimLowerStyle` could be built by composing `@UseStyle(TrimStyle)` + `@CoerceCase('lower')`. |

## Variations

### 1. Style composition with @UseStyle nesting

Styles can compose other styles, building up from simple primitives:

```typescript
class TrimStyle {
    @CoerceTrim()
    value!: string;
}

class TrimLowerStyle {
    @UseStyle(TrimStyle)   // Inherit trim from TrimStyle
    @CoerceCase('lower')   // Add lowercase
    value!: string;
}

class SecureEmailStyle {
    @UseStyle(TrimLowerStyle)  // Inherit trim + lower
    @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    @ValidateLength(5, 254)
    value!: string;
}
```

This mirrors CSS's approach to building up from base styles. `SecureEmailStyle` includes trim + lowercase + pattern validation + length check, all composed from simpler building blocks.

### 2. @ManageAll for zero-decorator properties

When a class has many simple string properties, adding `@Copy()` to each one is tedious. `@ManageAll` marks listed properties as managed so defaults apply:

```typescript
@ManageAll({ include: ['name', 'email', 'city', 'state', 'zip'] })
@DefaultTransforms({ string: TrimLowerStyle })
class AddressForm {
    name!: string;    // Managed by @ManageAll → gets TrimLowerStyle
    email!: string;   // Managed by @ManageAll → gets TrimLowerStyle
    city!: string;    // Managed by @ManageAll → gets TrimLowerStyle
    state!: string;   // Managed by @ManageAll → gets TrimLowerStyle
    zip!: string;     // Managed by @ManageAll → gets TrimLowerStyle
}
```

Without `@ManageAll`, each property would need an explicit `@Copy()` for defaults to apply.

### 3. Multiple factory instances for different contexts

Different parts of your system can use different factories with different defaults:

```typescript
// Storage pipeline: normalize everything to lowercase
const storagePipeline = new ValidationFactory({
    defaultTransforms: { string: TrimLowerStyle },
});

// Display pipeline: title case for user-facing output
const displayPipeline = new ValidationFactory({
    defaultTransforms: { string: TrimTitleStyle },
});

// Same class, different output depending on the factory
class UserName {
    @Copy()
    name!: string;
}

const stored  = await storagePipeline.create(UserName, { name: '  JOHN DOE  ' });
const display = await displayPipeline.create(UserName, { name: '  JOHN DOE  ' });

console.log(stored.name);   // "john doe"
console.log(display.name);  // "John Doe"
```

### 4. Combining defaults with conditional logic

Defaults interact naturally with `@If`/`@Else` conditionals. The default is applied first, then the conditional decorator runs:

```typescript
@DefaultTransforms({ string: TrimStyle })
class FlexibleRecord {
    @Copy()
    source!: string;

    @If('source', 'voice')
        @CoerceCase('lower')  // Lenient for voice input
    @Else()
        @CoerceCase('upper')  // Strict for typed input
    @EndIf()
    name!: string;
}
```

The `name` property gets trimmed (from the class default), then cased according to the conditional.

## See Also

- [Conceptual Guide](../concepts.md) -- Cascade model, decorator pipeline, style composition
- [API Reference](../validation-library-reference.md) -- `@DefaultTransforms`, `@UseStyle`, `@ManageAll`, `ValidationFactory` config
- [Getting Started](../validation-library-getting-started.md) -- `ValidationFactory` basics, first validated class
- [Advanced Guide](../validation-library-advanced.md) -- Style composition, factory configuration, performance
