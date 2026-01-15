# General Utilities

The `@firebrandanalytics/shared-utils` package includes a number of general-purpose utility functions and prototype extensions to simplify common tasks.

---

## Object & Type Helpers

A collection of functions for working with objects and checking types.

### `keys(obj)` and `values(obj)`

These are enhanced versions of `Object.keys()` and `Object.values()`. Unlike the built-in methods, these helpers will also include keys and values from an object's prototype chain (i.e., inherited properties).

```typescript
function Parent() {
  this.parentProp = 'parent';
}
const child = new Parent();
child.childProp = 'child';

// Standard Object.keys only shows own properties
console.log(Object.keys(child)); // ['childProp']

// The utility 'keys' includes inherited properties
import { keys } from '@firebrandanalytics/shared-utils';
console.log(keys(child)); // ['childProp', 'parentProp']
```

### `extend(obj1, ...sources)`

Merges the contents of one or more source objects into a target object (`obj1`). This function mutates `obj1`. It is an alias for `Object.assign()`.

### `merge(...sources)`

Similar to `extend`, but does **not** mutate any of the source objects. It creates a new shallow copy of the first object and merges subsequent objects into it.

### `isString(value)` and `isGeneratorFunction(value)`

Simple type guards to check if a value is a string or a Generator function, respectively.

### `sleep_promise(delay, resolveValue?)`

A utility that returns a promise that resolves after a specified `delay` in milliseconds.

```typescript
async function delayedLog() {
  console.log('Waiting...');
  await sleep_promise(1000); // Wait for 1 second
  console.log('Done.');
}
```

---

## Prototype Extensions

The library extends the prototypes of some built-in JavaScript objects to add useful functionality.

### `Function.prototype` Extensions

These extensions allow you to call a function using named parameters from an object or a Map, rather than positional arguments.

#### `getParameters()`
Inspects a function and returns a `Map` of its parameter names and default values.

```typescript
function myFunc(a, b = 10) {
  // ...
}
const params = myFunc.getParameters();
// params is a Map: { 'a' => undefined, 'b' => '10' }
```

#### `applyWithObject(invocant, obj)`
Executes the function, mapping properties from the `obj` argument to the function's parameters by name.

```typescript
function greet(name, message) {
  return `${message}, ${name}!`;
}

const args = { name: 'World', message: 'Hello' };

// Instead of greet(args.name, args.message)
const result = greet.applyWithObject(null, args);

console.log(result); // "Hello, World!"
```

#### `applyWithMap(invocant, map)`
Same as `applyWithObject`, but takes a `Map` as the source of arguments.

### `Map.prototype` Extensions

- **`shallowCopy()`**: Returns a new Map containing the same key-value pairs as the original.
- **`head()`**: Returns the first `[key, value]` pair in the map, or `undefined` if the map is empty.

### `Array.prototype` Extensions

- **`last()`**: Returns the last element of the array, or `undefined` if the array is empty.
