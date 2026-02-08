# Data Validation Library - Getting Started Guide

## Introduction: From Messy Data to Trusted Objects

Imagine you're building an AI application. You ask a Large Language Model to extract order information from an email, and it returns a raw JSON object:

```json
{
  "order_id": "ORD-123",
  "product": "Widgit",
  "quantity": "five",
  "customer_email": "  JOHN@EXAMPLE.COM  "
}
```

This data is a minefield. The quantity is a word, the email has whitespace and incorrect casing, and "Widgit" has a typo.

Traditional validation libraries would simply reject this. You'd be stuck writing tedious preprocessing code, handling errors, and retrying the LLM call.

This library is different. It's built for the messy reality of modern data sources. It doesn't just reject data; it **transforms, corrects, and normalizes** it in one declarative step, giving you a clean, type-safe, and validated class instance you can trust.

### Our Philosophy: Better Architecture Through Better Validation

This library is opinionated. We believe that validation can be a powerful tool to encourage better software design, specifically by making data classes truly useful.

> **The Problem:** When developers deal with raw JSON, they often skip creating proper data classes because it feels like overhead. This leads to scattered helper functions (`calculateTotal(order)`) and defensive checks (`if (!order.quantity)`), which violate encapsulation and make the codebase brittle.
>
> **Our Solution:** We make data classes so valuable for cleaning and validating data that you'll *want* to create them. Once you have a class, it becomes the natural home for related business logic (`order.calculateTotal()`). This simple shift encourages proper encapsulation and a clean, domain-driven design.

This guide will walk you through this process, starting with a simple win and building up to powerful, AI-driven transformations.

## The 5-Minute "Aha!" Moment: Your First Validated Class

Let's start with a common problem: cleaning up a user registration form.

**The Problem:** The raw input from the form is inconsistent.

```typescript
const userInput = {
  email: '  JANE@EXAMPLE.COM  ',
  age: '25', // String instead of number
  name: '  jane doe  '
};
```

**The Solution:** Define a class with decorators that describe the desired *final state* of your data.

```typescript
import {
  ValidationFactory,
  ValidateRequired,
  CoerceTrim,
  CoerceType,
  CoerceCase,
  ValidatePattern,
  ValidateRange
} from '@firebrandanalytics/shared-utils/validation';

class UserRegistration {
  @ValidateRequired()
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
  email: string;

  @ValidateRequired()
  @CoerceTrim()
  name: string;

  @CoerceType('number')
  @ValidateRange(18, 120, 'Age must be between 18 and 120')
  age: number;
}

// 1. Create a factory
const factory = new ValidationFactory();

// 2. Transform and validate the raw input
const user = await factory.create(UserRegistration, userInput);

// 3. Enjoy your clean, typed, and validated data
console.log(user);
```

**The Payoff:** Look at the result. It's not just validated; it's completely transformed.

```json
{
  "email": "jane@example.com", // Trimmed and lowercased
  "name": "jane doe",           // Trimmed
  "age": 25                     // Converted to a number
}
```

In one step, you got:
*   **Normalization:** Whitespace was trimmed and the email was lowercased.
*   **Coercion:** The `age` string was converted to a number.
*   **Validation:** The fields were checked to ensure they existed and fell within the defined rules.
*   **Type Safety:** The `user` constant is now a fully typed `UserRegistration` instance, so your IDE knows `user.age` is a number.

This is the core loop: define rules with decorators, pass in messy data, and get a clean, trusted object back.

### What Happens When Validation Fails?

If the input data violates a rule, the library throws a detailed `ValidationError`.

```typescript
try {
  const factory = new ValidationFactory();
  await factory.create(UserRegistration, { age: '15' }); // Age is out of range
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message);      // "Age must be between 18 and 120"
    console.log(error.propertyPath); // "age"
    console.log(error.actualValue);  // "15"
  }
}
```

### Beyond Validation: Building True Domain Objects

Remember our philosophy? The validation decorators justify creating the class. Now, make the class even more useful by adding behavior.

```typescript
class UserRegistration {
  // ... (validation decorators from before)
  email: string;
  name: string;
  age: number;

  // Helper methods live naturally on the class
  isAdult(): boolean {
    return this.age >= 18;
  }

  getEmailDomain(): string {
    return this.email.split('@');
  }

  toDisplayName(): string {
    return this.name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// Now you have a real domain object
const user = await factory.create(UserRegistration, userInput);
console.log(user.toDisplayName()); // "Jane Doe"
console.log(user.isAdult());       // true
```

No more scattered helper functions! Your validation and business logic are now neatly encapsulated.

## Building a Solid Foundation: The Core Toolkit

Most of your day-to-day validation tasks can be solved with a handful of core decorators. They are executed top-to-bottom on each property, like a pipeline.

#### Transforming Types with `@CoerceType`

Data from APIs often arrives as strings. `@CoerceType` intelligently converts them.

```typescript
class Product {
  @CoerceType('number')
  price: number; // "19.99" -> 19.99

  @CoerceType('boolean')
  inStock: boolean; // "yes", "on", 1 -> true

  @CoerceType('date')
  releaseDate: Date; // "2024-01-15" -> Date object
}
```

#### Normalizing Strings with `@CoerceTrim` and `@CoerceCase`

Clean up messy string inputs effortlessly.

```typescript
class Contact {
  @CoerceTrim()
  @CoerceCase('lower') // 'lower', 'upper', 'title', etc.
  email: string; // "  JOHN@EXAMPLE.COM  " -> "john@example.com"
}
```

#### Validating Values with `@Validate...`

After coercing and normalizing, you can check the final values.

```typescript
class UserProfile {
  @ValidateLength(3, 50)
  username: string;

  @CoerceType('number')
  @ValidateRange(18, 120)
  age: number;

  @ValidatePattern(/^\d{3}-\d{3}-\d{4}$/, 'Phone must be XXX-XXX-XXXX')
  phone: string;
}
```

## Handling Real-World Structures: Nested Objects and Arrays

Your data isn't always flat. You can easily compose validated classes to handle complex, nested structures.

#### Nested Objects with `@ValidatedClass`

To validate a property that is another validated class, use `@ValidatedClass`.

```typescript
class Address {
  @ValidateRequired() @CoerceTrim() street: string;
  @ValidateRequired() @CoerceTrim() city: string;
}

class Customer {
  @ValidateRequired() @CoerceTrim() name: string;

  @ValidatedClass(Address) // Nest the validation logic
  address: Address;
}

const factory = new ValidationFactory();
const customer = await factory.create(Customer, {
  name: '  John Doe  ',
  address: { street: ' 123 Main St ', city: 'Springfield' }
});

// customer.address is now a clean, validated Address instance
console.log(customer.address.street); // "123 Main St"
```

#### Arrays of Objects with `@ValidatedClassArray`

For arrays of validated objects, use `@ValidatedClassArray`.

```typescript
class OrderItem {
  @ValidateRequired() productId: string;
  @CoerceType('number') @ValidateRange(1, 100) quantity: number;
}

class Order {
  @ValidateRequired() orderId: string;
  @ValidatedClassArray(OrderItem) items: OrderItem[];
}

const factory = new ValidationFactory();
const order = await factory.create(Order, {
  orderId: 'ORD-123',
  items: [ { productId: 'PROD-1', quantity: '5' } ] // quantity is a string
});

// The quantity inside the item is correctly coerced to a number
console.log(typeof order.items[0].quantity); // 'number'
```

## The Repetition Problem & A "CSS-Style" Solution

**The Problem:** You'll quickly find yourself repeating the same stack of decorators for common types like emails or slugs.

```typescript
class User {
  @CoerceTrim() @CoerceCase('lower') @ValidatePattern(/*...email regex...*/)
  email: string;

  @CoerceTrim() @CoerceCase('lower') @ValidatePattern(/*...email regex...*/)
  alternateEmail: string;
}
```

This is verbose and hard to maintain.

**The Solution:** Create reusable validation "styles" with `@UseStyle`. This is one of the library's most powerful features for keeping your code DRY (Don't Repeat Yourself).

```typescript
// Define the validation pattern once, like a CSS class
class EmailStyle {
  @CoerceTrim()
  @CoerceCase('lower')
  @ValidatePattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  value: string; // The property name 'value' is conventional
}

// Apply the style anywhere you need it
class User {
  @UseStyle(EmailStyle)
  email: string;

  @UseStyle(EmailStyle)
  alternateEmail: string;
}
```

You can build a library of these styles (`PositiveIntegerStyle`, `SlugStyle`, `PhoneNumberStyle`) to create your own domain-specific validation language.

## The "Real World" is Messy: The Superpowers

Here's where the library truly shines, handling the dynamic and unpredictable data that comes from APIs, users, and LLMs.

### Part A: Dynamic Validation with Context

**The Problem:** How do you validate a product name against your inventory, which changes at runtime? You can't hard-code it in a decorator.

**The Solution:** Pass runtime data into the validation process using the `context` object.

```typescript
interface InventoryContext {
  availableProducts: string[];
}

class Order {
  @CoerceFromSet<InventoryContext>(
    (ctx) => ctx.availableProducts, // Access context data
    { strategy: 'fuzzy', threshold: 0.7 } // Use fuzzy matching!
  )
  productName: string;
}

// At runtime...
const context: InventoryContext = {
  availableProducts: ['Widget', 'Gadget', 'Doohickey']
};

const factory = new ValidationFactory();
const order = await factory.create(
  Order,
  { productName: 'Widgit' }, // Note the typo
  { context } // Pass the context here
);

// The typo is automatically corrected!
console.log(order.productName); // 'Widget'
```

This combination of **runtime context** and **fuzzy matching** is a game-changer for handling slightly incorrect data from users or LLMs. The AI doesn't have to be perfect; the library can fix its minor mistakes.

### Part B: Taming Unstructured Data with AI

**The Problem:** Some data can't be cleaned with simple rules. How do you extract a quantity from `"I need about a dozen"` or categorize a user's sentiment? You need reasoning.

**The Solution:** Use `@AITransform` to apply LLM reasoning directly within your validation pipeline.

First, you need to tell the factory how to call your LLM.

```typescript
// Configure the factory with your AI handler once
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // Your code to call an LLM API (e.g., OpenAI, Anthropic, Gemini)
    // and return the text response.
    const response = await yourLLM.complete(prompt);
    return response;
  }
});
```

Now, use `@AITransform` in your class.

```typescript
class Order {
  @AITransform((params) => `Extract the quantity as a number from this text: "${params.value}". Return only the number.`)
  @CoerceType('number') // Coercion and validation run *after* the AI transform
  @ValidateRange(1, 1000)
  quantity: number;

  @AITransform((params) => `Categorize this note into "high", "medium", or "low" priority. Note: "${params.value}". Return only the word.`)
  @CoerceFromSet(() => ['high', 'medium', 'low'])
  priority: string;
}

const order = await factory.create(Order, {
  quantity: 'I need about a dozen of these, maybe 15 to be safe',
  priority: 'URGENT - customer is waiting, need this shipped today!'
});

// The result after AI transformation:
// {
//   quantity: 15,
//   priority: 'high'
// }
```

**Automatic Retry:** If the LLM's output fails the subsequent validation rules (e.g., it returns `"7/10"` which fails `@CoerceType('number')`), the library will **automatically retry the AI call**, providing the validation error as context. The LLM can then self-correct, leading to incredibly robust data processing.

## Putting It All Together: A Rich Domain Class

Let's combine these concepts into the rich, encapsulated `Order` class we envisioned at the start.

```typescript
// Define a reusable style for SKUs
class SkuStyle {
  @CoerceTrim()
  @CoerceCase('upper')
  @ValidatePattern(/^[A-Z]{3}-\d{3}$/)
  value: string;
}

const PRICE_LOOKUP: Record<string, number> = {
  'WID-001': 19.99,
  'GAD-002': 49.5,
};

interface OrderContext {
  validSkus: string[];
}

class Order {
  @ValidateRequired()
  orderId: string;

  @UseStyle(SkuStyle)
  @CoerceFromSet<OrderContext>((ctx) => ctx.validSkus, { strategy: 'exact' })
  sku: string;

  @AITransform((params) => `Extract the quantity as a number from: "${params.value}".`)
  @CoerceType('number')
  @ValidateRange(1, 100)
  quantity: number;

  // This property is derived from another after it's been validated
  @DerivedFrom('sku', (sku, ctx) => {
    const fallback = typeof ctx.raw?.basePrice === 'number' ? ctx.raw.basePrice : 0;
    return PRICE_LOOKUP[sku] ?? fallback;
  })
  basePrice: number;

  // --- Business Logic ---
  // Helper methods live on the class, operating on clean, trusted data.

  calculateTotal(): number {
    const discount = this.quantity > 10 ? 0.1 : 0; // 10% discount for 10+ items
    return this.basePrice * this.quantity * (1 - discount);
  }

  isEligibleForFreeShipping(): boolean {
    return this.calculateTotal() > 50;
  }

  toDisplayString(): string {
    return `Order ${this.orderId}: ${this.quantity}x ${this.sku} = $${this.calculateTotal().toFixed(2)}`;
  }

  // A static factory method for clean instantiation
  static async fromLLMOutput(output: any, context: OrderContext): Promise<Order> {
    const factory = new ValidationFactory(); // You can configure a global AI handler here
    return factory.create(Order, output, { context });
  }
}

// --- Usage in your application ---

// Your application code is now clean, declarative, and focused on business logic.
const messyLLMData = { orderId: 'ORD-456', sku: ' wid-001 ', quantity: 'about eight' };
const runtimeContext: OrderContext = { validSkus: ['WID-001', 'GAD-002'] };

const order = await Order.fromLLMOutput(messyLLMData, runtimeContext);

console.log(order.toDisplayString());
// "Order ORD-456: 8x WID-001 = $159.92"

console.log(`Free shipping eligibility: ${order.isEligibleForFreeShipping()}`);
// "Free shipping eligibility: true"
```

This final example is the goal. Your business logic is pure and simple because it operates on a guaranteed-valid `Order` instance. All the messy, complex work of cleaning, coercing, correcting, and validating the data is handled declaratively by the library.

> `@DerivedFrom` callbacks receive both the resolved source value and a `{ raw, instance }` helper object, so you can peek at the original LLM response for fallbacks while still working with the clean, validated instance.

## Where to Go From Here

You've now seen the core philosophy and features of the library. You can build incredibly robust data processing pipelines by starting simple and layering in more powerful tools as needed.

*   **Start simple:** Use `@CoerceType` and `@CoerceTrim` everywhere. They add immediate value.
*   **Embrace styles:** Create reusable styles (`@UseStyle`) for your common data types.
*   **Use context:** Whenever validation depends on runtime data, pass it in via `context`.
*   **Leverage AI:** For truly unstructured or messy data, let `@AITransform` handle the reasoning.

This library is designed for the real world—where data is chaotic and you need clean, trusted objects to build reliable software. Happy validating!
