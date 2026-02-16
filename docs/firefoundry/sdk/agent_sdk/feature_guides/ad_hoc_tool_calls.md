# Adding Tool Calls to FireFoundry Bots

## Overview

Tool calls allow your bots to invoke external functions during LLM processing, enabling "ad-hoc" capabilities like data lookup, calculations, or API calls. The LLM can decide when and how to use these tools based on the input and context.

In this tutorial, we'll extend our News Analysis bot to include tools for:
- Looking up company stock information
- Searching for related news articles
- Performing financial calculations

## Understanding Dispatch Tables

A dispatch table maps tool names to functions and their specifications. Each tool has:
- **func**: The actual function to execute
- **spec**: OpenAI-style function specification that tells the LLM how to use the tool

```typescript
const dispatchTable: DispatchTable<PTH, OUTPUT> = {
  tool_name: {
    func: async (request, args) => { /* implementation */ },
    spec: { /* OpenAI function spec */ }
  }
};
```

## Creating Tool Functions

Let's add practical tools to our news analysis bot:

```typescript
import { DispatchTable } from '@firebrandanalytics/ff-agent-sdk';

// Define the dispatch table for our news analysis tools
const newsAnalysisTools: DispatchTable<IMPACT_PTH, IMPACT_ANALYSIS_OUTPUT> = {
  lookup_company_info: {
    func: async (request, args: { company_name: string; data_type: string }) => {
      // Simulate company lookup (replace with real API)
      const { company_name, data_type } = args;
      
      // Mock company data
      const companyData = {
        stock_price: Math.random() * 200 + 50,
        market_cap: `$${Math.floor(Math.random() * 500 + 100)}B`,
        sector: getSectorForCompany(company_name),
        employees: Math.floor(Math.random() * 100000 + 5000),
        revenue: `$${Math.floor(Math.random() * 100 + 10)}B`
      };

      return {
        company: company_name,
        data_type,
        data: companyData,
        source: "Market Data API",
        timestamp: new Date().toISOString()
      };
    },
    spec: {
      name: "lookup_company_info",
      description: "Look up current information about a company mentioned in the article",
      parameters: {
        type: "object",
        properties: {
          company_name: {
            type: "string",
            description: "Name of the company to look up"
          },
          data_type: {
            type: "string",
            enum: ["financial", "general", "stock"],
            description: "Type of company data needed"
          }
        },
        required: ["company_name", "data_type"]
      }
    }
  },

  search_related_articles: {
    func: async (request, args: { keywords: string[]; days_back: number }) => {
      // Simulate article search (replace with real search API)
      const { keywords, days_back } = args;
      
      const mockArticles = [
        {
          title: `Related development in ${keywords[0]} sector`,
          summary: "Industry analysis shows continued growth trends",
          url: "https://example.com/article1",
          published_date: new Date(Date.now() - Math.random() * days_back * 24 * 60 * 60 * 1000).toISOString(),
          relevance_score: Math.random()
        },
        {
          title: `Market impact of ${keywords.join(' and ')}`,
          summary: "Experts weigh in on sector implications",
          url: "https://example.com/article2", 
          published_date: new Date(Date.now() - Math.random() * days_back * 24 * 60 * 60 * 1000).toISOString(),
          relevance_score: Math.random()
        }
      ];

      return {
        keywords,
        articles_found: mockArticles.length,
        articles: mockArticles,
        search_period_days: days_back
      };
    },
    spec: {
      name: "search_related_articles", 
      description: "Search for related news articles to provide additional context",
      parameters: {
        type: "object",
        properties: {
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Keywords to search for in related articles"
          },
          days_back: {
            type: "number",
            description: "Number of days to search back",
            minimum: 1,
            maximum: 30
          }
        },
        required: ["keywords", "days_back"]
      }
    }
  },

  calculate_impact_score: {
    func: async (request, args: { 
      factors: Array<{ name: string; weight: number; score: number }>;
      vertical: string;
    }) => {
      const { factors, vertical } = args;
      
      // Calculate weighted impact score
      const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
      const weightedScore = factors.reduce((sum, factor) => 
        sum + (factor.score * factor.weight), 0) / totalWeight;
      
      return {
        vertical,
        calculated_score: Math.round(weightedScore * 100) / 100,
        factors_used: factors,
        calculation_method: "weighted_average",
        confidence: totalWeight >= 3 ? 0.8 : 0.6 // Higher confidence with more factors
      };
    },
    spec: {
      name: "calculate_impact_score",
      description: "Calculate a numerical impact score based on multiple weighted factors",
      parameters: {
        type: "object", 
        properties: {
          factors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Factor name" },
                weight: { type: "number", description: "Importance weight (1-5)" },
                score: { type: "number", description: "Factor score (1-10)" }
              },
              required: ["name", "weight", "score"]
            },
            description: "List of factors with weights and scores"
          },
          vertical: {
            type: "string",
            description: "Business vertical being analyzed"
          }
        },
        required: ["factors", "vertical"]
      }
    }
  }
};

// Helper function for mock data
function getSectorForCompany(companyName: string): string {
  const sectors = ["Technology", "Healthcare", "Finance", "Manufacturing", "Retail"];
  return sectors[companyName.length % sectors.length];
}
```

## Registering Tools in the Bot

Update your bot constructor to include the dispatch table:

```typescript
export class ImpactAnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<IMPACT_BTH, [StructuredOutputBotMixin<IMPACT_BTH, typeof ImpactAnalysisSchema>]>,
  [StructuredOutputBotMixin<IMPACT_BTH, typeof ImpactAnalysisSchema>]
]> {
  constructor() {
    const structuredPromptGroup = new StructuredPromptGroup<IMPACT_PTH>({
      base: new PromptGroup<IMPACT_PTH>([
        { name: "impact_analysis_prompt", prompt: new EnhancedImpactAnalysisPrompt({ app_name: "News Impact Analyzer" }) },
      ]),
      input: new PromptGroup<IMPACT_PTH>([
        { name: "user_input", prompt: inputPrompt },
      ]),
    });

    const config: MixinBotConfig<IMPACT_BTH> = {
      name: "ImpactAnalysisBot",
      base_prompt_group: structuredPromptGroup,
      model_pool_name: "firebrand_completion_default",
      static_args: {} as IMPACT_PTH['args']['static'],
      // Add the dispatch table to enable tool calls
      dispatch_table: newsAnalysisTools
    };

    // super() uses array-per-mixin: [MixinBot config], [StructuredOutput config]
    super([config], [{ schema: ImpactAnalysisSchema }]);
  }

  get_semantic_label_impl(): string {
    return "ImpactAnalysisBotSemanticLabel";
  }
}
```

## Updating the Prompt to Use Tools

Modify your prompt to instruct the LLM about available tools:

```typescript
export class EnhancedImpactAnalysisPrompt extends Prompt<IMPACT_PTH> {
  constructor(args: IMPACT_PTH['args']['static']) {
    super({ role: 'system', static_args: args });
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Available_Tools_Section()); // New section
    this.add_section(this.get_Analysis_Rules());
    this.add_section(this.get_Verticals_Section());
    this.add_section(this.get_Schema_Section());
  }

  get_Available_Tools_Section(): PromptTemplateNode<IMPACT_PTH> {
    return new PromptTemplateSectionNode<IMPACT_PTH>({
      semantic_type: 'context',
      content: 'Available Tools:',
      children: [
        new PromptTemplateListNode<IMPACT_PTH>({
          semantic_type: 'context',
          children: [
            `**lookup_company_info**: Get current data about companies mentioned in the article (stock price, market cap, sector, etc.)`,
            `**search_related_articles**: Find related news articles for additional context and trend analysis`,
            `**calculate_impact_score**: Perform quantitative impact scoring based on multiple weighted factors`
          ],
          list_label_function: () => '• '
        }),
        new PromptTemplateTextNode<IMPACT_PTH>({
          semantic_type: 'rule',
          content: `Use these tools when they would enhance your analysis. For example:
- Look up company info when specific companies are mentioned
- Search for related articles to understand broader trends
- Calculate impact scores when you have multiple quantifiable factors`
        })
      ]
    });
  }

  get_Analysis_Rules(): PromptTemplateNode<IMPACT_PTH> {
    return new PromptTemplateSectionNode<IMPACT_PTH>({
      semantic_type: 'rule',
      content: 'Analysis Rules:',
      children: [
        new PromptTemplateListNode<IMPACT_PTH>({
          semantic_type: 'rule',
          children: [
            `Use available tools to gather additional context when relevant`,
            `Focus on direct and indirect business impacts, not just general relevance`,
            `Consider both immediate and potential long-term effects`,
            `Base confidence scores on the quality and quantity of available data`,
            `If using tools, incorporate their results into your reasoning`,
            `Provide specific, actionable reasoning for each assessment`
          ],
          list_label_function: (_req, _child, idx) => `${idx + 1}. `
        })
      ]
    });
  }

  // ... rest of the prompt sections remain the same
}
```

## How Tool Calls Work

When your bot runs, the flow works like this:

1. **LLM Receives Prompt**: The LLM gets your prompt plus the tool specifications
2. **LLM Decides to Use Tools**: Based on the article content, the LLM may decide to call tools
3. **Tool Execution**: The framework executes the requested tools and adds results to the conversation
4. **LLM Continues**: The LLM receives tool results and continues with the analysis
5. **Final Output**: The LLM produces the structured analysis, potentially incorporating tool data

Example tool call sequence:
```
1. LLM reads article about "TechCorp announces breakthrough"
2. LLM calls: lookup_company_info("TechCorp", "financial")
3. Tool returns: {"stock_price": 150.25, "market_cap": "$50B", ...}
4. LLM calls: search_related_articles(["TechCorp", "breakthrough"], 7)
5. Tool returns: {"articles": [...], "articles_found": 2}
6. LLM produces final analysis incorporating tool data
```

## Example Enhanced Output

With tools, your analysis becomes more data-driven:

```json
{
  "article_summary": "TechCorp announces quantum computing breakthrough with 50% performance improvement over previous generation.",
  "healthcare": {
    "impact_level": "high",
    "confidence": 0.85,
    "reasoning": "Based on TechCorp's $50B market cap and strong presence in health tech, this breakthrough could significantly accelerate drug discovery. Related articles show growing quantum adoption in pharma.",
    "key_factors": ["drug discovery acceleration", "TechCorp market position", "quantum pharma trends"]
  },
  "technology": {
    "impact_level": "critical", 
    "confidence": 0.95,
    "reasoning": "Direct impact on TechCorp (stock price $150.25, 45K employees) and broader tech sector. Calculated impact score of 8.7/10 based on market position, technology advancement, and competitive factors.",
    "key_factors": ["quantum computing advancement", "competitive positioning", "market disruption potential"]
  },
  "overall_significance": "high"
}
```

## Best Practices for Tool Calls

**1. Tool Design Principles**
- Keep tools focused and single-purpose
- Return structured, consistent data formats
- Include metadata like timestamps and sources
- Handle errors gracefully

**2. Prompt Instructions**
- Clearly explain when to use each tool
- Provide examples of appropriate usage
- Instruct the LLM to incorporate tool results into reasoning

**3. Performance Considerations**
- Tools add latency - use judiciously
- Consider caching for frequently accessed data
- Set reasonable timeouts for external APIs

**4. Error Handling**
- Tools should return error information, not throw exceptions
- LLM should be instructed how to handle tool failures
- Provide fallback analysis methods

## Common Tool Patterns

**Data Lookup Tools**: Fetch external information
```typescript
lookup_stock_data: { /* get real-time market data */ }
get_company_profile: { /* fetch company information */ }
search_knowledge_base: { /* query internal documents */ }
```

**Calculation Tools**: Perform complex computations
```typescript
calculate_financial_metrics: { /* ROI, growth rates, etc. */ }
statistical_analysis: { /* statistical calculations */ }
risk_assessment: { /* risk scoring models */ }
```

**Validation Tools**: Verify information
```typescript
fact_check_claim: { /* validate factual claims */ }
verify_source: { /* check source credibility */ }
cross_reference: { /* compare with other sources */ }
```

Tool calls transform your bots from simple text processors into powerful agents that can gather data, perform calculations, and make informed decisions based on real-time information.