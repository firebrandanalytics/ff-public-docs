# Getting Started with FireFoundry Agent Bundles

## Introduction and Core Concepts

In this tutorial, we'll build a **News Article Impact Analyzer** that demonstrates the core patterns of FireFoundry Agent Bundles. Our analyzer will:

- **Input**: A plain text news article
- **Output**: Structured impact assessment across three verticals: healthcare, shipping/logistics, and technology
- **Architecture**: Entities handle structure and state, Bots handle AI-powered analysis

The key insight of FireFoundry is the **separation of structure from behavior**:
- **Entities** represent business objects and their relationships in a persistent graph
- **Bots** implement AI-powered behaviors using LLMs
- **Runnable Entities** connect the two, providing context from the entity graph to the bot

## Understanding the Example

Our news analyzer follows this data flow:

```
News Article (text) → ArticleEntity → ImpactAnalysisBot → Structured Analysis
```

**ArticleEntity**: Stores the article text and orchestrates the analysis
**ImpactAnalysisBot**: Uses an LLM to extract structured insights
**NewsCollection**: Factory for creating and managing multiple analyses

## Creating the Output Schema

First, let's define what our structured output looks like using Zod schemas:

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

// Individual impact assessment for each vertical
const VerticalImpactSchema = withSchemaMetadata(
  z.object({
    impact_level: z.enum(['none', 'low', 'medium', 'high', 'critical'])
      .describe('Level of impact this news will have on the vertical'),
    confidence: z.number().min(0).max(1)
      .describe('Confidence score for this assessment (0-1)'),
    reasoning: z.string()
      .describe('Brief explanation of why this impact level was assigned'),
    key_factors: z.array(z.string())
      .describe('Key factors from the article that drive this assessment')
  }),
  'VerticalImpact',
  'Impact assessment for a specific business vertical'
);

// Main output schema
const ImpactAnalysisSchema = withSchemaMetadata(
  z.object({
    article_summary: z.string()
      .describe('Brief 2-3 sentence summary of the article'),
    healthcare: VerticalImpactSchema
      .describe('Impact assessment for healthcare industry'),
    shipping_logistics: VerticalImpactSchema
      .describe('Impact assessment for shipping and logistics industry'),
    technology: VerticalImpactSchema
      .describe('Impact assessment for technology industry'),
    overall_significance: z.enum(['low', 'medium', 'high'])
      .describe('Overall significance of this news across all verticals')
  }),
  'ImpactAnalysis',
  'Comprehensive impact analysis of a news article across business verticals'
);

type IMPACT_ANALYSIS_OUTPUT = z.infer<typeof ImpactAnalysisSchema>;
```

The `withSchemaMetadata` function helps the LLM understand our schema structure in natural language.

## Creating the Analysis Prompt

The prompt contains the actual AI logic - this is where we define how the LLM should perform the analysis. We use `StructuredDataPrompt` which automatically handles schema formatting and provides a sample output to guide the LLM:

```typescript
import {
  StructuredDataPrompt,
  StructuredDataPTH,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode
} from '@firebrandanalytics/ff-agent-sdk';
import { ImpactAnalysisSchema } from '../schemas.js';

// Sample output to show the LLM what format to produce
const sampleOutput = {
  article_summary: "Major tech company announces quantum computing breakthrough with unprecedented processing speeds.",
  healthcare: {
    impact_level: "high",
    confidence: 0.8,
    reasoning: "Quantum computing could accelerate drug discovery and medical research significantly.",
    key_factors: ["drug discovery acceleration", "complex medical calculations", "research speed improvements"]
  },
  shipping_logistics: {
    impact_level: "medium",
    confidence: 0.7,
    reasoning: "Optimization algorithms could improve route planning and supply chain efficiency.",
    key_factors: ["logistics optimization", "route planning", "supply chain management"]
  },
  technology: {
    impact_level: "critical",
    confidence: 0.9,
    reasoning: "Direct disruption to computing industry with new processing capabilities.",
    key_factors: ["quantum processor", "data processing revolution", "computing paradigm shift"]
  },
  overall_significance: "high"
};

export class ImpactAnalysisPrompt extends StructuredDataPrompt {
  constructor(
    args: StructuredDataPTH['args']['static'],
    options?: StructuredDataPTH['options']
  ) {
    super(ImpactAnalysisSchema, sampleOutput, args, options);
    // Add custom section for business verticals
    this.add_section(this.get_Verticals_Section());
  }

  // Implement the required abstract method
  protected get_Task_Section(): PromptTemplateNode<StructuredDataPTH> {
    return new PromptTemplateSectionNode<StructuredDataPTH>({
      semantic_type: 'rule',
      content: 'Task:',
      children: [
        'Analyze news articles for business impact across three verticals: healthcare, shipping & logistics, and technology.',
        'Assess the potential impact for each vertical considering both immediate and potential long-term effects.',
        'Provide objective, data-driven assessments with clear reasoning.',
        'Assign appropriate impact levels (none, low, medium, high, critical) and confidence scores (0.0-1.0).',
        'Identify specific key factors from the article that drive each assessment.',
        'Summarize the article in 2-3 sentences.',
        'Determine the overall significance (low, medium, high) across all verticals.'
      ]
    });
  }

  // Override context to be specific for impact analysis
  protected get_Context_Section(): PromptTemplateNode<StructuredDataPTH> {
    return new PromptTemplateSectionNode<StructuredDataPTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        'You are an expert business analyst for a consulting firm.',
        'Your role is to analyze news articles and assess their potential impact across different business verticals.',
        'Provide objective, data-driven assessments with clear reasoning.'
      ]
    });
  }

  // Override rules to be specific for impact analysis
  protected get_Rules_Section(): PromptTemplateNode<StructuredDataPTH> {
    return new PromptTemplateSectionNode<StructuredDataPTH>({
      semantic_type: 'rule',
      content: 'Analysis Rules:',
      children: [
        new PromptTemplateListNode<StructuredDataPTH>({
          semantic_type: 'rule',
          children: [
            'Focus on direct and indirect business impacts, not just general relevance',
            'Consider both immediate and potential long-term effects',
            'Base confidence scores on how clearly the article connects to each vertical',
            'If impact is unclear or minimal, assign "none" or "low" impact level',
            'Provide specific, actionable reasoning for each assessment',
            'Use the following impact levels: none, low, medium, high, critical',
            'Set confidence between 0.0 and 1.0 based on clarity of connection'
          ],
          list_label_function: (_req, _child, idx) => `${idx + 1}. `
        })
      ]
    });
  }

  // Add business verticals section
  get_Verticals_Section(): PromptTemplateNode<StructuredDataPTH> {
    return new PromptTemplateSectionNode<StructuredDataPTH>({
      semantic_type: 'context',
      content: 'Business Verticals:',
      children: [
        new PromptTemplateListNode<StructuredDataPTH>({
          semantic_type: 'context',
          children: [
            '**Healthcare**: Medical devices, pharmaceuticals, hospitals, health insurance, telemedicine, regulatory changes',
            '**Shipping & Logistics**: Supply chain, transportation, warehousing, delivery services, freight, port operations',
            '**Technology**: Software, hardware, cloud services, cybersecurity, AI/ML, telecommunications, fintech'
          ],
          list_label_function: () => '• '
        })
      ]
    });
  }
}
```

The prompt is organized into clear sections that guide the LLM through the analysis process. Note that we **don't** embed the article text in the Task section - that will be sent as a separate user message via the input prompt in the bot's `StructuredPromptGroup`.

## Building the Analysis Bot

Now we create the bot that wraps our prompt. The key pattern is to use `ComposeMixins(MixinBot, StructuredOutputBotMixin)` for structured output bots, and a `StructuredPromptGroup` that separates system instructions (base) from user input:

```typescript
import { ComposeMixins } from '@firebrandanalytics/shared-utils';
import {
  MixinBot,
  StructuredOutputBotMixin,
  type MixinBotConfig,
  BotTypeHelper,
  BotTryRequest,
} from '@firebrandanalytics/ff-agent-sdk/bot';
import type { PromptTypeHelper } from '@firebrandanalytics/ff-agent-sdk/prompts';
import {
  Prompt,
  PromptGroup,
  PromptTemplateTextNode,
  StructuredPromptGroup,
} from '@firebrandanalytics/ff-agent-sdk/prompts';
import { ImpactAnalysisPrompt } from '../prompts/ImpactAnalysisPrompt.js';

// Define type helpers for type safety
type IMPACT_PROMPT_INPUT = string; // The news article text
type IMPACT_PROMPT_ARGS = {
  static: {
    app_name?: string;
  };
  request: {};
};

type IMPACT_PTH = PromptTypeHelper<IMPACT_PROMPT_INPUT, IMPACT_PROMPT_ARGS>;
type IMPACT_BTH = BotTypeHelper<IMPACT_PTH, IMPACT_ANALYSIS_OUTPUT>;

export class ImpactAnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
)<[
  MixinBot<IMPACT_BTH, [StructuredOutputBotMixin<IMPACT_BTH, typeof ImpactAnalysisSchema>]>,
  [StructuredOutputBotMixin<IMPACT_BTH, typeof ImpactAnalysisSchema>]
]> {
  constructor() {
    // User input prompt — forwards the article text as a user message
    const inputPrompt = new Prompt<IMPACT_PTH>({
      role: 'user',
      static_args: {} as IMPACT_PTH['args']['static'],
    });
    inputPrompt.add_section(
      new PromptTemplateTextNode<IMPACT_PTH>({
        content: (request) => request.input as string,
      })
    );

    // Assemble prompts into a StructuredPromptGroup
    const structuredPromptGroup = new StructuredPromptGroup<IMPACT_PTH>({
      base: new PromptGroup<IMPACT_PTH>([
        { name: "impact_analysis_system", prompt: new ImpactAnalysisPrompt({}) },
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
    };

    // super() uses array-per-mixin: [MixinBot config], [StructuredOutput config]
    super([config], [{ schema: ImpactAnalysisSchema }]);
  }

  get_semantic_label_impl(): string {
    return "ImpactAnalysisBotSemanticLabel";
  }
}
```

The `StructuredOutputBotMixin` automatically handles:
- Sending the prompt to the LLM
- Extracting JSON from the response
- Validating the output against your Zod schema
- Retrying on errors

**Key Pattern: StructuredPromptGroup**

Notice the `StructuredPromptGroup` separates prompts into phases:
1. **Base** (`ImpactAnalysisPrompt`) - System-role prompts with instructions, rules, and schema
2. **Input** (user prompt with `PromptTemplateTextNode`) - Sends the article text as a user message

This follows the correct chat model pattern where:
- System prompts contain **instructions**
- User messages contain **content to analyze**

Always use the `input` phase of `StructuredPromptGroup` for user content rather than embedding `request.input` directly in the system prompt.

## Creating the Article Entity

The entity stores our article and connects it to the bot:

```typescript
import {
  AddInterface,
  BotRequestArgs,
  EntityNode,
  EntityNodeTypeHelper,
  EntityFactory,
  RunnableEntityBotWrapperDecorator,
  RunnableEntityTypeHelper,
  Context,
  IRunnableEntity
} from '@firebrandanalytics/ff-agent-sdk';
import {
  type UUID,
  type EntityInstanceNodeDTO,
  type JSONObject,
  type JSONValue
} from '@firebrandanalytics/shared-types';
import { ImpactAnalysisBot } from '../bots/ImpactAnalysisBot.js';

// Define the DTO structure for our entity
export interface ArticleEntityDTOData {
  article_text: string;
  source_url?: string;
  published_date?: string;
  [key: string]: JSONValue; // Required for JSONObject compatibility
}

export type ArticleEntityDTO = EntityInstanceNodeDTO<ArticleEntityDTOData> & {
  node_type: "ArticleEntity";
};

// Define type helpers
type ARTICLE_RETH = RunnableEntityTypeHelper<
  EntityNodeTypeHelper<
    any, // ETH
    ArticleEntityDTO,
    "ArticleEntity",
    {}, // edges_from
    {} // edges_to
  >,
  IMPACT_ANALYSIS_OUTPUT,
  {}
>;

@RunnableEntityBotWrapperDecorator(
  {
    generalType: "ArticleEntity",
    specificType: "ArticleEntity",
    allowedConnections: {}
  },
  new ImpactAnalysisBot()
)
export class ArticleEntity
  extends AddInterface<
    typeof EntityNode<ARTICLE_RETH["enh"]>,
    IRunnableEntity<ARTICLE_RETH["enh"]["eth"]["bth"], IMPACT_ANALYSIS_OUTPUT>
  >(EntityNode<ARTICLE_RETH["enh"]>)
{
  constructor(factory: EntityFactory<any>, idOrDto: UUID | ArticleEntityDTO) {
    super(factory, idOrDto);
  }

  // This method connects entity data to bot input
  protected async get_bot_request_args(): Promise<BotRequestArgs<IMPACT_BTH>> {
    const dto = await this.get_dto();

    return {
      id: "impact_analysis_request",
      args: {},
      input: dto.data.article_text, // Send article text to the bot
      context: new Context(dto),
      parent: undefined
    };
  }

  // Helper methods for working with the entity
  async set_article_text(article_text: string): Promise<void> {
    await this.update_data({
      ...(this._dto?.data || {}),
      article_text
    });
  }

  async get_article_text(): Promise<string> {
    const dto = await this.get_dto();
    return dto.data.article_text;
  }
}
```

The `@RunnableEntityBotWrapperDecorator` automatically connects our entity to the bot, and `get_bot_request_args()` defines how entity data flows to the bot.

## Building the Collection Entity

The collection entity acts as a factory for creating and managing article analyses:

```typescript
import {
  EntityNode,
  EntityNodeTypeHelper,
  EntityFactory,
  EntityDecorator
} from '@firebrandanalytics/ff-agent-sdk';
import {
  type UUID,
  type EntityNodeDTO
} from '@firebrandanalytics/shared-types';

@EntityDecorator({
  specificType: 'NewsCollection',
  generalType: 'Class',
  allowedConnections: {
    'Contains': ['ArticleEntity']
  }
})
export class NewsCollection extends EntityNode<
  EntityNodeTypeHelper<any, EntityNodeDTO, 'NewsCollection', {}, {}>
> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | EntityNodeDTO) {
    super(factory, idOrDto);
  }

  /**
   * Creates a new article analysis and runs it
   */
  async analyze_article(
    article_text: string, 
    metadata?: { source_url?: string; published_date?: string }
  ): Promise<IMPACT_ANALYSIS_OUTPUT> {
    console.log(`📰 Creating analysis for article (${article_text.length} chars)`);

    const dto = await this.get_dto();
    
    if (!article_text || article_text.trim().length === 0) {
      throw new Error('Article text is required for analysis.');
    }

    // Create the ArticleEntity
    const article_dto = await this.factory.create_entity_node({
      app_id: dto.app_id!,
      name: `article-analysis-${Date.now()}`,
      specific_type_name: 'ArticleEntity',
      general_type_name: 'ArticleEntity',
      status: 'Pending',
      data: {
        article_text,
        source_url: metadata?.source_url || null,
        published_date: metadata?.published_date || null
      }
    });

    // Get the entity instance
    const article_entity = await this.factory.get_entity(article_dto.id);

    // Connect it to this collection
    console.log(`🔗 Connecting article ${article_dto.id} to collection ${this.id}`);
    await this.connect_to({
      general_type_name: 'Edge',
      specific_type_name: 'Contains',
      to_node_id: article_dto.id,
      to_node_type: 'ArticleEntity',
      data: {}
    });

    // Run the analysis
    console.log(`🤖 Running impact analysis...`);
    const result = await article_entity.run();
    
    console.log('✅ Analysis complete');
    return result;
  }

  /**
   * Get all analyzed articles in this collection
   */
  async get_all_articles(): Promise<any[]> {
    await this.load();
    const contains_edges = (this.edges_from as any)['Contains'] || [];
    return Promise.all(
      contains_edges.map((edge: any) => edge.get_to())
    );
  }
}
```

This collection entity demonstrates the factory pattern - it creates new entities, connects them via edges, and orchestrates their execution.

## Assembling the Agent Bundle

Finally, let's create the main Agent Bundle that ties everything together. The agent bundle is your application's entry point and exposes API endpoints for external consumers.

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  logger,
  ApiEndpoint,
  FFConstructors
} from '@firebrandanalytics/ff-agent-sdk';
import { ArticleEntity } from './entities/ArticleEntity.js';
import { NewsCollection } from './entities/NewsCollection.js';

// Register our custom entities
export const NewsAnalysisConstructors = {
  ...FFConstructors,
  'ArticleEntity': ArticleEntity,
  'NewsCollection': NewsCollection
} as const;

// Note: This ID is randomly generated by ff-cli when creating a new agent bundle.
// Each bundle must have a unique UUID within your FireFoundry cluster.
const APP_ID = "c0000000-0000-0000-0001-000000000000";

export class NewsAnalysisAgentBundle extends FFAgentBundle<any> {
  private collectionId?: string;

  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "NewsAnalysisService",
        type: "agent_bundle",
        description: "News article impact analysis service using FireFoundry"
      },
      NewsAnalysisConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info("NewsAnalysisAgentBundle initialized!");
    
    // Create or retrieve the root collection
    await this.ensure_collection();
    
    logger.info("✅ News Analysis service ready!");
    logger.info("📡 API endpoints available:");
    logger.info("   POST /analyze - Analyze a news article");
    logger.info("   GET /article-status?articleId=<id> - Get analysis status");
    logger.info("   GET /articles - List all analyzed articles");
  }

  private async ensure_collection() {
    try {
      const collection_name = "news-analysis-root";
      const existing = await this.entity_client.get_node_by_name(collection_name);
      
      if (existing) {
        this.collectionId = existing.id;
        logger.info("News collection found:", this.collectionId);
        return;
      }

      // Create the root collection
      const collection_dto = await this.entity_factory.create_entity_node({
        app_id: this.get_app_id(),
        name: collection_name,
        specific_type_name: 'NewsCollection',
        general_type_name: 'NewsCollection',
        status: 'Active',
        data: {}
      });

      this.collectionId = collection_dto.id;
      logger.info("Created news collection:", this.collectionId);
    } catch (error) {
      logger.error("Failed to create collection:", error);
      throw error;
    }
  }

  /**
   * Analyze a news article
   * 
   * This endpoint accepts a news article and returns structured impact analysis
   * across three business verticals: healthcare, shipping/logistics, and technology.
   */
  @ApiEndpoint({ method: 'POST', route: 'analyze' })
  async analyzeArticle(body: any = {}): Promise<any> {
    try {
      const { article_text, source_url, published_date } = body;

      // Validate input
      if (!article_text || article_text.trim().length === 0) {
        throw new Error('article_text is required and cannot be empty');
      }

      logger.info(`📰 Analyzing article (${article_text.length} characters)...`);

      // Get the collection entity
      if (!this.collectionId) {
        throw new Error('Collection not initialized');
      }

      const collection = await this.entity_factory.get_entity(this.collectionId);

      // Use the collection to analyze the article
      const result = await collection.analyze_article(
        article_text,
        { source_url, published_date }
      );

      logger.info('✅ Analysis complete');

      return {
        success: true,
        analysis: result,
        message: 'Article analyzed successfully'
      };
    } catch (error) {
      logger.error('Failed to analyze article:', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  /**
   * Get the status and results of an analyzed article
   */
  @ApiEndpoint({ method: 'GET', route: 'article-status' })
  async getArticleStatus(query: any = {}): Promise<any> {
    try {
      const { articleId } = query;

      if (!articleId) {
        throw new Error('articleId query parameter is required');
      }

      // Get the article entity
      const article = await this.entity_factory.get_entity(articleId);
      const articleDto = await article.get_dto();

      // Get the analysis result from node_io
      const nodeIo = await this.entity_client.get_node_io(articleId);

      return {
        success: true,
        article: {
          id: articleDto.id,
          status: articleDto.status,
          article_text: articleDto.data.article_text,
          source_url: articleDto.data.source_url,
          published_date: articleDto.data.published_date,
          created: articleDto.created,
          updated: articleDto.updated
        },
        analysis: nodeIo?.output || null,
        message: articleDto.status === 'Completed' 
          ? 'Analysis complete' 
          : 'Analysis in progress'
      };
    } catch (error) {
      logger.error('Failed to get article status:', error);
      throw new Error(`Failed to retrieve article: ${error.message}`);
    }
  }

  /**
   * List all analyzed articles
   */
  @ApiEndpoint({ method: 'GET', route: 'articles' })
  async listArticles(query: any = {}): Promise<any> {
    try {
      const { status, limit = '10' } = query;
      const limitNum = parseInt(limit as string, 10);

      // Build search criteria
      const criteria: any = { specific_type_name: 'ArticleEntity' };
      if (status) {
        criteria.status = status;
      }

      // Search for articles
      const result = await this.entity_client.search_nodes(
        criteria,
        { created: 'desc' },
        { limit: limitNum }
      );

      // Transform results
      const articles = result.result.map(dto => ({
        id: dto.id,
        status: dto.status,
        article_excerpt: dto.data.article_text?.substring(0, 100) + '...',
        source_url: dto.data.source_url,
        published_date: dto.data.published_date,
        created: dto.created
      }));

      return {
        success: true,
        articles,
        total: result.total,
        message: `Found ${articles.length} article(s)`
      };
    } catch (error) {
      logger.error('Failed to list articles:', error);
      throw new Error(`Failed to list articles: ${error.message}`);
    }
  }
}
```

### Key Concepts in the Agent Bundle

**1. The `@ApiEndpoint` Decorator**

The `@ApiEndpoint` decorator exposes methods as HTTP endpoints that external systems can call:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze' })
async analyzeArticle(body: any = {}): Promise<any> { /* ... */ }
```

This creates a `POST /analyze` endpoint that consumers can call directly, without needing to know about internal entity IDs.

**2. Initialization with `init()`**

The `init()` method runs once when your bundle starts:
- Creates bootstrap entities (like our root collection)
- Sets up application state
- Validates connections to platform services

**3. Clean API Design**

Rather than exposing entity IDs and forcing consumers to understand your entity graph, you provide clean REST-style APIs that hide implementation details:
- `POST /analyze` - Analyze an article
- `GET /article-status?articleId=<id>` - Check status  
- `GET /articles` - List articles

**4. Error Handling**

Always validate inputs and provide clear error messages:
```typescript
if (!article_text || article_text.trim().length === 0) {
  throw new Error('article_text is required and cannot be empty');
}
```

The framework automatically catches these errors and returns appropriate HTTP error responses.

## How It All Works Together

Here's the complete data flow when analyzing a news article:

```
External Client                                                       
     │                                                                
     │ POST /analyze                                                 
     │ { article_text: "..." }                                       
     ▼                                                                
NewsAnalysisAgentBundle                                              
     │                                                                
     │ @ApiEndpoint                                                  
     ├─→ analyzeArticle()                                            
     │                                                                
     ├─→ Get NewsCollection entity                                   
     │                                                                
     ├─→ collection.analyze_article()                                
     │        │                                                       
     │        ├─→ Create ArticleEntity                               
     │        │                                                       
     │        ├─→ article.run()                                      
     │        │        │                                              
     │        │        ├─→ get_bot_request_args()                    
     │        │        │   (extracts article_text from entity)       
     │        │        │                                              
     │        │        ├─→ ImpactAnalysisBot                         
     │        │        │        │                                     
     │        │        │        ├─→ ImpactAnalysisPrompt             
     │        │        │        │   (formats LLM request)            
     │        │        │        │                                     
     │        │        │        ├─→ Broker Service (LLM call)        
     │        │        │        │                                     
     │        │        │        └─→ Validate with Zod schema         
     │        │        │                                              
     │        │        └─→ Returns IMPACT_ANALYSIS_OUTPUT            
     │        │                                                       
     │        └─→ Returns result                                     
     │                                                                
     └─→ Return { success: true, analysis: {...} }                   
```

**Example Response:**

When you analyze an article about quantum computing breakthroughs, the system returns:

```json
{
  "success": true,
  "analysis": {
    "article_summary": "Major tech company announces quantum computing breakthrough with unprecedented processing speeds, potentially transforming multiple industries.",
    "healthcare": {
      "impact_level": "high",
      "confidence": 0.8,
      "reasoning": "Quantum computing could accelerate drug discovery and medical research",
      "key_factors": ["drug discovery acceleration", "complex medical calculations"]
    },
    "shipping_logistics": {
      "impact_level": "medium", 
      "confidence": 0.7,
      "reasoning": "Optimization algorithms could improve route planning and supply chain efficiency",
      "key_factors": ["logistics optimization", "complex calculations"]
    },
    "technology": {
      "impact_level": "critical",
      "confidence": 0.9,
      "reasoning": "Direct disruption to computing industry with new processing capabilities",
      "key_factors": ["quantum processor", "data processing revolution"]
    },
    "overall_significance": "high"
  },
  "message": "Article analyzed successfully"
}
```

## Deploying Your Agent Bundle

Before you can consume your agent bundle, you need to deploy it to a FireFoundry cluster. This tutorial uses minikube for local deployment.

### Prerequisites

- Minikube with FireFoundry installed and running
- `ff-cli` installed (FireFoundry CLI tool)
- GitHub Personal Access Token (for accessing FireFoundry packages)

### Deployment Steps

**1. Navigate to your monorepo root**

The `ff-cli` command works from the root of your agent bundle monorepo:

```bash
cd ff-agent-bundle-examples  # Your monorepo root
```

**2. Build the Docker image**

Build your agent bundle into a Docker image. For minikube, use the `--profile minikube` flag:

```bash
export GITHUB_TOKEN=your_github_token
ff-cli ops build news-analysis --profile minikube
```

The GITHUB_TOKEN is required to access FireFoundry's private npm packages during the Docker build.

**Output:**
```
Building Docker image for agent bundle: news-analysis
Using minikube profile: minikube
- Starting Docker build...
✔ Docker image built successfully: news-analysis:latest

Build completed successfully!
```

**3. Install to Kubernetes**

Deploy the agent bundle to your minikube cluster:

```bash
ff-cli ops install news-analysis
```

This command:
- Creates a Helm release in the `ff-dev` namespace
- Deploys the agent bundle pod
- Configures Kong Gateway routing
- Waits for the pod to become ready

**Output:**
```
Installing agent bundle: news-analysis
Installing Helm release "news-analysis"...
Helm release "news-analysis" installed successfully
Deployment "news-analysis" is ready

Pod Status:
  news-analysis-agent-bundle-xxxxx: Running (Ready)
```

**4. Upgrade after changes**

When you make code changes and rebuild, upgrade the deployment:

```bash
ff-cli ops build news-analysis --profile minikube
ff-cli ops upgrade news-analysis
```

**5. Access your agent bundle**

Set up port forwarding to the Kong Gateway:

```bash
kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8080:80
```

Now you can access your agent bundle at:
```
http://localhost:8080/agents/ff-dev/news-analysis
```

**6. Test the deployment**

```bash
# Health check
curl http://localhost:8080/agents/ff-dev/news-analysis/health/ready

# Info endpoint
curl http://localhost:8080/agents/ff-dev/news-analysis/info

# Custom API endpoint (note the /api/ prefix)
curl -X POST http://localhost:8080/agents/ff-dev/news-analysis/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "article_text": "Your news article text here..."
  }'
```

**Important:** Custom API endpoints decorated with `@ApiEndpoint` are accessed via the `/api/` prefix: `/agents/{namespace}/{bundle-name}/api/{endpoint-route}`

### Viewing Logs

To debug issues or monitor your agent bundle:

```bash
# View real-time logs
kubectl logs -n ff-dev -l app.kubernetes.io/instance=news-analysis -f

# View recent logs
kubectl logs -n ff-dev -l app.kubernetes.io/instance=news-analysis --tail=100
```

### Common Issues

**Build fails with "GITHUB_TOKEN not set":**
- Set the token: `export GITHUB_TOKEN=your_github_token`
- The token needs read access to FireFoundry's private packages

**"Endpoint not found" when calling custom endpoints:**
- Remember to use the `/api/` prefix for `@ApiEndpoint` decorated methods
- Correct: `/api/analyze`
- Incorrect: `/analyze`

**Pod fails to start:**
- Check logs: `kubectl logs -n ff-dev -l app.kubernetes.io/instance=news-analysis`
- Verify database connection in secrets.yaml
- Ensure LLM broker is accessible

---

## Consuming Your Agent Bundle

Now that your agent bundle is deployed, let's see how external applications consume it. The **FireFoundry SDK (ff-sdk)** is the recommended way to interact with deployed agent bundles.

### Installing the FF SDK

```bash
npm install @firebrandanalytics/ff-sdk
```

### Basic Usage

Create a client and call your API endpoints:

```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

// Create client (assumes bundle is deployed behind Kong gateway)
const client = new RemoteAgentBundleClient(
  'https://api.yourcompany.com/agents/ff-dev/news-analysis',  // Your bundle's URL
  {
    api_key: process.env.API_KEY,  // API key for authentication
    timeout: 60000,  // 60 second timeout
  }
);

// Note: The URL follows the pattern: /agents/{environment}/{bundle-name}
// The environment name corresponds to your FireFoundry deployment environment.
//
// Examples by deployment:
// - Minikube: http://localhost:8080/agents/ff-dev/news-analysis
//             (port 8080 from: kubectl port-forward -n ff-control-plane 
//              svc/firefoundry-control-kong-proxy 8080:80)
// - Cloud cluster: https://api.yourcompany.com/agents/production/news-analysis
//                  (URL determined by your ingress controller configuration)

// Analyze an article
async function analyzeNewsArticle() {
  try {
    // Call your @ApiEndpoint route
    const result = await client.call_api_endpoint('analyze', {
      method: 'POST',
      body: {
        article_text: `Breaking: Major tech company announces breakthrough in quantum 
computing that could revolutionize data processing across industries. The new quantum 
processor demonstrates unprecedented speed improvements in complex calculations, 
potentially impacting everything from drug discovery to logistics optimization.`,
        source_url: 'https://example.com/quantum-breakthrough',
        published_date: '2024-01-15'
      }
    });

    console.log('Analysis complete:', result.analysis);
    return result;
  } catch (error) {
    console.error('Analysis failed:', error);
    throw error;
  }
}

// Check status of an article
async function checkArticleStatus(articleId: string) {
  const status = await client.call_api_endpoint('article-status', {
    query: { articleId }
  });

  console.log('Article status:', status.article.status);
  console.log('Analysis:', status.analysis);
  return status;
}

// List all articles
async function listRecentArticles() {
  const result = await client.call_api_endpoint('articles', {
    query: { limit: '5' }
  });

  console.log(`Found ${result.total} articles`);
  result.articles.forEach(article => {
    console.log(`- ${article.id}: ${article.status}`);
  });

  return result;
}

// Run the example
async function main() {
  // Analyze an article
  const analysis = await analyzeNewsArticle();
  
  // The response includes the article ID (embedded in the entity graph)
  // You can extract it from the collection to check status later
  
  // List recent analyses
  await listRecentArticles();
}

main();
```

### Type Safety with Shared Types

For production applications, create a shared types package for compile-time type safety:

```typescript
// shared-types/src/index.ts
export interface IMPACT_ANALYSIS_OUTPUT {
  article_summary: string;
  healthcare: VerticalImpact;
  shipping_logistics: VerticalImpact;
  technology: VerticalImpact;
  overall_significance: 'low' | 'medium' | 'high';
}

export interface VerticalImpact {
  impact_level: 'none' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  reasoning: string;
  key_factors: string[];
}

// In your consumer application
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';
import type { IMPACT_ANALYSIS_OUTPUT } from '@my-workspace/shared-types';

const result = await client.call_api_endpoint<{ 
  success: boolean; 
  analysis: IMPACT_ANALYSIS_OUTPUT;
}>('analyze', {
  method: 'POST',
  body: { article_text: '...' }
});

// TypeScript now knows the exact shape of result.analysis
console.log(result.analysis.healthcare.impact_level); // ✅ Type-safe!
```

### Why Use FF SDK?

The FF SDK provides:
- ✅ **Automatic authentication** with API keys
- ✅ **Built-in retry logic** for failed requests
- ✅ **Type safety** with TypeScript generics
- ✅ **Error handling** with structured `FFError` objects
- ✅ **Streaming support** for long-running operations
- ✅ **Binary uploads/downloads** for file handling
- ✅ **Request correlation** for distributed tracing

**Important:** The FF SDK works with agent bundles deployed behind Kong Gateway (production/staging). For local development and debugging, you may need to use direct HTTP calls (see the [Agent Bundle Tutorial](./core/agent_bundle_tutorial.md#consuming-your-agent-bundle) for details).

### Next Steps for Consumption

For more advanced consumption patterns, see:
- **[FF SDK Tutorial](../ff_sdk/ff_sdk_tutorial.md)** - Complete guide to the FireFoundry SDK
- **[News Analysis Consumer](../ff_sdk/news_analysis_consumer.md)** - Build a CLI tool using ff-sdk
- **[Express Middleware Tutorial](../ff_sdk/express_middleware_tutorial.md)** - Build a REST API wrapper

---

## Key Patterns and Takeaways

You've now built a complete AI-powered application using the FireFoundry platform! Let's review the key architectural patterns:

**1. Separation of Concerns**
- **Prompts** define AI instructions and output structure
- **Bots** execute AI tasks with validation and error handling
- **Entities** manage state and persistence
- **Agent Bundles** expose clean APIs to external systems

**2. Type Safety Throughout**
- Zod schemas define structure and generate TypeScript types
- Type helpers ensure compile-time correctness
- Shared types enable type-safe consumption

**3. Clean API Design**
- `@ApiEndpoint` hides internal complexity
- REST-style routes for easy integration
- Clear request/response contracts

**4. Zero-Code Persistence**
- Entity graph automatically persists state
- Relationships are first-class
- No manual database code required

**5. Production-Ready**
- Built-in error handling and validation
- Automatic retries and recovery
- Observability and monitoring built-in

### When to Use FireFoundry

This architecture excels when you need:
- ✅ **Structured data extraction** from unstructured input
- ✅ **Multi-step AI workflows** with complex logic
- ✅ **Persistent state** across operations
- ✅ **Type-safe contracts** between services
- ✅ **Composable AI behaviors** that can be reused
- ✅ **Audit trails** and observability
- ✅ **Enterprise-grade** reliability and security

### What You've Learned

In this tutorial, you've:
1. ✅ Created a **Zod schema** for structured LLM output
2. ✅ Built a **Prompt** with clear AI instructions
3. ✅ Implemented a **Bot** using `ComposeMixins(MixinBot, StructuredOutputBotMixin)`
4. ✅ Created **Entities** for state management
5. ✅ Assembled an **Agent Bundle** with API endpoints
6. ✅ **Deployed** your bundle to Kubernetes using ff-cli
7. ✅ Learned how to **consume** your bundle with ff-sdk

### Continue Your Journey

**Deep Dives:**
- [Prompting Tutorial](./core/prompting_tutorial.md) - Advanced prompt engineering
- [Bot Tutorial](./core/bot_tutorial.md) - Custom bots with tools and validation
- [Agent Bundle Tutorial](./core/agent_bundle_tutorial.md) - Advanced API patterns

**Reference Guides:**
- [Prompting Guide](./core/prompting.md) - Complete prompting framework
- [Bots Guide](./core/bots.md) - Comprehensive bot development
- [Entities Guide](./core/entities.md) - Entity modeling and relationships
- [Agent Bundles Guide](./core/agent_bundles.md) - Production bundle patterns

**Advanced Topics:**
- [Workflow Orchestration](./feature_guides/workflow_orchestration_guide.md) - Multi-step workflows
- [Waitable Entities](./feature_guides/waitable_guide.md) - Human-in-the-loop patterns
- [Graph Traversal](./feature_guides/graph_traversal.md) - Complex entity relationships

Happy building with FireFoundry! 🚀