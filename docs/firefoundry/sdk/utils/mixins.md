# Mixin Utilities

The shared utilities package provides two powerful, type-safe systems for code reuse and composition:

1.  **Inheritance-Based Mixins (`AddMixins`)**: Emulates multiple inheritance by creating a single class with a unified prototype chain. Best for when you want to create a single, cohesive object.
2.  **Composition-Based Mixins (`ComposeMixins`)**: Attaches mixin instances as separate objects to a base class instance. Best for when you want to keep functionality modular and loosely coupled.

---

## 1. Inheritance-Based Mixins (`AddMixins`)

`AddMixins` is a utility for composing multiple "mixin" classes with a single base class. It creates a true prototype inheritance chain, allowing full use of `super()` and `instanceof` checks. It has full support for generic type parameters and typed constructor arguments.

### Basic Usage

To use `AddMixins`, pass the base class as the first argument, followed by any number of mixin classes. The `super()` constructor in your final derived class takes an array of tuples, where each tuple contains the constructor arguments for the corresponding class.

```typescript
import { AddMixins } from '@firebrandanalytics/shared-utils';

class MyBase {
  constructor(private b: number) {}
  foo() { return "foo"; }
}

class M1 {
  constructor(private m: number) {}
  bar() { return "bar"; }
}

class M2 {
  constructor(private n: number) {}
  baz() { return "baz"; }
}

// The type parameter is a tuple of the classes being mixed.
class Derived extends AddMixins(MyBase, M1, M2)<[MyBase, M1, M2]> {}

const instance = new Derived(
  [20],   // MyBase constructor args
  [30],   // M1 constructor args
  [40]    // M2 constructor args
);

instance.foo(); // ✓ From MyBase
instance.bar(); // ✓ From M1
instance.baz(); // ✓ From M2
```

### Forwarding Generic Type Parameters

A key feature of `AddMixins` is its ability to correctly forward generic type parameters through the composition chain.

```typescript
class Base<T> {
  constructor(protected value: T) {}
  getValue(): T { return this.value; }
}

class Mixin<T> {
  constructor(protected defaultVal: T) {}
  getDefault(): T { return this.defaultVal; }
}

// Pass specialized types as a tuple in the type parameter
class Derived<T> extends AddMixins(Base, Mixin)<[Base<T>, Mixin<T>]> {}

const instance = new Derived<string>(
  ["hello"],   // Base constructor args
  ["world"]    // Mixin constructor args
);

const val: string = instance.getValue();      // Type-safe!
const def: string = instance.getDefault();    // Type-safe!
```

### Interface-Based Mixins (`InterfaceObj`)

Sometimes, a mixin needs to access properties or methods of its base, but you don't want to create a hard dependency by inheriting from a specific base class. For this, you can use `AddMixinInterfaces`, which we document here under its common alias, `InterfaceObj`.

**Note:** The official exported name is `AddMixinInterfaces`. You can import it as `InterfaceObj` for clarity, as shown below.

This utility lets a mixin declare its dependencies via interfaces. `AddMixins` will then ensure at compile time that the base class you use implements these interfaces.

```typescript
import { AddMixins, AddMixinInterfaces as InterfaceObj } from '@firebrandanalytics/shared-utils';

// 1. Define the interface your mixin depends on
interface INode {
  id: string;
  getData(): any;
}

// 2. Create the mixin, "extending" from InterfaceObj<[...interfaces]>()
class LoggerMixin extends InterfaceObj<[INode]>() {
  constructor() {
    super(); // Constructor is simple, no base args needed
  }

  log(message: string) {
    // TypeScript knows `this.id` exists from the INode interface
    console.log(`[${this.id}] ${message}`);
  }
}

// 3. Define a base class that implements the interface
class EntityNode implements INode {
  constructor(public id: string, private data: any) {}
  getData() { return this.data; }
}

// 4. Compose them. TypeScript will not error because EntityNode satisfies INode.
class LoggableEntity extends AddMixins(EntityNode, LoggerMixin)<[EntityNode, LoggerMixin]> {
  constructor(id: string, data: any) {
    super(
      [id, data],  // EntityNode args
      []           // LoggerMixin args
    );
  }
}
```

### Lifecycle Hooks: `init()`

If a base or mixin class defines an `init()` method, it will be called automatically after the instance has been fully constructed. The `init()` methods are called in order: base class first, then each mixin in the order they were provided.

```typescript
class Base {
  init?() {
    console.log("Base initialized");
  }
}

class LoggerMixin {
  init?() {
    console.log("Logger initialized");
  }
}

class MyClass extends AddMixins(Base, LoggerMixin)<[Base, LoggerMixin]> {}

const instance = new MyClass([], []);
// Console output:
// "Base initialized"
// "Logger initialized"
```

---

## 2. Composition-Based Mixins (`ComposeMixins`)

This is an alternative pattern that favors composition over inheritance. Instead of creating one class with a merged prototype chain, `ComposeMixins` instantiates each mixin as a separate object and attaches them to the main instance. This keeps functionality decoupled.

The system is composed of three main parts:
- `ComposableBase`: The base class for your main object.
- `BaseMixin`: The base class for all mixin objects.
- `ComposeMixins`: The function that puts it all together.

### Basic Usage

```typescript
import { ComposeMixins, ComposableBase, BaseMixin } from '@firebrandanalytics/shared-utils';

// 1. Define Mixins that extend BaseMixin
class NavigationMixin extends BaseMixin<MyBot> {
  navigateTo(destination: string) {
    console.log(`Navigating to ${destination} via ${this.base.transportMode}`);
  }
}

class GreeterMixin extends BaseMixin<MyBot> {
  greet(name: string) {
    console.log(this.base.getGreeting(name));
  }
}

// 2. Define a Base Class that extends ComposableBase
class MyBot extends ComposableBase<[NavigationMixin, GreeterMixin]> {
  transportMode = 'wheels';

  constructor() {
    super();
    this.initMixins(); // IMPORTANT: Call initMixins after construction
  }

  getGreeting(name: string) {
    return `Hello, ${name}!`;
  }
}

// 3. Create the final class using ComposeMixins
class FinalBot extends ComposeMixins(MyBot, NavigationMixin, GreeterMixin)<[MyBot, [NavigationMixin, GreeterMixin]]> {
    constructor() {
        super([], [], []); // Args for MyBot, NavigationMixin, GreeterMixin
    }
}

// 4. Use the composed bot
const bot = new FinalBot();
const nav = bot.getMixin(NavigationMixin); // Retrieve a mixin instance
const greeter = bot.getMixin(GreeterMixin);

nav.navigateTo('the store');
greeter.greet('World');
```

### Key Concepts

#### `ComposableBase` and `initMixins()`
Your main class must extend `ComposableBase`. After construction (e.g., in the `constructor`), you must call `this.initMixins()`. This method iterates through all attached mixin instances and calls their `init()` method, passing them a reference to the main instance (`this`). This is how mixins get access to the main object.

#### `BaseMixin` and `this.base`
Your mixin classes must extend `BaseMixin`. Once `initMixins()` is called, each mixin will have a `this.base` property that is a fully-typed reference to the main class instance. This allows mixins to call methods or access properties on the main object.

#### `getMixin(MixinClass)`
From your main class instance, you can retrieve the instance of any attached mixin by calling `getMixin()` with the mixin's class as an argument.

#### `replace_func()` for Method Wrapping
A powerful feature of `BaseMixin` is `replace_func`. It allows a mixin to safely wrap a method on the base instance, adding behavior before and/or after the original implementation. This creates a "chain of responsibility" if multiple mixins wrap the same method.

```typescript
// In a mixin...
class LoggingWrapperMixin extends BaseMixin<MyBot> {
  init() {
    super.init(this.base);

    // Wrap the 'getGreeting' method of the base
    this.replace_func('getGreeting', (original, name) => {
      console.log('LOG: getGreeting was called');
      // Call the original function
      const result = original(name);
      return `[LOGGED] ${result}`;
    });
  }
}
```

This is a safe way to implement decorators or aspects on the main object's logic from a loosely coupled module.
