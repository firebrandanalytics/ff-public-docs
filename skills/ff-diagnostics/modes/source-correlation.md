# Source Code Correlation

Techniques for finding where log messages originate in source code and understanding the control flow that led to an issue.

## Why Correlate with Source?

Log entries include source location:
```json
{
  "message": "Failed to process document",
  "properties": {
    "filename": "DocumentProcessor.ts",
    "functionName": "processDocument",
    "lineNumber": "142"
  }
}
```

Use this to:
- Find the exact code that logged the message
- Understand what conditions trigger the log
- Trace the control flow before/after
- Find related logs in the same function

## Finding Log Origins

### From Log Entry to Source

Given a log entry with source location:

```bash
# Direct lookup
Read src/services/DocumentProcessor.ts around line 142

# Or search for the message
Grep for "Failed to process document" in src/
```

### From Error Message to Source

When you have just an error message:

```bash
# Search for the exact message
Grep for "Failed to process document" in **/*.ts

# Search for partial message (in case of interpolation)
Grep for "Failed to process" in **/*.ts

# Find logger calls with this pattern
Grep for 'logger\.(error|warn|info).*process.*document' in **/*.ts
```

### From Entity Type to Related Logs

When investigating an entity type:

```bash
# Find all log statements mentioning the entity
Grep for "DocumentEntity" in **/*.ts

# Find the entity class
Glob for **/DocumentEntity.ts

# Find where this entity is processed
Grep for "DocumentEntity" in src/services/ src/workflows/
```

## Understanding Log Patterns

### FireFoundry Logger Usage

The Winston logger is typically used like:

```typescript
import logger from '@firebrandanalytics/shared-utils';

// Info logs
logger.info('Processing document', { documentId, status });

// Error logs
logger.error('Failed to process document', { error: e.message, documentId });

// Debug logs
logger.debug('Document details', { ...document });

// With breadcrumbs (from async context)
logger.info('Operation complete');  // breadcrumbs added automatically
```

### Finding All Logs in a File

```bash
# All logger calls in a file
Grep for "logger\." in src/services/DocumentProcessor.ts

# Just errors and warnings
Grep for "logger\.(error|warn)" in src/services/DocumentProcessor.ts
```

### Finding Logs by Level

```bash
# Find all error logs
Grep for "logger\.error" in src/

# Find all critical logs
Grep for "logger\.critical" in src/

# Find where specific level is used
Grep for "logger\.detail" in src/
```

## Tracing Control Flow

### Before the Log

When you find a log statement at line N, look above it:

```bash
# Read surrounding context
Read <file> from line (N-30) to (N+10)
```

Look for:
- Conditional statements (if/else, try/catch)
- Loop context
- Variable assignments
- Function calls that might have failed

### After the Log

Check what happens next:

```bash
# Read what follows
Read <file> from line N to (N+30)
```

Look for:
- Return statements
- Throw statements
- Subsequent operations
- Cleanup/finally blocks

### Caller Context

Find who calls this function:

```bash
# Find callers
Grep for "processDocument" in src/

# Or the function name from the log
Grep for "handleDocumentUpload" in **/*.ts
```

## Pattern: Full Investigation Flow

### Step 1: Get Log Details

From a log entry:
```json
{
  "message": "Failed to process document",
  "level": "error",
  "properties": {
    "filename": "DocumentProcessor.ts",
    "functionName": "processDocument",
    "lineNumber": "142",
    "documentId": "doc-123",
    "error": "Invalid format"
  }
}
```

### Step 2: Find the Source

```bash
# Go to the exact location
Read src/services/DocumentProcessor.ts around line 142
```

### Step 3: Understand the Context

```typescript
// Example of what you might find:
async processDocument(doc: Document): Promise<Result> {
  try {
    const parsed = await this.parser.parse(doc.content);  // line 139

    if (!parsed.isValid) {
      logger.error('Failed to process document', {    // line 142
        documentId: doc.id,
        error: 'Invalid format'
      });
      return { success: false, error: 'Invalid format' };
    }
    // ...
  } catch (e) {
    // ...
  }
}
```

### Step 4: Trace the Issue

Now you know:
- The error happens when `parsed.isValid` is false
- The parser is `this.parser`
- Next: investigate the parser

```bash
# Find parser implementation
Grep for "class.*Parser" in src/
# or
Grep for "parse\(.*content" in src/
```

### Step 5: Find Related Logs

```bash
# Other logs in this function
Grep for "logger\." in the same file around line 142

# All logs about documents
Grep for "document" in src/ --type ts | grep "logger\."
```

## Common Source Patterns

### Error Handling Pattern

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error: error.message });  // Look here
  throw error;  // Or look for re-throws
}
```

### Validation Pattern

```typescript
if (!isValid(input)) {
  logger.warn('Invalid input', { input });  // Validation failures
  return null;
}
```

### State Transition Pattern

```typescript
logger.info('Transitioning state', { from: current, to: next });
entity.status = next;
logger.info('State transition complete');
```

### Breadcrumb Pattern

```typescript
await FFAsyncLocalStorage.run({ breadcrumbs: [{ entity_type, entity_id }] }, async () => {
  // All logs in here will have breadcrumbs
  logger.info('Processing entity');
});
```

## Finding All Logs for an Entity Type

When investigating a specific entity:

```bash
# 1. Find the entity class
Glob for **/<EntityType>.ts

# 2. Find where it's used
Grep for "<EntityType>" in src/

# 3. Find log statements in those files
Grep for "logger\." in <files-from-step-2>
```

## Tips

### Use the Grep Tool

Claude's Grep tool is efficient for code search:
```
Grep for "error.*document" in src/ with context lines
```

### Read with Context

When viewing source, get enough context:
```
Read file.ts from line 120 to 180  # Not just the one line
```

### Follow the Types

TypeScript types often reveal the flow:
```bash
# Find type definition
Grep for "interface.*Document" in src/

# Find implementations
Grep for "implements.*Handler" in src/
```

### Check Tests

Tests often show expected behavior:
```bash
# Find related tests
Glob for **/*.test.ts | grep -i document

# Read test cases
Grep for "should.*document" in **/*.test.ts
```

### Map the Architecture

For complex issues, build a mental map:
```bash
# Find all services
Glob for src/services/**/*.ts

# Find workflows
Glob for src/workflows/**/*.ts

# Find entity handlers
Grep for "@EntityHandler" in src/
```
