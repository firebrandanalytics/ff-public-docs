# Intermediate Guide: Reshaping and Scaling Your Validations

## Introduction: Beyond Single Values

Welcome back! In the [Getting Started Guide](./validation-library-getting-started-updated.md), you mastered the art of transforming and validating individual data fields. You learned how to turn messy inputs like `{ "quantity": "five" }` into clean, trusted class instances.

But real-world data is rarely that simple. Often, the challenge isn't just a dirty value; it's the entire *structure* of the data. You might face challenges like:

*   Data is nested in an awkward structure that doesn't match your clean domain classes.
*   You need to apply a transformation not to a property, but to every *key* or *value* within an object.
*   A single string field contains a complex, code-like list of values that needs careful parsing.
*   You find yourself repeating the same `@UseStyle` decorator across dozens of properties and want a more scalable solution.

This guide will elevate your skills from a data cleaner to a **data architect**. You'll learn how to reshape, dissect, and apply rules with surgical precision, making even the most complex data sources conform to your ideal domain model.

## 1. Reshaping Data: Declarative Reparenting

Your data source (an external API or an LLM) rarely returns data in the exact shape you need. Reparenting decorators let you define how to map a messy input structure to your clean class structure.

### The Problem: Mismatched Structures

An LLM returns this object:

```json
{
  "order_info": {
    "details": { "id": "ORD-123" }
  },
  "customer": {
    "contact": { "email": "john@example.com" }
  },
  "items": [ { "sku": "WID-001" } ],
  "notes": "Customer requested rush delivery."
}
```

But your desired `Order` class is flat and clean:

```typescript
class Order {
  orderId: string;
  customerEmail: string;
  productSku: string;
}
```

### The Solution: Pluck Data with `@DerivedFrom`

The `@DerivedFrom` decorator lets you specify a [JSONPath](https://goessner.net/articles/JsonPath/) to extract a value from the raw input.

```typescript
class Order {
  @DerivedFrom('$.order_info.details.id')
  orderId: string;

  @DerivedFrom('$.customer.contact.email')
  customerEmail: string;

  @DerivedFrom('$.items.sku') // You can even access array elements
  productSku: string;
}

const factory = new ValidationFactory();
const order = await factory.create(Order, messyLLMOutput);

// order now contains:
// {
//   orderId: 'ORD-123',
//   customerEmail: 'john@example.com',
//   productSku: 'WID-001'
// }
```

You can also provide **fallback paths**. The first path that finds a non-undefined value wins. This is incredibly useful when an LLM's output structure is inconsistent.

```typescript
class Order {
  @DerivedFrom(['$.order_id', '$.orderId', '$.id'])
  orderId: string;
}
```

### Capturing "Everything Else" with `@CollectProperties`

Sometimes you want to map specific fields and capture all the remaining ones in a metadata property. `@CollectProperties` does this automatically.

```typescript
class Order {
  @DerivedFrom('$.order_info.details.id')
  orderId: string;

  // This will collect all properties from the root ('$') of the input
  // that weren't already mapped by another decorator.
  @CollectProperties({ sources: [{ path: '$' }] })
  metadata: Record<string, any>;
}

const factory = new ValidationFactory();
const order = await factory.create(Order, messyLLMOutput);

// order.metadata will contain:
// {
//   "customer": { "contact": { "email": "..." } },
//   "items": [ { "sku": "..." } ],
//   "notes": "Customer requested rush delivery."
// }
```

## 2. Precision Targeting: Context Decorators

Context decorators (`@Keys`, `@Values`, `@Split`) change the *context* of the decorators that follow them. They allow you to "step inside" an object or array and apply transformations with precision.

### Targeting Object Keys with `@Keys` and Values with `@Values`

These decorators allow you to apply subsequent rules to the keys or values of an object (or elements of an array).

```typescript
class HttpRequest {
  @Keys() // The following decorators now apply to each KEY
  @CoerceTrim()
  @CoerceCase('lower')
  headers: Record<string, string>;
}

class Article {
  @Values() // The following decorators now apply to each ELEMENT
  @CoerceTrim()
  tags: string[];
}
```

### Parsing Strings with `@Split` and Protected Segments

`@Split` is a powerful tool for parsing delimited strings. Unlike a simple `string.split()`, it understands how to handle "protected" segments inside quotes and brackets, which is essential for parsing complex, code-like data.

**The Problem:** You need to parse a string that contains delimiters within quoted segments or function-like bracketed segments. A standard regex or split would fail.

```typescript
const input = {
  // We want to split by ';', but not inside the quotes or brackets.
  style: 'font-family: "Times New Roman", serif; color: rgb(255, 0, 0); font-weight: bold'
};
```

**The Solution:** Use `@Split` with quote and bracket definitions.

```typescript
class StyleRule {
  @Split(';', {
    quotes: ['"', "'"],
    brackets: ['()', '[]', '{}'], // Supports nested, heterogenous brackets
    stripQuotes: true,
  })
  @CoerceTrim()
  rules: string[];
}

const factory = new ValidationFactory();
const result = await factory.create(StyleRule, input);

// The result is parsed correctly:
// {
//   rules: [
//     'font-family: Times New Roman, serif', // The comma inside quotes was ignored
//     'color: rgb(255, 0, 0)',             // The content inside brackets was treated as one unit
//     'font-weight: bold'
//   ]
// }
```
This built-in balanced bracket support is a powerful feature not available in standard JavaScript regular expressions.

### Advanced Pattern: Composing Styles and Context

Here's where the intermediate patterns start to shine. What if you want to apply a complex, reusable style (like your `EmailStyle`) to every *value* in an object?

This is where the concept of a **"hygienic macro"** comes in. Your `EmailStyle` is "hygienic"—it's self-contained and only knows how to process a single value. The `@Values()` decorator provides the context, telling the engine to apply that self-contained logic to each value in the object.

```typescript
// From the Getting Started guide
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string;
}

class UserEmailMap {
  @Values() // CONTEXT: Apply the following rules to each value of the object
  @UseStyle(EmailStyle) // RULE: The rule to apply is our reusable EmailStyle
  emails: Record<string, string>;
}

const input = {
  emails: {
    primary: '  PRIMARY@EXAMPLE.COM  ',
    secondary: '  SECONDARY@EXAMPLE.COM  '
  }
};

const factory = new ValidationFactory();
const result = await factory.create(UserEmailMap, input);

// Result: Both emails are cleaned according to the style.
// {
//   emails: {
//     primary: 'primary@example.com',
//     secondary: 'secondary@example.com'
//   }
// }
```

This pattern of composing context decorators with style decorators is incredibly powerful for keeping your validation logic clean and DRY.

## 3. Scaling Your Rules with Default Transforms

Default transforms take reusability to the next level, allowing you to define default styles for an entire class or even your entire application.

### Class-Level Defaults with `@DefaultTransforms`

Instead of applying a `@UseStyle` to every string property, you can set a default for all string properties on the class.

```typescript
class TrimStyle { @CoerceTrim() value: string; }

@DefaultTransforms({
  string: TrimStyle // Apply TrimStyle to ALL string properties in this class
})
class User {
  @Copy() name: string;
  @Copy() email: string;
}
```
*Note: You still need a decorator like `@Copy()` on each property to "opt-in" to the validation process. Properties without any decorators are ignored.*

### Factory-Level Defaults and The Cascade

For ultimate scalability, you can configure defaults on the `ValidationFactory` itself. These defaults work just like CSS styles, with more specific rules overriding more general ones in a predictable cascade:

**Property Decorators > Class Defaults > Factory Defaults**

Let's see it in action.

```typescript
// --- Define reusable styles ---
class TrimLowerStyle { @CoerceTrim() @CoerceCase('lower') value: string; }
class TrimUpperStyle { @CoerceTrim() @CoerceCase('upper') value: string; }

// --- 1. FACTORY Default ---
// Our application-wide default: all strings should be trimmed and lowercased.
const factory = new ValidationFactory({
  defaultTransforms: {
    string: TrimLowerStyle
  }
});

// --- 2. CLASS Override ---
// For this specific class, we want strings to be uppercase instead.
@DefaultTransforms({
  string: TrimUpperStyle
})
class Product {
  // This property will use the CLASS default (uppercase).
  @Copy()
  name: string;

  // --- 3. PROPERTY Override ---
  // For this one property, we need title case, overriding all defaults.
  @CoerceTrim()
  @CoerceCase('title')
  description: string;

  // This property has no overrides, so it uses the CLASS default.
  @Copy()
  sku: string;
}

// Let's process some data
const input = {
  name: '  Super Widget  ',
  description: '  a truly super widget.  ',
  sku: '  wdg-123  '
};

const product = await factory.create(Product, input);

// Observe the results of the cascade:
// product.name = 'SUPER WIDGET' (Used the Class-level TrimUpperStyle)
// product.description = 'A Truly Super Widget.' (Used the Property-level decorators)
// product.sku = 'WDG-123' (Used the Class-level TrimUpperStyle)
```

This powerful cascade gives you complete control over how rules are applied, allowing you to set sensible application-wide defaults while still handling exceptions with ease at the class or property level.

## Conclusion: You Are the Architect

You've now moved beyond simple validation into the realm of data architecture. You have the tools to:

*   **Reshape** any input structure to match your ideal domain models using reparenting.
*   **Target** transformations with precision to keys, values, or parsed segments of a string.
*   **Compose** styles and context to create powerful, hygienic patterns.
*   **Scale** your validation rules across your entire application with a predictable cascade.

With these intermediate patterns, you are well-equipped to handle the complex and messy data of modern applications. For even more advanced use cases, consult the full API reference documentation.

---

## 4. Conditional Logic with If/Else/EndIf

You can apply rules conditionally based on runtime values using an `If/Else/EndIf` block. Decorators placed between branch markers (`@If`, `@ElseIf`, `@Else`) are only applied if that branch is taken.

**Important:** Conditional decorators execute in reverse order (`@EndIf` first, `@If` last). The block starts with `@EndIf` and ends with `@If`.

```typescript
class Order {
  @ValidateRequired()
  orderType: 'ONLINE' | 'IN_STORE';

  // This property is only required if orderType is 'ONLINE'
  @EndIf()
  @ValidateRequired()
  @If({
    topics: ['orderType'], // Depend on the value of 'orderType'
    predicate: (orderType) => orderType === 'ONLINE'
  })
  shippingAddress: string;
}
```