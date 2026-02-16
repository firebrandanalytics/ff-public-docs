# Debugging Mysterious Failures

Advanced debugging patterns for situations where standard diagnostics don't reveal the root cause. These are the "why isn't this working?" scenarios that require deeper investigation.

## FFError vs Standard Errors

### The Rethrow Problem

Standard JavaScript errors lose their original stack trace when rethrown:

```typescript
try {
  await deeplyNestedFunction(); // Original error at line 42
} catch (e) {
  throw e; // Stack now points HERE, not line 42
}
```

When you see a stack trace pointing to a catch block, you've lost the original error location.

### FFError Preserves Origin

FireFoundry's `FFError` class specifically preserves the original stack trace:

```typescript
import { FFError } from '@firebrandanalytics/shared-types';

try {
  await riskyOperation();
} catch (e) {
  throw new FFError(e); // Preserves original stack!
}
```

**Diagnostic implication:**
- If you see an `FFError` (or subclass), the stack trace should lead to the original throw site
- If you see a standard `Error`, the stack may only show the final rethrow location

### Finding the Real Error

When a stack trace points to a rethrow:

```bash
# Search for where the error type is originally thrown
grep -r "throw new.*ErrorType" src/

# Look for the error message origin
grep -r "the error message text" src/

# Check for catch blocks that might be rethrowing
grep -A3 "catch.*error" src/
```

## Async Logging Gotchas

### Out-of-Order Logs

Winston logging is asynchronous. Logs may appear out of order, especially under load:

```typescript
logger.info("Step 1");
logger.info("Step 2");
logger.info("Step 3");
// In logs, might appear as: Step 1, Step 3, Step 2
```

**Diagnostic tip:** Use timestamps to reconstruct order:

```bash
# Sort logs by timestamp
cat logs/*.log | jq -s 'sort_by(.timestamp)'

# Or filter by time range
cat logs/*.log | jq -s '[.[] | select(.timestamp > "2025-01-10T10:00:00")] | sort_by(.timestamp)'
```

### Object Mutation Before Emit

Because logging is async, objects can be mutated between the log call and when the log is actually emitted:

```typescript
const state = { status: "pending", count: 0 };
logger.info("Current state", { state }); // Logs reference to object
state.status = "complete";  // Modified BEFORE logger emits!
state.count = 42;
// Log will show: { status: "complete", count: 42 } - NOT the value at log time!
```

This is especially confusing when debugging state transitions—the log shows the "wrong" value.

**Diagnostic approach:**

1. **Clone objects when logging:**
   ```typescript
   logger.info("Current state", { state: { ...state } }); // Shallow clone
   logger.info("Current state", { state: JSON.parse(JSON.stringify(state)) }); // Deep clone
   ```

2. **Log primitives when possible:**
   ```typescript
   logger.info("Current state", { status: state.status, count: state.count });
   ```

3. **Use synchronous console.log() to verify actual values:**
   ```typescript
   console.log("ACTUAL state at this moment:", JSON.stringify(state));
   logger.info("Current state", { state });
   ```

**Warning signs:** If logged values seem impossible given the code flow, suspect object mutation.

### Missing Logs (Infinite Loop)

If expected logs are mysteriously missing, you may have an infinite loop. The async logger never gets a chance to flush:

```typescript
while (someCondition) {  // If this never exits...
  doWork();
  logger.info("Working..."); // These logs may never appear!
}
```

**Diagnostic approach:**

1. **Use synchronous console.log()** to check for infinite loops:
   ```typescript
   while (someCondition) {
     console.log("Loop iteration", Date.now()); // Synchronous!
     doWork();
   }
   ```

2. **Add loop counters:**
   ```typescript
   let iterations = 0;
   while (someCondition) {
     if (++iterations > 10000) {
       console.error("INFINITE LOOP DETECTED");
       break;
     }
     doWork();
   }
   ```

### Process Exit Before Flush

If the process exits quickly, async logs may not be written:

```typescript
logger.info("Important message");
process.exit(0); // Logger may not have flushed!
```

**Solution:** Wait for logger to flush:
```typescript
logger.info("Important message");
logger.on('finish', () => process.exit(0));
logger.end();
```

## Unhandled Promise Rejections

### The Silent Killer

Unhandled promise rejections can cause mysterious failures:

```typescript
async function doWork() {
  throw new Error("Oops"); // If not awaited, this is silent!
}

doWork(); // No await, no .catch() = unhandled rejection
```

### Detection

Node.js emits warnings for unhandled rejections. Check for:

```bash
# In logs
grep -i "unhandled.*rejection\|UnhandledPromiseRejection" logs/*.log

# Node.js may log to stderr
grep -i "unhandled" /var/log/syslog  # or wherever stderr goes
```

### Common Patterns That Cause This

```typescript
// 1. Forgotten await
async function processItems(items) {
  items.forEach(async (item) => {
    await processItem(item); // forEach doesn't await!
  });
}

// 2. Fire-and-forget without catch
someAsyncFunction(); // No await, no .catch()

// 3. Promise in callback
setTimeout(() => {
  doAsyncWork(); // Unhandled if it throws
}, 1000);
```

### Fixes

```typescript
// 1. Use for...of for async iteration
for (const item of items) {
  await processItem(item);
}

// 2. Add .catch() for fire-and-forget
someAsyncFunction().catch(e => logger.error("Background task failed", { error: e }));

// 3. Wrap async in callbacks
setTimeout(async () => {
  try {
    await doAsyncWork();
  } catch (e) {
    logger.error("Timeout task failed", { error: e });
  }
}, 1000);
```

## Event Loop Blocking

### Symptoms

- API requests hang or timeout
- Logs stop appearing
- Process becomes unresponsive
- Health checks fail

### Causes

```typescript
// 1. Synchronous CPU-intensive work
for (let i = 0; i < 1000000000; i++) {
  // Blocks event loop!
}

// 2. Synchronous file operations
const data = fs.readFileSync(hugeFile); // Blocks!

// 3. JSON parsing large objects
const obj = JSON.parse(hugeJsonString); // Can block!

// 4. Regex catastrophic backtracking
/^(a+)+$/.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaa!"); // Exponential!
```

### Detection

```bash
# If you can still access the process:
node --inspect your-app.js
# Then use Chrome DevTools to capture CPU profile

# Check for blocked event loop in logs (if you have metrics)
grep -i "event.*loop\|blocked\|lag" logs/*.log
```

### Prevention

```typescript
// 1. Use async versions
const data = await fs.promises.readFile(hugeFile);

// 2. Break up CPU work
async function processLargeArray(items) {
  for (let i = 0; i < items.length; i++) {
    processItem(items[i]);
    if (i % 1000 === 0) {
      await new Promise(resolve => setImmediate(resolve)); // Yield to event loop
    }
  }
}

// 3. Stream large data
const stream = fs.createReadStream(hugeFile);
```

## Memory Issues

### Symptoms

- Process crashes with no error
- OOMKilled in Kubernetes
- Gradually increasing memory usage
- Performance degradation over time

### Detection

```bash
# Kubernetes OOM
kubectl describe pod <pod-name> -n <namespace> | grep -i "OOMKilled\|memory"

# Check resource limits
kubectl top pods -n <namespace>

# In logs
grep -i "heap\|memory\|allocation" logs/*.log
```

### Common Causes

```typescript
// 1. Accumulating data in closures
function createHandler() {
  const cache = []; // Never cleared!
  return (data) => {
    cache.push(data); // Grows forever
  };
}

// 2. Event listener leaks
emitter.on('data', handler); // Never removed

// 3. Unbounded caches
const cache = new Map();
function getData(key) {
  if (!cache.has(key)) {
    cache.set(key, fetchData(key)); // Never evicted!
  }
  return cache.get(key);
}

// 4. Circular references preventing GC
const a = {};
const b = { ref: a };
a.ref = b; // Circular - be careful with complex object graphs
```

### Debugging

```typescript
// Add memory logging
setInterval(() => {
  const used = process.memoryUsage();
  console.log(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
}, 10000);

// Or use --inspect for heap snapshots
node --inspect your-app.js
```

## Race Conditions

### Symptoms

- "Works sometimes"
- Different behavior under load
- Tests pass individually but fail together
- Order-dependent bugs

### Common Patterns

```typescript
// 1. Check-then-act race
if (!await exists(file)) {
  await createFile(file); // Another process might create it between check and create!
}

// 2. Read-modify-write race
const count = await getCount();
await setCount(count + 1); // Another process might have changed it!

// 3. Initialization race
let initialized = false;
let data = null;

async function getData() {
  if (!initialized) {
    data = await loadData(); // Multiple callers might all try to initialize
    initialized = true;
  }
  return data;
}
```

### Fixes

```typescript
// 1. Use atomic operations
await createFileIfNotExists(file); // Single atomic operation

// 2. Use transactions or locks
await db.transaction(async (tx) => {
  const count = await tx.getCount();
  await tx.setCount(count + 1);
});

// 3. Use once-style initialization
let dataPromise = null;

async function getData() {
  if (!dataPromise) {
    dataPromise = loadData(); // All callers share the same promise
  }
  return dataPromise;
}
```

## TypeScript/Compilation Issues

### Source Map Problems

Stack traces show compiled `.js` line numbers, not `.ts`:

```bash
# Ensure source maps are generated
grep -r "sourceMap" tsconfig.json

# Check if source maps exist
ls -la dist/*.js.map
```

### Type Mismatch at Runtime

TypeScript types don't exist at runtime. You can still have:

```typescript
interface User {
  name: string;
  age: number;
}

// At runtime, this could be anything!
const user = JSON.parse(someString) as User;
console.log(user.name.toUpperCase()); // Runtime error if name is undefined!
```

**Solution:** Use Zod or other runtime validation:
```typescript
const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});

const user = UserSchema.parse(JSON.parse(someString)); // Throws if invalid
```

## Debugging Checklist for Mysterious Failures

When nothing makes sense, try this systematic approach:

### 1. Verify Assumptions
```bash
# Is the code actually being executed?
console.log("CHECKPOINT 1"); # Synchronous!

# Is it the code you think it is?
console.log("Version:", require('./package.json').version);

# Are environment variables set?
console.log("CONFIG:", JSON.stringify(config));
```

### 2. Check for Swallowed Errors
```bash
# Search for empty catch blocks
grep -B1 -A1 "catch.*{" src/ | grep -A1 "catch" | grep "}"

# Search for catch blocks that don't log
grep -A5 "catch" src/*.ts | grep -v "logger\|console\|throw"
```

### 3. Look for Async Issues
```bash
# Find async functions without await at call site
grep -r "async function\|async (" src/ # Then check callers

# Find Promise without await or .catch
grep -r "new Promise\|\.then(" src/ # Check for unhandled rejections
```

### 4. Check Process State
```bash
# Is the process even running?
ps aux | grep node

# What's its memory/CPU usage?
top -p <pid>

# Is it stuck?
strace -p <pid> # Linux: what system calls is it making?
```

### 5. Isolate the Problem
```typescript
// Binary search for the issue
async function problematicFunction() {
  console.log("A");
  await step1();
  console.log("B");
  await step2();
  console.log("C"); // If C never prints, problem is in step2()
  await step3();
  console.log("D");
}
```

### 6. Check External Dependencies
```bash
# Can you reach the database?
psql -h $DB_HOST -U $DB_USER -c "SELECT 1"

# Can you reach external services?
curl -v http://service-name:port/health

# DNS working?
nslookup service-name
```

## Quick Reference

| Symptom | Likely Cause | First Check |
|---------|--------------|-------------|
| Stack trace points to catch block | Error rethrown without FFError | Search for original throw |
| Logs out of order | Async logging | Sort by timestamp |
| Logged values seem impossible | Object mutated before log emit | Clone objects or use console.log() |
| Logs missing entirely | Infinite loop or early exit | Add console.log() |
| Silent failure | Unhandled promise rejection | grep for unhandled rejection |
| Process hangs | Event loop blocked | Check for sync operations |
| OOMKilled | Memory leak | Check resource usage |
| Works sometimes | Race condition | Add logging around shared state |
| Wrong line numbers | Source maps or TS compilation | Verify source maps exist |

## When All Else Fails

1. **Add extensive synchronous logging** - `console.log()` everywhere
2. **Simplify** - Remove code until it works, then add back
3. **Reproduce locally** - Get it out of the cluster if possible
4. **Fresh environment** - Rule out stale state/cache
5. **Diff against working version** - What changed?
6. **Rubber duck** - Explain the problem out loud
7. **Sleep on it** - Fresh eyes often find obvious issues
