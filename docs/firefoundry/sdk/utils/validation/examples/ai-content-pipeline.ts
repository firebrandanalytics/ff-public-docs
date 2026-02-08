/**
 * AI Content Pipeline
 *
 * Demonstrates chaining AI presets (@AISpellCheck, @AISummarize, @AIClassify,
 * @AITranslate) to process user-generated content through a declarative
 * pipeline. Uses @DerivedFrom for dependency ordering and @If for cost-aware
 * conditional processing.
 *
 * This example uses a mock AI handler that returns deterministic responses,
 * so it runs without an API key. See the comment in createMockAIHandler()
 * for how to swap in a real LLM.
 *
 * Run:  npx tsx ai-content-pipeline.ts
 */

import {
  ValidationFactory,
  Copy,
  DerivedFrom,
  AISpellCheck,
  AISummarize,
  AITranslate,
  AITransform,
  Validate,
  ValidateLength,
  AIHandlerParams,
} from '@firebrandanalytics/shared-utils';

// ============================================================
// Category label set
// ============================================================

const CATEGORIES = [
  'Technology', 'Business', 'Science',
  'Health', 'Sports', 'Entertainment',
  'Politics', 'Education',
];

// ============================================================
// Mock AI handler
// ============================================================

/**
 * Simulates AI responses for each decorator type. In production, replace
 * with a real LLM call:
 *
 *   const factory = new ValidationFactory({
 *     aiHandler: async (params, prompt) => {
 *       const response = await openai.chat.completions.create({
 *         model: params.metadata?.model ?? 'gpt-4o-mini',
 *         messages: [{ role: 'user', content: String(prompt) }],
 *         temperature: params.metadata?.temperature ?? 0.1,
 *       });
 *       return response.choices[0].message.content;
 *     },
 *   });
 */
function createMockAIHandler() {
  let callCount = 0;

  return async (params: AIHandlerParams, prompt: string | object): Promise<string> => {
    callCount++;
    const key = params.propertyKey;
    const value = String(params.value);
    const attempt = params.attemptNumber;

    console.log(
      `  [AI call #${callCount}] ${key} (attempt ${attempt}/${params.maxRetries})`
    );

    // --- @AISpellCheck: fix known misspellings ---
    if (key === 'cleanedContent') {
      const fixes: Record<string, string> = {
        'langauge': 'language',
        'modle': 'model',
        'improoved': 'improved',
        'signficantly': 'significantly',
        'Reserchers': 'Researchers',
        'laeding': 'leading',
        'universitys': 'universities',
        'publishd': 'published',
        'techniqes': 'techniques',
        'trainng': 'training',
        'netowrks': 'networks',
        'artifical': 'artificial',
        'intellignce': 'intelligence',
        'relevent': 'relevant',
        'applicatons': 'applications',
        'inclding': 'including',
        'healhtcare': 'healthcare',
        'educaton': 'education',
        'finace': 'finance',
      };
      let result = value;
      for (const [wrong, right] of Object.entries(fixes)) {
        result = result.replace(new RegExp(wrong, 'g'), right);
      }
      return result;
    }

    // --- @AISummarize('short') ---
    if (key === 'summaryShort') {
      return 'Language models have improved significantly, with researchers publishing new techniques for training large neural networks.';
    }

    // --- @AISummarize('medium') ---
    if (key === 'summaryMedium') {
      return (
        'Over the past year, language models have seen significant improvement. ' +
        'Researchers at leading universities published papers on new training techniques ' +
        'for large neural networks, advancing the state of the art in natural language ' +
        'processing with applications spanning healthcare, education, and finance.'
      );
    }

    // --- AI classification: return the best matching label ---
    if (key === 'category') {
      if (attempt === 1) {
        // First attempt: return a slightly off label to demonstrate retry
        return 'Tech & Science';
      }
      // Retry: return an exact label match
      return 'Technology';
    }

    // --- @AITranslate('Spanish') ---
    if (key === 'summarySpanish') {
      return (
        'Los modelos de lenguaje han mejorado significativamente, con investigadores ' +
        'publicando nuevas tecnicas para entrenar grandes redes neuronales.'
      );
    }

    // --- @AITranslate('French') ---
    if (key === 'summaryFrench') {
      return (
        'Les modeles de langage se sont considerablement ameliores, les chercheurs ' +
        'publiant de nouvelles techniques pour entrainer de grands reseaux neuronaux.'
      );
    }

    // --- Fallback for custom @AITransform calls ---
    return `[mock transform of ${key}]: ${value.slice(0, 80)}...`;
  };
}

// ============================================================
// Class 1 -- Full pipeline
// ============================================================

class ArticleProcessing {
  // Stage 1: copy raw input and spell-check it
  @Copy()
  rawContent!: string;

  @AISpellCheck()
  @DerivedFrom('rawContent')
  cleanedContent!: string;

  // Stage 2: summaries derived from cleaned content
  @AISummarize('short')
  @DerivedFrom('cleanedContent')
  @ValidateLength(10, 200)
  summaryShort!: string;

  @AISummarize('medium')
  @DerivedFrom('cleanedContent')
  @ValidateLength(50, 500)
  summaryMedium!: string;

  // Stage 3: classification into fixed label set
  // Use @AITransform to classify the cleaned text into a category label.
  // The prompt reads from params.instance.cleanedContent rather than using
  // @DerivedFrom, since the engine retries must not re-source the value.
  @AITransform(
    (params: AIHandlerParams) =>
      `Classify the following text into one of: ${CATEGORIES.join(', ')}. ` +
      `Return only the best label.\n\nInput:\n${(params.instance as any).cleanedContent ?? params.value}`,
    { description: `AI classify (${CATEGORIES.join(', ')})`, dependsOn: ['cleanedContent'] }
  )
  @Validate(
    (v: string) => CATEGORIES.includes(v) || `Must be one of: ${CATEGORIES.join(', ')}`,
    'Label validation'
  )
  category!: string;

  // Stage 4: translations of the short summary
  @AITranslate('Spanish')
  @DerivedFrom('summaryShort')
  summarySpanish!: string;

  @AITranslate('French')
  @DerivedFrom('summaryShort')
  summaryFrench!: string;
}

// ============================================================
// Class 2 -- Cost-aware pipeline with @If
// ============================================================

class SmartArticleProcessing {
  @Copy()
  rawContent!: string;

  @AISpellCheck()
  @DerivedFrom('rawContent')
  cleanedContent!: string;

  // Summarize the cleaned content (same as full pipeline for simplicity)
  @AISummarize('short')
  @DerivedFrom('cleanedContent')
  @ValidateLength(10, 200)
  summaryShort!: string;

  @AITransform(
    (params: AIHandlerParams) =>
      `Classify the following text into one of: ${CATEGORIES.join(', ')}. ` +
      `Return only the best label.\n\nInput:\n${(params.instance as any).cleanedContent ?? params.value}`,
    { description: `AI classify (${CATEGORIES.join(', ')})`, dependsOn: ['cleanedContent'] }
  )
  @Validate(
    (v: string) => CATEGORIES.includes(v) || `Must be one of: ${CATEGORIES.join(', ')}`,
    'Label validation'
  )
  category!: string;

  @AITranslate('Spanish')
  @DerivedFrom('summaryShort')
  summarySpanish!: string;
}

// ============================================================
// Sample content
// ============================================================

const LONG_ARTICLE =
  'The langauge modle has improoved signficantly over the past year. ' +
  'Reserchers at several laeding universitys have publishd papers on new ' +
  'techniqes for trainng large neural netowrks. These advances in artifical ' +
  'intellignce are relevent to many applicatons, inclding healhtcare, ' +
  'educaton, and finace. The pace of innovation continues to accelerate ' +
  'as more organizations invest in fundamental research and open-source ' +
  'tooling for the broader machine learning community.';

const SHORT_ARTICLE = 'The langauge modle has improoved signficantly.';

// ============================================================
// Helper
// ============================================================

function printResult(label: string, obj: Record<string, unknown>): void {
  console.log(`\n--- ${label} ---`);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'function') continue;
    const display = typeof value === 'string' ? `"${value}"` : String(value);
    // Wrap long strings for readability
    if (display.length > 80) {
      console.log(`  ${key.padEnd(18)} : ${display.slice(0, 78)}...`);
    } else {
      console.log(`  ${key.padEnd(18)} : ${display}`);
    }
  }
}

// ============================================================
// Demo 1 -- Full pipeline
// ============================================================

async function demoFullPipeline(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 1: Full AI Content Pipeline');
  console.log('========================================');

  console.log('\n--- Raw input ---');
  console.log(`  "${LONG_ARTICLE.slice(0, 78)}..."`);

  console.log('\n--- AI calls (in dependency order) ---');
  const result = await factory.create(ArticleProcessing, {
    rawContent: LONG_ARTICLE,
  });

  printResult('Pipeline result', result as unknown as Record<string, unknown>);
}

// ============================================================
// Demo 2 -- Cost-aware conditional pipeline
// ============================================================

async function demoCostAware(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 2: Simplified Pipeline (short input)');
  console.log('========================================');

  console.log('\n--- Raw input (short) ---');
  console.log(`  "${SHORT_ARTICLE}"`);

  console.log('\n--- AI calls ---');
  const result = await factory.create(SmartArticleProcessing, {
    rawContent: SHORT_ARTICLE,
  });

  printResult('Pipeline result', result as unknown as Record<string, unknown>);
  console.log(
    '\n  Note: SmartArticleProcessing runs spell-check, summarize, classify,'
  );
  console.log('  and translate -- same as full pipeline but fewer output fields.');
}

// ============================================================
// Demo 3 -- Full pipeline with long content
// ============================================================

async function demoCostAwareLong(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 3: Simplified Pipeline (long input)');
  console.log('========================================');

  console.log('\n--- Raw input (long) ---');
  console.log(`  "${LONG_ARTICLE.slice(0, 78)}..."`);

  console.log('\n--- AI calls ---');
  const result = await factory.create(SmartArticleProcessing, {
    rawContent: LONG_ARTICLE,
  });

  printResult('Pipeline result', result as unknown as Record<string, unknown>);
  console.log(
    '\n  Note: Same pipeline as Demo 2 but with longer input text.'
  );
}

// ============================================================
// Demo 4 -- Retry behavior demonstration
// ============================================================

async function demoRetryBehavior(factory: ValidationFactory): Promise<void> {
  console.log('\n========================================');
  console.log(' Demo 4: Retry Behavior (@AITransform + @Validate)');
  console.log('========================================');

  console.log(
    '\n  The mock handler deliberately returns "Tech & Science" on the'
  );
  console.log(
    '  first classify attempt. The @Validate decorator detects this does'
  );
  console.log(
    '  not match any label in the set. The engine retries the AI transform,'
  );
  console.log('  and the second attempt returns "Technology" (an exact match).');
  console.log(
    '\n  Watch the AI call log above -- you will see retry calls for'
  );
  console.log('  the "category" property demonstrating automatic retry.');
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log('=== AI Content Pipeline Examples ===');
  console.log(
    'Declarative AI processing: spell-check, summarize, classify, translate.\n'
  );

  const factory = new ValidationFactory({
    aiHandler: createMockAIHandler(),
  });

  await demoFullPipeline(factory);
  await demoCostAware(factory);
  await demoCostAwareLong(factory);
  await demoRetryBehavior(factory);

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
