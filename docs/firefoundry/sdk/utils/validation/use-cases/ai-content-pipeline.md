# AI Content Pipeline

Chain AI presets to translate, summarize, classify, and spell-check content in one declarative class.

---

## The Problem

You receive user-generated content -- articles, reviews, support tickets -- that needs multiple AI processing steps before it is ready for downstream consumers. The raw text needs spell-checking. You need a summary for search indexing. You need to classify the content into categories for routing. You need translations in multiple languages for international audiences.

Doing this imperatively means managing a cascade of API calls, tracking which calls depend on the output of others, handling retries when the LLM returns malformed output, and sequencing everything correctly. A typical implementation looks like this:

```typescript
// The imperative way -- fragile and hard to extend
const cleaned = await callLLM('Fix spelling: ' + raw);
const summary = await callLLM('Summarize: ' + cleaned);
const category = await callLLM('Classify: ' + cleaned);
if (!VALID_CATEGORIES.includes(category)) {
  // retry? throw? log and continue?
}
const spanishSummary = await callLLM('Translate to Spanish: ' + summary);
const frenchSummary = await callLLM('Translate to French: ' + summary);
```

Every new processing step means more ad-hoc plumbing. Retry logic is scattered. Dependencies between steps are implicit. Testing requires mocking every call individually.

What you want is to declare the desired output shape -- cleaned text, summaries at different lengths, a category from a fixed label set, translations of the summary -- and let the framework handle orchestration, dependency ordering, and retry loops.

## The Strategy

**Declarative AI pipeline with dependency-ordered execution.** Each property is annotated with an AI preset decorator. The validation engine resolves dependencies between properties, fans out independent transforms in parallel, and automatically retries when a downstream validator rejects an AI result.

| Decorator | Role in the pipeline |
|-----------|---------------------|
| `@AISpellCheck()` | Clean spelling and grammar errors in the raw input |
| `@DerivedFrom(source)` | Chain a property from the cleaned text so subsequent transforms operate on corrected input |
| `@AISummarize(target)` | Generate summaries at different lengths (`'short'`, `'medium'`, `'long'`) |
| `@AIClassify(labels)` | Classify into a fixed label set with fuzzy matching to normalize LLM output |
| `@AITranslate(language)` | Translate text into a target language |
| `@If(topic, predicate)` / `@Else()` / `@EndIf()` | Skip expensive transforms for content that does not need them (e.g., short text needs no summary) |

## Architecture

```
                         Raw User Content
                              |
                              v
                    +-------------------+
                    |   @AISpellCheck   |   Fix spelling & grammar
                    +-------------------+
                              |
                        cleanedContent
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
     +----------------+ +-----------+ +---------------+
     | @AISummarize   | |@AIClassify| | @AITranslate  |
     | 'short'/'medium'| | labels[] | | 'es' / 'fr'  |
     +----------------+ +-----------+ +---------------+
              |               |               |
              v               v               v
     +----------------+ +-----------+ +---------------+
     | @ValidateLength| | fuzzy     | | @DerivedFrom  |
     | min/max check  | | match to  | | summaryShort  |
     +----------------+ | label set | +---------------+
                        +-----------+
                              |
                              v
                     Validated Pipeline Output
```

Each branch runs in parallel where possible. The `@DerivedFrom` declarations tell the engine which properties must complete before others can start. The engine resolves the dependency graph automatically.

## Implementation

### 1. The ArticleProcessing class

```typescript
import {
  ValidationFactory,
  Copy,
  DerivedFrom,
  AISpellCheck,
  AISummarize,
  AIClassify,
  AITranslate,
  AITransform,
  If, Else, EndIf,
  ValidateLength,
} from '@firebrandanalytics/shared-utils/validation';

const CATEGORIES = [
  'Technology', 'Business', 'Science',
  'Health', 'Sports', 'Entertainment',
  'Politics', 'Education',
];

class ArticleProcessing {
  // --- Stage 1: Copy raw input and spell-check it ---
  @Copy()
  rawContent: string;

  @AISpellCheck()
  @DerivedFrom('rawContent')
  cleanedContent: string;

  // --- Stage 2: Summaries derived from cleaned content ---
  @AISummarize('short')
  @DerivedFrom('cleanedContent')
  @ValidateLength(10, 200)
  summaryShort: string;

  @AISummarize('medium')
  @DerivedFrom('cleanedContent')
  @ValidateLength(50, 500)
  summaryMedium: string;

  // --- Stage 3: Classification ---
  @AIClassify(CATEGORIES)
  @DerivedFrom('cleanedContent')
  category: string;

  // --- Stage 4: Translations of the short summary ---
  @AITranslate('Spanish')
  @DerivedFrom('summaryShort')
  summarySpanish: string;

  @AITranslate('French')
  @DerivedFrom('summaryShort')
  summaryFrench: string;
}
```

**Dependency graph the engine resolves:**

```
rawContent
  └─> cleanedContent (@AISpellCheck)
        ├─> summaryShort  (@AISummarize)
        │     ├─> summarySpanish (@AITranslate)
        │     └─> summaryFrench  (@AITranslate)
        ├─> summaryMedium (@AISummarize)
        └─> category      (@AIClassify)
```

### 2. Setting up the ValidationFactory with an AI handler

```typescript
// --- Mock handler for testing (swap for a real LLM in production) ---
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    // In production, call your LLM here:
    //   const response = await openai.chat.completions.create({ ... });
    //   return response.choices[0].message.content;
    return await myMockHandler(params, prompt);
  },
});

const article = await factory.create(ArticleProcessing, {
  rawContent: 'The langauge modle has improoved signficantly...',
});

console.log(article.cleanedContent);   // Spell-checked text
console.log(article.summaryShort);     // 1-2 sentence summary
console.log(article.category);         // "Technology"
console.log(article.summarySpanish);   // Spanish translation of summary
```

### 3. Cost-aware conditional processing with @If

For short content, summarization is wasteful -- the input is already short enough to use directly. Use `@If` to skip expensive AI calls:

```typescript
class SmartArticleProcessing {
  @Copy()
  rawContent: string;

  @AISpellCheck()
  @DerivedFrom('rawContent')
  cleanedContent: string;

  // Only summarize if the content is long enough to warrant it
  @If('cleanedContent', (text: string) => text.length > 500)
    @AISummarize('short')
    @DerivedFrom('cleanedContent')
  @Else()
    @DerivedFrom('cleanedContent')   // Use cleaned content as-is
  @EndIf()
  summaryShort: string;

  @AIClassify(CATEGORIES)
  @DerivedFrom('cleanedContent')
  category: string;

  @AITranslate('Spanish')
  @DerivedFrom('summaryShort')
  summarySpanish: string;
}
```

When `cleanedContent` is under 500 characters, the `@AISummarize` call is skipped entirely, saving one LLM round trip per short article.

## What to Observe

Running the [companion example](../examples/ai-content-pipeline.ts) produces output like this:

```
=== AI Content Pipeline ===

--- Raw input ---
  "The langauge modle has improoved signficantly over the past
   year. Reserchers at several laeding universitys have publishd
   papers on new techniqes for trainng large neural netowrks..."

--- Pipeline result ---
  cleanedContent  : "The language model has improved significantly over the past
                     year. Researchers at several leading universities have published
                     papers on new techniques for training large neural networks..."
  summaryShort    : "Language models have improved significantly, with researchers
                     publishing new techniques for training large neural networks."
  summaryMedium   : "Over the past year, language models have seen significant
                     improvement. Researchers at leading universities published
                     papers on new training techniques for large neural networks,
                     advancing the state of the art in natural language processing."
  category        : "Technology"
  summarySpanish  : "Los modelos de lenguaje han mejorado significativamente..."
  summaryFrench   : "Les modeles de langage se sont considerablement ameliores..."
```

**Understanding the retry loop:**

When `@AIClassify(CATEGORIES)` asks the LLM to classify text and the LLM returns `"Tech"` instead of `"Technology"`, the decorator first attempts fuzzy matching against the label set. If fuzzy matching finds a candidate above the threshold, it normalizes silently. If not, the library retries the AI call with error context:

```
Attempt 1: LLM returns "Tech & Science"
  -> Fuzzy match fails (no label above threshold)
  -> Retry with: "Classify into one of: Technology, Business, Science, ...
     Previous attempt returned 'Tech & Science' which did not match any label.
     Return exactly one label from the list."
Attempt 2: LLM returns "Technology"
  -> Exact match. Done.
```

The same retry mechanism applies to all AI decorators. If `@AISummarize('short')` produces a summary that fails `@ValidateLength(10, 200)` (e.g., it returns 300 characters), the engine retries with the validation error message included in the prompt, giving the LLM concrete guidance on what to fix.

## Variations

### 1. Cost-aware conditional AI

Only run expensive transforms on content that needs them:

```typescript
class CostAwareArticle {
  @Copy()
  rawContent: string;

  @AISpellCheck()
  @DerivedFrom('rawContent')
  cleanedContent: string;

  // Skip medium summary for short articles
  @If('cleanedContent', (text: string) => text.length > 1000)
    @AISummarize('medium')
    @DerivedFrom('cleanedContent')
  @Else()
    @DerivedFrom('cleanedContent')
  @EndIf()
  summaryMedium: string;

  // Skip translation for already-English-only audiences
  @If('category', (cat: string) => cat !== 'Local News')
    @AITranslate('Spanish')
    @DerivedFrom('summaryShort')
  @Else()
    @DerivedFrom('summaryShort')
  @EndIf()
  summarySpanish: string;
}
```

### 2. Multiple AI providers via metadata routing

Use `metadata` to route different transforms to different models:

```typescript
class MultiProviderArticle {
  // Use a fast model for spell-checking
  @AITransform(
    (params) => `Fix all spelling and grammar errors:\n${params.value}`,
    { metadata: { model: 'gpt-4o-mini', temperature: 0.1 } }
  )
  @DerivedFrom('rawContent')
  cleanedContent: string;

  // Use a powerful model for nuanced summarization
  @AITransform(
    (params) => `Summarize in 1-2 sentences:\n${params.value}`,
    { metadata: { model: 'gpt-4o', temperature: 0.3 } }
  )
  @DerivedFrom('cleanedContent')
  summaryShort: string;
}

// The aiHandler routes based on metadata:
const factory = new ValidationFactory({
  aiHandler: async (params, prompt) => {
    const model = params.metadata?.model ?? 'gpt-4o-mini';
    return await callLLM(model, prompt);
  },
});
```

### 3. Custom prompts with @AITransform for domain-specific transforms

When the presets do not fit, use `@AITransform` with a custom prompt:

```typescript
class LegalDocumentProcessing {
  @Copy()
  rawContent: string;

  @AITransform(
    (params) =>
      `Extract all legal entity names (companies, individuals, government bodies) ` +
      `from the following text. Return as a comma-separated list.\n\n${params.value}`,
    { maxRetries: 2, description: 'Extract legal entities' }
  )
  @DerivedFrom('rawContent')
  entities: string;

  @AITransform(
    (params) =>
      `Rewrite the following legal text in plain English suitable for a ` +
      `non-lawyer audience. Preserve all factual claims.\n\n${params.value}`,
    { metadata: { model: 'gpt-4o' } }
  )
  @DerivedFrom('rawContent')
  plainEnglish: string;
}
```

### 4. Chaining @AIJSONRepair for graceful fallback

When an AI transform produces malformed JSON, chain `@AIJSONRepair` to fix it before validation:

```typescript
class StructuredExtraction {
  @AITransform(
    (params) =>
      `Extract the following fields as JSON: { "title", "author", "date" }\n\n${params.value}`,
    { maxRetries: 2 }
  )
  @AIJSONRepair()
  @DerivedFrom('rawContent')
  metadata: string;
}
```

`@AIJSONRepair` attempts to fix common JSON issues (unquoted keys, trailing commas, mismatched brackets) before the value reaches any downstream validator. If the repair fails, it falls through to the standard retry loop.

## See Also

- [Conceptual Guide](../concepts.md) -- Decorator pipeline model, AI integration philosophy, dependency resolution
- [API Reference](../validation-library-reference.md) -- Full AI decorator signatures, preset options, handler interfaces
- [Getting Started Tutorial](../validation-library-getting-started.md) -- Your first validated class
- [Intermediate Tutorial](../validation-library-intermediate.md) -- DerivedFrom, context, conditionals, AI transforms
- [Validation Integration Patterns](../../../agent_sdk/feature_guides/validation-integration-patterns.md) -- Using AI handlers with the Agent SDK broker and bots
- [LLM Output Canonicalization (use case)](./llm-output-canonicalization.md) -- Clean and normalize structured data from LLMs without AI calls
- [Runnable example](../examples/ai-content-pipeline.ts) -- Self-contained TypeScript program you can execute with `npx tsx`
