# Part 1: Bundle & Web Search

In this part you'll scaffold a FireFoundry application, create two entity types for search sessions and articles, integrate the platform's web search service, wire everything into an agent bundle with API endpoints, and deploy and test it.

## Step 1: Scaffold the Application

Use `ff-cli` to create a new application and agent bundle:

```bash
ff application create news-analysis
cd news-analysis
ff agent-bundle create news-analysis-bundle
```

This creates a monorepo with:

```
news-analysis/
├── firefoundry.json              # Application-level config (lists components)
├── apps/
│   └── news-analysis-bundle/     # Your agent bundle
│       ├── firefoundry.json      # Bundle-level config (port, resources, health)
│       ├── src/
│       │   ├── index.ts          # Server entry point
│       │   ├── agent-bundle.ts   # Bundle class
│       │   └── constructors.ts   # Entity registry
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── packages/
│   └── shared-types/             # Shared type definitions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### Register the Application

Register the application with the entity service:

```bash
ff application register
```

This writes the `applicationId` into the root `firefoundry.json`. Note this ID -- you'll use it in the agent bundle class.

Install dependencies:

```bash
pnpm install
```

---

## Step 2: Create the SearchEntity

The `SearchEntity` represents a search session. When you call `run_search()`, it:

1. Calls the web search service to find news articles
2. Creates an `ArticleEntity` for each result
3. Establishes "Contains" edges connecting the search to its articles
4. Triggers AI analysis on each article (covered in Part 2)

**`apps/news-analysis-bundle/src/entities/SearchEntity.ts`**:

```typescript
import {
  EntityNode,
  EntityMixin,
  EntityFactory,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import type { EntityNodeTypeHelper, EntityTypeHelper } from "@firebrandanalytics/ff-agent-sdk";
import type { EntityNodeDTO, JSONObject, JSONValue } from "@firebrandanalytics/shared-types";
import type { UUID } from "@firebrandanalytics/shared-types";
import { ArticleEntity, type ArticleEntityDTOData } from "./ArticleEntity.js";

// ── Web search service types ────────────────────────────────────────────

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string | null;
}

interface WebSearchResponse {
  results: WebSearchResult[];
  query: string;
  total_results?: number;
}

// ── DTO data shape ──────────────────────────────────────────────────────

export interface SearchEntityDTOData extends JSONObject {
  query: string;
  searched_at: string;
  article_ids: string[];
  result_count: number;
  [key: string]: JSONValue;
}

export type SearchEntityDTO = EntityNodeDTO & {
  data: SearchEntityDTOData;
};

// ── Type helpers ────────────────────────────────────────────────────────

export type SearchEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>,
  SearchEntityDTO,
  "SearchEntity",
  {},
  {}
>;

// ── Constants ───────────────────────────────────────────────────────────

const WEB_SEARCH_URL =
  process.env.WEB_SEARCH_URL ||
  "http://firefoundry-core-websearch-service:8080";

// ── Entity class ────────────────────────────────────────────────────────

@EntityMixin({
  specificType: "SearchEntity",
  generalType: "SearchEntity",
  allowedConnections: {
    Contains: ["ArticleEntity"],
  },
})
export class SearchEntity extends EntityNode<SearchEntityENH> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | SearchEntityDTO) {
    super(factory, idOrDto);
  }

  async run_search(
    query: string,
    options?: { limit?: number }
  ): Promise<string[]> {
    const limit = options?.limit || 5;

    logger.info(`[SearchEntity] Running search: "${query}"`, {
      entity_id: this.id,
      limit,
    });

    // Call the web search service
    let searchResults: WebSearchResult[];
    try {
      const response = await fetch(`${WEB_SEARCH_URL}/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          limit,
          freshness: "week",
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Web search service returned ${response.status}: ${response.statusText}`
        );
      }

      const data = (await response.json()) as WebSearchResponse;
      searchResults = data.results || [];
    } catch (error) {
      logger.error(`[SearchEntity] Web search failed`, {
        entity_id: this.id,
        error,
      });
      throw error;
    }

    logger.info(
      `[SearchEntity] Found ${searchResults.length} results for: "${query}"`,
      { entity_id: this.id }
    );

    // Create ArticleEntity nodes and "Contains" edges
    const articleIds: string[] = [];

    for (const result of searchResults) {
      try {
        const articleData: ArticleEntityDTOData = {
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          published_date: result.published_date || null,
          analysis: null,
        };

        // Create the ArticleEntity via the entity factory
        const article = await this.factory.create_entity_node({
          app_id: (await this.get_dto()).app_id,
          name: `article-${Date.now()}-${articleIds.length}`,
          specific_type_name: "ArticleEntity",
          general_type_name: "ArticleEntity",
          status: "Pending",
          data: articleData,
        });

        // Access the entity's id (protected, accessible via cast)
        const articleId = (article as any).id as string;

        // Create a "Contains" edge from this SearchEntity to the ArticleEntity
        await this.connect_to({
          to_node_id: articleId,
          to_node_type: "ArticleEntity",
          specific_type_name: "Contains",
          general_type_name: "Edge",
          data: {},
        });

        articleIds.push(articleId);

        logger.info(
          `[SearchEntity] Created ArticleEntity for: ${result.title}`,
          {
            search_id: this.id,
            article_id: articleId,
          }
        );
      } catch (error) {
        logger.error(
          `[SearchEntity] Failed to create article entity for: ${result.title}`,
          { entity_id: this.id, error }
        );
      }
    }

    // Store the search metadata
    await this.update_data({
      query,
      searched_at: new Date().toISOString(),
      article_ids: articleIds,
      result_count: articleIds.length,
    });

    // Run impact analysis on each article (covered in Part 2)
    for (const articleId of articleIds) {
      try {
        const article = await this.factory.get_entity(articleId);
        const analysis = await (article as ArticleEntity).run();

        // Store the analysis result in the article's data
        const articleDto = await (article as ArticleEntity).get_dto();
        await (article as ArticleEntity).update_data({
          ...articleDto.data,
          analysis,
        });

        logger.info(
          `[SearchEntity] Analysis complete for article: ${articleId}`,
          { entity_id: this.id }
        );
      } catch (error: any) {
        logger.error(
          `[SearchEntity] Failed to analyze article: ${articleId} - ${error?.message || error}`,
          { entity_id: this.id }
        );
      }
    }

    return articleIds;
  }

  async get_results(): Promise<ArticleEntityDTOData[]> {
    const dto = await this.get_dto();
    const articleIds = dto.data.article_ids || [];
    const results: ArticleEntityDTOData[] = [];

    for (const articleId of articleIds) {
      try {
        const article = await this.factory.get_entity(articleId);
        const articleDto = await (article as ArticleEntity).get_dto();
        results.push(articleDto.data as ArticleEntityDTOData);
      } catch (error) {
        logger.error(
          `[SearchEntity] Failed to load article: ${articleId}`,
          { entity_id: this.id, error }
        );
      }
    }

    return results;
  }
}
```

**Key concepts:**

- **`@EntityMixin`** registers the entity type. `allowedConnections: { Contains: ["ArticleEntity"] }` declares that this entity can create "Contains" edges to `ArticleEntity` nodes.
- **Web search integration**: `run_search()` calls the platform's web search service at `/v1/search` via a simple `fetch()` POST. The service URL defaults to the in-cluster address but can be overridden with the `WEB_SEARCH_URL` environment variable.
- **Entity creation**: `this.factory.create_entity_node()` creates a new entity in the entity graph. The factory is injected by the SDK and scoped to the application.
- **Edge creation**: `this.connect_to()` creates a typed edge in the entity graph. Edges are queryable -- you can use `ff-eg-read` to traverse from a search to its articles.
- **`get_results()`** loads connected articles by their IDs and returns their data, including any analysis results.

---

## Step 3: Create the ArticleEntity

The `ArticleEntity` stores article metadata and runs AI impact analysis. It uses `AddMixins` to compose `RunnableEntity` with `BotRunnableEntityMixin`, which handles automatic bot execution.

**`apps/news-analysis-bundle/src/entities/ArticleEntity.ts`**:

```typescript
import {
  RunnableEntity,
  BotRunnableEntityMixin,
  EntityMixin,
  EntityFactory,
  logger,
  Context,
} from "@firebrandanalytics/ff-agent-sdk";
import type {
  EntityNodeTypeHelper,
  EntityTypeHelper,
  RunnableEntityTypeHelper,
  BotRequestArgs,
} from "@firebrandanalytics/ff-agent-sdk";
import type { EntityNodeDTO, JSONObject, JSONValue } from "@firebrandanalytics/shared-types";
import type { UUID } from "@firebrandanalytics/shared-types";
import { AddMixins } from "@firebrandanalytics/shared-utils";
import type { ImpactAnalysisBTH } from "../bots/ImpactAnalysisBot.js";
import type { IMPACT_ANALYSIS_OUTPUT } from "../schemas.js";

// ── DTO data shape ──────────────────────────────────────────────────────

export interface ArticleEntityDTOData extends JSONObject {
  title: string;
  url: string;
  snippet: string;
  published_date: string | null;
  analysis: IMPACT_ANALYSIS_OUTPUT | null;
  [key: string]: JSONValue;
}

export type ArticleEntityDTO = EntityNodeDTO & {
  data: ArticleEntityDTOData;
};

// ── Type helpers ────────────────────────────────────────────────────────

export type ArticleEntityENH = EntityNodeTypeHelper<
  EntityTypeHelper<any, any>,
  ArticleEntityDTO,
  "ArticleEntity",
  {},
  {}
>;

export type ArticleEntityRETH = RunnableEntityTypeHelper<
  ArticleEntityENH,
  IMPACT_ANALYSIS_OUTPUT
>;

// ── Entity class ────────────────────────────────────────────────────────

@EntityMixin({
  specificType: "ArticleEntity",
  generalType: "ArticleEntity",
  allowedConnections: {},
})
export class ArticleEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin
)<[
  RunnableEntity<ArticleEntityRETH>,
  BotRunnableEntityMixin<ArticleEntityRETH>
]> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | ArticleEntityDTO) {
    super(
      [factory, idOrDto] as any,  // RunnableEntity(factory, idOrDto)
      ["ImpactAnalysisBot"]       // BotRunnableEntityMixin: look up bot by name
    );
  }

  protected async get_bot_request_args_impl(
    _preArgs: Partial<BotRequestArgs<ImpactAnalysisBTH>>
  ): Promise<BotRequestArgs<ImpactAnalysisBTH>> {
    const dto = await this.get_dto();
    const { title, snippet } = dto.data;

    logger.info(`[ArticleEntity] Building bot request for: ${title}`, {
      entity_id: this.id,
    });

    return {
      args: {} as Record<string, never>,
      input: `Title: ${title}\n\nArticle:\n${snippet}`,
      context: new Context(dto),
    };
  }
}
```

**Key concepts:**

- **`AddMixins(RunnableEntity, BotRunnableEntityMixin)`** composes two classes. `RunnableEntity` provides the `run()` lifecycle, and `BotRunnableEntityMixin` connects it to a registered bot.
- **Constructor argument pattern**: Each tuple in `super()` maps to one class in the composition chain. `[factory, idOrDto]` is spread as `RunnableEntity(factory, idOrDto)`. `["ImpactAnalysisBot"]` passes the bot name to `BotRunnableEntityMixin`, which looks it up from the global bot registry at runtime.
- **`get_bot_request_args_impl()`** is the only method you implement. It builds the bot input from entity data. The mixin handles everything else: looking up the bot, running it, and returning the output.
- **Bot name lookup**: `"ImpactAnalysisBot"` must match the name passed to `@RegisterBot("ImpactAnalysisBot")` on the bot class (see Part 2).

> **Important:** The constructor tuples must be **flat**. Using `super([[factory, idOrDto], []], ["ImpactAnalysisBot"])` (nested arrays) would break `AddMixins` argument forwarding and cause the entity ID to be `undefined`.

---

## Step 4: Register and Wire Up the Bundle

### Constructor Map

Register both entity types so the bundle can instantiate them.

**`apps/news-analysis-bundle/src/constructors.ts`**:

```typescript
import { FFConstructors } from "@firebrandanalytics/ff-agent-sdk";
import { SearchEntity } from "./entities/SearchEntity.js";
import { ArticleEntity } from "./entities/ArticleEntity.js";

// Import bot module to trigger @RegisterBot decorator registration
import "./bots/ImpactAnalysisBot.js";

export const NewsAnalysisConstructors = {
  ...FFConstructors,
  SearchEntity: SearchEntity,
  ArticleEntity: ArticleEntity,
} as const;
```

The `import "./bots/ImpactAnalysisBot.js"` line is important -- it ensures the `@RegisterBot` decorator fires and registers the bot in the global component registry before any entity tries to look it up.

### Agent Bundle Class

The bundle creates `SearchEntity` nodes on demand and exposes three API endpoints.

**`apps/news-analysis-bundle/src/agent-bundle.ts`**:

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  ApiEndpoint,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { NewsAnalysisConstructors } from "./constructors.js";
import { SearchEntity } from "./entities/SearchEntity.js";

// Replace with your applicationId from firefoundry.json
const APP_ID = "YOUR_APPLICATION_ID";

export class NewsAnalysisAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: "NewsAnalysisBundle",
        type: "agent_bundle",
        description:
          "News analysis agent bundle with web search and AI impact assessment",
      },
      NewsAnalysisConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();
    logger.info("NewsAnalysisAgentBundle initialized!");
  }

  @ApiEndpoint({ method: "POST", route: "search" })
  async search(data: {
    query: string;
    limit?: number;
  }) {
    const { query, limit } = data;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new Error("Missing or empty 'query' in request body");
    }

    logger.info(`[API] POST /api/search - query: "${query}"`);

    // Create a SearchEntity for this search session
    const searchEntity = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `search-${Date.now()}`,
      specific_type_name: "SearchEntity",
      general_type_name: "SearchEntity",
      status: "Pending",
      data: {
        query,
        searched_at: new Date().toISOString(),
        article_ids: [],
        result_count: 0,
      },
    });

    // Run the search (creates articles, runs analysis)
    const articleIds = await (searchEntity as SearchEntity).run_search(query, {
      limit,
    });

    // Retrieve the analyzed results
    const articles = await (searchEntity as SearchEntity).get_results();
    const searchDto = await (searchEntity as SearchEntity).get_dto();

    return {
      search_id: searchDto.id!,
      query,
      article_count: articleIds.length,
      articles,
    };
  }

  @ApiEndpoint({ method: "GET", route: "search-results" })
  async getSearchResults(data: { searchId: string }) {
    const { searchId } = data;

    if (!searchId) {
      throw new Error("Missing 'searchId' query parameter");
    }

    const searchEntity = await this.entity_factory.get_entity(searchId);
    const dto = await (searchEntity as SearchEntity).get_dto();
    const articles = await (searchEntity as SearchEntity).get_results();

    return {
      search_id: searchId,
      query: dto.data.query,
      searched_at: dto.data.searched_at,
      article_count: dto.data.result_count,
      articles,
    };
  }

  @ApiEndpoint({ method: "GET", route: "searches" })
  async listSearches() {
    const { result } = await this.entity_client.search_nodes(
      { specific_type_name: "SearchEntity" },
      { created: "DESC" },
      { page: 1, size: 20 }
    );

    const searches = result.map((node: any) => ({
      id: node.id,
      query: node.data?.query || "",
      searched_at: node.data?.searched_at || node.created_at,
      article_count: node.data?.result_count || 0,
    }));

    return { searches };
  }
}
```

Replace `YOUR_APPLICATION_ID` with the `applicationId` from your root `firefoundry.json`.

**Key concepts:**

- **`@ApiEndpoint`** registers custom HTTP routes on the bundle. `{ method: "POST", route: "search" }` creates `POST /api/search`. For GET endpoints, query parameters are passed as properties of the `data` argument.
- **`createEntityClient(APP_ID)`** is the SDK 4.x pattern for creating an entity client scoped to your application.
- **`entity_client.search_nodes()`** queries the entity graph with filters, sort order, and pagination. The sort uses `{ created: "DESC" }` for newest-first.
- **Entity lifecycle**: The bundle creates a `SearchEntity`, calls `run_search()` which creates `ArticleEntity` children, then calls `get_results()` to collect all analyzed data.

### Server Entry Point

The entry point should already be scaffolded. Verify it matches:

**`apps/news-analysis-bundle/src/index.ts`**:

```typescript
import {
  createStandaloneAgentBundle,
  logger,
} from "@firebrandanalytics/ff-agent-sdk";
import { NewsAnalysisAgentBundle } from "./agent-bundle.js";

const port = parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  try {
    const server = await createStandaloneAgentBundle(
      NewsAnalysisAgentBundle,
      { port }
    );
    logger.info(`NewsAnalysisBundle server running on port ${port}`);
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
```

---

## Step 5: Deploy and Test

### Build

```bash
pnpm install
npx turbo build
```

### Deploy

Build the Docker image and deploy to your cluster:

```bash
ff ops build --app-name news-analysis-bundle
ff ops deploy --app-name news-analysis-bundle
```

### Test with ff-sdk-cli

**Check health:**

```bash
ff-sdk-cli health --url http://localhost:3001
# { "healthy": true }
```

**Run a search:**

```bash
ff-sdk-cli api call search \
  --method POST \
  --body '{"query":"AI chip breakthroughs 2026","limit":3}' \
  --url http://localhost:3001
```

Expected response:

```json
{
  "success": true,
  "result": {
    "search_id": "a1b2c3d4-...",
    "query": "AI chip breakthroughs 2026",
    "article_count": 3,
    "articles": [
      {
        "title": "NVIDIA Announces Next-Gen AI Chip Architecture",
        "url": "https://example.com/nvidia-chip",
        "snippet": "NVIDIA unveiled its latest AI chip...",
        "published_date": "2026-02-10",
        "analysis": {
          "article_summary": "NVIDIA announced a new AI chip architecture...",
          "healthcare": { "impact_level": "medium", "confidence": 0.65, "reasoning": "...", "key_factors": ["..."] },
          "shipping_logistics": { "impact_level": "low", "confidence": 0.4, "reasoning": "...", "key_factors": ["..."] },
          "technology": { "impact_level": "critical", "confidence": 0.95, "reasoning": "...", "key_factors": ["..."] },
          "overall_significance": "high"
        }
      }
    ]
  }
}
```

**List recent searches:**

```bash
ff-sdk-cli api call searches --url http://localhost:3001
```

**Retrieve a previous search:**

```bash
ff-sdk-cli api call search-results \
  --query '{"searchId":"a1b2c3d4-..."}' \
  --url http://localhost:3001
```

### Verify with Diagnostic Tools

```bash
# View the SearchEntity node
ff-eg-read node get <search-entity-id>

# View "Contains" edges to articles
ff-eg-read edge list --from <search-entity-id>

# View an ArticleEntity and its analysis data
ff-eg-read node get <article-entity-id> | jq '.data.analysis'

# Trace LLM calls made during analysis
ff-telemetry-read
```

---

**Next:** [Part 2: AI Analysis](./part-02-analysis.md) -- create the Zod schemas, prompt, and structured output bot that power the impact analysis.
