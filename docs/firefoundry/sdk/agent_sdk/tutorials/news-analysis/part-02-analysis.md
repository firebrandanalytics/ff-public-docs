# Part 2: AI Analysis

In this part you'll create the structured output pipeline that powers the impact analysis: Zod schemas to define and validate the output format, a prompt that instructs the LLM, and a bot that ties it all together with automatic validation.

> **Prerequisite:** Complete [Part 1: Bundle & Web Search](./part-01-bundle.md) first.

## Step 1: Define the Zod Schemas

Create Zod schemas that define the exact shape of the AI's output. The `StructuredOutputBotMixin` uses these schemas for two purposes: generating schema documentation that gets injected into the prompt, and validating the LLM's JSON response.

**`apps/news-analysis-bundle/src/schemas.ts`**:

```typescript
import { z } from "zod";

export const VerticalImpactSchema = z.object({
  impact_level: z
    .enum(["none", "low", "medium", "high", "critical"])
    .describe("Severity of impact on this vertical"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the assessment (0.0 to 1.0)"),
  reasoning: z
    .string()
    .describe("Brief explanation of why this impact level was assigned"),
  key_factors: z
    .array(z.string())
    .describe("Specific factors from the article driving this assessment"),
});

export const ImpactAnalysisSchema = z.object({
  article_summary: z
    .string()
    .describe("Concise 2-3 sentence summary of the article"),
  healthcare: VerticalImpactSchema.describe(
    "Impact assessment for the healthcare vertical"
  ),
  shipping_logistics: VerticalImpactSchema.describe(
    "Impact assessment for the shipping and logistics vertical"
  ),
  technology: VerticalImpactSchema.describe(
    "Impact assessment for the technology vertical"
  ),
  overall_significance: z
    .enum(["low", "medium", "high"])
    .describe(
      "Overall significance of this article across all verticals combined"
    ),
});

export type IMPACT_ANALYSIS_OUTPUT = z.infer<typeof ImpactAnalysisSchema>;
```

**Key concepts:**

- `.describe()` on each field generates documentation that the `StructuredOutputBotMixin` injects into the prompt automatically. The LLM sees both the field names and their descriptions.
- `VerticalImpactSchema` is reused for all three verticals, keeping the schema DRY.
- `z.infer<typeof ImpactAnalysisSchema>` generates the TypeScript type from the Zod schema -- single source of truth for both runtime validation and type checking.
- If the LLM returns JSON that doesn't match the schema, the bot retries automatically (up to `max_tries`).

---

## Step 2: Create the ImpactAnalysisPrompt

The prompt instructs the LLM on how to analyze articles. It uses the SDK's `Prompt` class with `PromptTemplateSectionNode` children for structured content organization.

**`apps/news-analysis-bundle/src/prompts/ImpactAnalysisPrompt.ts`**:

```typescript
import {
  Prompt,
  PromptTemplateSectionNode,
  PromptTemplateTextNode,
  PromptTemplateStructDataNode,
} from "@firebrandanalytics/ff-agent-sdk";
import type { PromptTypeHelper } from "@firebrandanalytics/ff-agent-sdk";

type ImpactPTH = PromptTypeHelper<
  string,
  { static: Record<string, never>; request: Record<string, never> },
  any
>;

const SAMPLE_OUTPUT = {
  article_summary:
    "A new FDA-approved drug delivery system uses drone technology to reach remote areas, combining healthcare innovation with logistics optimization.",
  healthcare: {
    impact_level: "high",
    confidence: 0.85,
    reasoning:
      "Direct healthcare delivery improvement with FDA regulatory implications",
    key_factors: [
      "FDA approval of new delivery method",
      "Improved access to remote populations",
      "Regulatory precedent for drone-based medical delivery",
    ],
  },
  shipping_logistics: {
    impact_level: "medium",
    confidence: 0.7,
    reasoning:
      "Drone delivery represents a complementary logistics channel rather than replacement",
    key_factors: [
      "New last-mile delivery paradigm",
      "Limited payload capacity constrains scope",
      "Regulatory framework still evolving",
    ],
  },
  technology: {
    impact_level: "medium",
    confidence: 0.75,
    reasoning:
      "Advances in autonomous navigation and payload management have broader applications",
    key_factors: [
      "Autonomous flight path optimization",
      "Temperature-controlled payload systems",
      "Integration with existing logistics software",
    ],
  },
  overall_significance: "high",
};

export class ImpactAnalysisPrompt extends Prompt<ImpactPTH> {
  constructor() {
    super({
      role: "system",
      static_args: {} as Record<string, never>,
    });

    // Task section
    const taskSection = new PromptTemplateSectionNode<ImpactPTH>({
      semantic_type: "context",
      name: "task",
      children: [
        new PromptTemplateTextNode<ImpactPTH>({
          content: `You are an expert business analyst specializing in cross-industry impact assessment.

Your task is to analyze a news article and evaluate its potential business impact across three specific verticals: Healthcare, Shipping & Logistics, and Technology.

For each vertical, provide:
- An impact level (none, low, medium, high, or critical)
- A confidence score between 0.0 and 1.0
- Clear reasoning for your assessment
- Specific key factors from the article that drive your assessment

Also provide a concise 2-3 sentence summary of the article and an overall significance rating.`,
        }),
      ],
    });

    // Rules section
    const rulesSection = new PromptTemplateSectionNode<ImpactPTH>({
      semantic_type: "rule",
      name: "rules",
      children: [
        new PromptTemplateTextNode<ImpactPTH>({
          name: "impact_guidelines",
          content: `## Impact Level Guidelines

- **none**: The article has no relevance to this vertical
- **low**: Minor or indirect relevance; unlikely to affect business operations
- **medium**: Moderate relevance; could influence strategy or operations within 6-12 months
- **high**: Significant relevance; likely to affect business operations within 3-6 months
- **critical**: Immediate and major relevance; requires urgent attention

## Confidence Scoring

- 0.0-0.3: Very uncertain - article provides minimal evidence for this vertical
- 0.3-0.5: Somewhat uncertain - indirect evidence or speculative connections
- 0.5-0.7: Moderately confident - reasonable evidence supports the assessment
- 0.7-0.9: Highly confident - strong evidence directly supports the assessment
- 0.9-1.0: Very high confidence - article explicitly discusses this vertical with clear implications

## Overall Significance

- **low**: No vertical has impact above "low"
- **medium**: At least one vertical has "medium" or "high" impact
- **high**: At least one vertical has "high" or "critical" impact, or multiple verticals are affected at "medium" or above`,
        }),
      ],
    });

    // Verticals section
    const verticalsSection = new PromptTemplateSectionNode<ImpactPTH>({
      semantic_type: "context",
      name: "verticals",
      children: [
        new PromptTemplateTextNode<ImpactPTH>({
          name: "vertical_definitions",
          content: `## Vertical Definitions

### Healthcare
Encompasses pharmaceutical companies, hospitals, health insurance providers, medical device manufacturers, telehealth platforms, and public health policy. Consider impacts on drug development, patient care delivery, health data privacy, regulatory compliance (FDA, HIPAA), and healthcare workforce.

### Shipping & Logistics
Encompasses freight carriers, warehouse operators, last-mile delivery, supply chain management, port operations, and trade compliance. Consider impacts on transportation costs, delivery timelines, inventory management, customs and trade regulations, and logistics technology adoption.

### Technology
Encompasses software companies, hardware manufacturers, cloud service providers, AI/ML platforms, cybersecurity firms, and semiconductor manufacturers. Consider impacts on technology adoption, platform competition, data governance, R&D investment, and workforce skills requirements.`,
        }),
      ],
    });

    // Sample output section
    const sampleSection = new PromptTemplateSectionNode<ImpactPTH>({
      semantic_type: "sample_output",
      name: "sample_output",
      children: [
        new PromptTemplateTextNode<ImpactPTH>({
          content: "Here is an example of the expected output format:",
        }),
        new PromptTemplateStructDataNode<ImpactPTH>({
          data: SAMPLE_OUTPUT,
        }),
      ],
    });

    this.add_section(taskSection);
    this.add_section(rulesSection);
    this.add_section(verticalsSection);
    this.add_section(sampleSection);
  }
}

export type { ImpactPTH };
```

**Key concepts:**

- **`PromptTemplateSectionNode`** groups related content with a `semantic_type` (`"context"`, `"rule"`, `"sample_output"`). Sections are rendered in order when the prompt is serialized.
- **`PromptTemplateTextNode`** holds static text content. Use it for instructions, guidelines, and definitions.
- **`PromptTemplateStructDataNode`** serializes a JavaScript object as structured data in the prompt. It's used here to show the LLM a sample output so it understands the expected JSON structure.
- **System role**: The prompt is set to `role: "system"`. The article text comes from a separate user-role prompt in the bot's input section (see Step 3).
- **`PromptTypeHelper`**: The type parameters specify the prompt's input type (string), static args (none), and request args (none). These types flow through the bot for type safety.

---

## Step 3: Create the ImpactAnalysisBot

The bot uses the `MixinBot` + `StructuredOutputBotMixin` composition pattern. `MixinBot` provides base bot functionality, and `StructuredOutputBotMixin` adds Zod schema validation and automatic schema documentation injection.

**`apps/news-analysis-bundle/src/bots/ImpactAnalysisBot.ts`**:

```typescript
import {
  MixinBot,
  StructuredOutputBotMixin,
  StructuredPromptGroup,
  PromptGroup,
  Prompt,
  PromptTemplateTextNode,
  RegisterBot,
} from "@firebrandanalytics/ff-agent-sdk";
import { ComposeMixins } from "@firebrandanalytics/shared-utils";
import type {
  BotTypeHelper,
} from "@firebrandanalytics/ff-agent-sdk";
import type { BrokerTextContent } from "@firebrandanalytics/shared-types";
import { ImpactAnalysisSchema, type IMPACT_ANALYSIS_OUTPUT } from "../schemas.js";
import { ImpactAnalysisPrompt, type ImpactPTH } from "../prompts/ImpactAnalysisPrompt.js";

export type ImpactAnalysisPTH = ImpactPTH;

export type ImpactAnalysisBTH = BotTypeHelper<
  ImpactAnalysisPTH,
  IMPACT_ANALYSIS_OUTPUT,
  IMPACT_ANALYSIS_OUTPUT,
  any,
  BrokerTextContent
>;

class ImpactAnalysisBotBase extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<ImpactAnalysisBTH, [StructuredOutputBotMixin<ImpactAnalysisBTH, typeof ImpactAnalysisSchema>]>,
  [StructuredOutputBotMixin<ImpactAnalysisBTH, typeof ImpactAnalysisSchema>]
]> {
  constructor() {
    const inputPrompt = new Prompt<ImpactAnalysisPTH>({
      role: "user",
      static_args: {} as Record<string, never>,
    });
    inputPrompt.add_section(
      new PromptTemplateTextNode<ImpactAnalysisPTH>({
        content: (request) => request.input as string,
      })
    );

    const promptGroup = new StructuredPromptGroup<ImpactAnalysisPTH>({
      base: new PromptGroup<ImpactAnalysisPTH>([
        { name: "impact_analysis_prompt", prompt: new ImpactAnalysisPrompt() },
      ]),
      input: new PromptGroup<ImpactAnalysisPTH>([
        { name: "article_input", prompt: inputPrompt },
      ]),
    });

    super(
      [{
        name: "ImpactAnalysisBot",
        model_pool_name: "firebrand-gpt-5.2-failover",
        base_prompt_group: promptGroup,
        static_args: {} as Record<string, never>,
        max_tries: 3,
      }],
      [{ schema: ImpactAnalysisSchema }]
    );
  }
}

@RegisterBot("ImpactAnalysisBot")
export class ImpactAnalysisBot extends ImpactAnalysisBotBase {
  public override get_semantic_label_impl(): string {
    return "ImpactAnalysisBot";
  }
}
```

**Key concepts:**

- **`ComposeMixins(MixinBot, StructuredOutputBotMixin)`** creates a base class that composes bot functionality with structured output validation. Like `AddMixins`, each tuple in `super()` maps to one class in the chain.
- **`StructuredPromptGroup`** separates the prompt into `base` (system instructions, always sent) and `input` (per-request content). The base section contains the `ImpactAnalysisPrompt`; the input section contains a dynamic user-role prompt that renders the article text.
- **`PromptGroup`** wraps one or more named prompts. The `base` and `input` fields in `StructuredPromptGroup` must be `PromptGroup` instances, not plain objects.
- **Dynamic input**: The input prompt uses a callback `(request) => request.input as string` to render the article text passed by `ArticleEntity.get_bot_request_args_impl()`.
- **`@RegisterBot("ImpactAnalysisBot")`** registers the bot in the global component registry. `BotRunnableEntityMixin` looks it up by this name when `ArticleEntity.run()` is called.
- **`get_semantic_label_impl()`** must be overridden on every concrete bot class -- the base `Bot` class throws an error by default.
- **`max_tries: 3`** means the bot will retry up to 3 times if the LLM returns invalid JSON that doesn't match the Zod schema.
- **`model_pool_name`** specifies which model pool to route through. The broker handles model selection, failover, and rate limiting.

---

## Step 4: How It All Connects

Here's the full flow when `SearchEntity.run_search()` calls `article.run()`:

1. `BotRunnableEntityMixin` looks up `"ImpactAnalysisBot"` from the global registry
2. It calls `get_bot_request_args_impl()` on the `ArticleEntity`
3. The entity builds the input string: `"Title: ...\n\nArticle:\n..."`
4. The bot renders the `StructuredPromptGroup`:
   - **System message**: `ImpactAnalysisPrompt` (task, rules, verticals, sample output) + Zod schema documentation
   - **User message**: The article text
5. The bot sends the prompt to the broker via the `firebrand-gpt-5.2-failover` model pool
6. The LLM returns JSON
7. `StructuredOutputBotMixin` validates the JSON against `ImpactAnalysisSchema`
8. If validation fails, the bot retries (up to `max_tries`)
9. The validated `IMPACT_ANALYSIS_OUTPUT` is returned to the `SearchEntity`
10. The `SearchEntity` stores the analysis in the article's data

---

## Step 5: Test the Analysis

After deploying (see Part 1, Step 5), run a search and verify the analysis output:

```bash
ff-sdk-cli api call search \
  --method POST \
  --body '{"query":"drone delivery regulations","limit":2}' \
  --url http://localhost:3001
```

Each article in the response should have a non-null `analysis` field with:
- `article_summary` -- 2-3 sentence summary
- `healthcare`, `shipping_logistics`, `technology` -- each with `impact_level`, `confidence`, `reasoning`, `key_factors`
- `overall_significance` -- "low", "medium", or "high"

Use `ff-telemetry-read` to inspect the broker request and see the rendered prompt:

```bash
ff-telemetry-read
```

---

**Next:** [Part 3: Web UI](./part-03-gui.md) -- build a Next.js frontend with search input and impact visualization.
