# Building Your First Agent Bundle: The Application Container

Welcome! You've learned how to craft Prompts that shape AI behavior, Bots that execute AI tasks, and Entities that model your business domain. Now it's time to bring it all together by building an **Agent Bundle**—the application container that hosts your entities, exposes APIs, and orchestrates your AI-powered workflows.

## The Goal

We'll extend the **News Analysis** application from previous tutorials by creating a complete `NewsAnalysisAgentBundle` that:
- Initializes the application and creates bootstrap entities
- Exposes ID-less API endpoints for external consumers using `@ApiEndpoint`
- Demonstrates when to use ID-less APIs vs. entity-based invocation
- Integrates with the entity factory and client to manage the entity graph

## What is an Agent Bundle?

An **Agent Bundle** is the top-level application class that serves as:
- **The deployment unit**: Packaged into a container and deployed to the FireFoundry platform
- **The application context**: Provides access to platform services (entity factory, client, broker)
- **The API layer**: Exposes endpoints for external systems to interact with your application
- **The initialization point**: Sets up initial state, creates bootstrap entities, and configures the application

Think of it as the "main" class or entry point for your AI application—similar to an Express app or a Spring Boot application in traditional web development.

---

## Chapter 1: The Basic Structure

Let's start by creating the simplest possible agent bundle.

### Step 1: Define Your Bundle Class

Every agent bundle extends `FFAgentBundle` and provides three key pieces of information: identity, entity constructors, and an entity client.

```typescript
import {
  FFAgentBundle,
  createEntityClient,
  logger,
} from '@firebrandanalytics/ff-agent-sdk';
import { NewsAnalysisConstructors } from './constructors.js';

const APP_ID = 'b5bcb46b-5d7d-4a83-8088-639562f77bf6';

export class NewsAnalysisAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,                        // Required in v4
        name: 'NewsAnalysis',
        type: 'agent_bundle',                          // Component type
        description: 'News impact analysis agent bundle',
      },
      NewsAnalysisConstructors,       // Registry of entity types
      createEntityClient(APP_ID)      // Entity client for this app
    );
  }
}
```

**Key Elements:**
- **Identity**: A unique UUID, `application_id`, name, and `type` that identifies this bundle in the platform
- **Constructors**: A registry object that maps entity type names to their constructor classes (covered in the entity tutorial)
- **Entity Client**: `createEntityClient(APP_ID)` provides access to the entity graph for this application

### Step 2: The Constructors Registry

The constructors registry tells the bundle which entity classes exist in your application:

```typescript
// constructors.ts
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { ArticleEntity } from './entities/ArticleEntity.js';
import { NewsCollection } from './entities/NewsCollection.js';

export const NewsAnalysisConstructors = {
  ...FFConstructors,        // Include built-in entity types
  ArticleEntity: ArticleEntity,
  NewsCollection: NewsCollection,
} as const;
```

This registry enables the entity factory to instantiate entities by type name, which is crucial for persistence and deserialization.

### Step 3: The Initialization Lifecycle

Override the `init()` method to perform one-time setup when your bundle starts:

```typescript
export class NewsAnalysisAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: APP_ID,
        application_id: APP_ID,
        name: 'NewsAnalysis',
        type: 'agent_bundle',
        description: 'News impact analysis agent bundle',
      },
      NewsAnalysisConstructors,
      createEntityClient(APP_ID)
    );
  }

  override async init() {
    await super.init();  // Always call super first!
    logger.info('NewsAnalysisAgentBundle initialized!');

    // Initialize your application here
    await this.create_bootstrap_entities();
  }

  private async create_bootstrap_entities() {
    // Check if our collection already exists
    const existing = await this.entity_client.get_node_by_name('news-collection');
    if (existing) {
      logger.info('News collection already exists:', existing.id);
      return;
    }

    // Create a root collection entity for organizing articles
    const collectionDto = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: 'news-collection',
      specific_type_name: 'NewsCollection',
      general_type_name: 'Collection',
      status: 'Active',
      data: {
        title: 'News Articles',
        created_at: new Date().toISOString(),
      },
    });

    logger.info('Created news collection:', collectionDto.id);
  }
}
```

**The `init()` Pattern:**
1. Always call `super.init()` first to initialize the parent class
2. Use the entity client to check if bootstrap entities already exist (idempotency)
3. Create any necessary root entities for your application
4. Log important initialization steps for debugging

---

## Chapter 2: Exposing APIs with `@ApiEndpoint`

Now that we have a basic bundle, let's expose APIs that external systems can call.

### Understanding Two Invocation Patterns

FireFoundry supports two ways for external systems to interact with your application:

1. **Entity-Based Invocation**: Call a specific entity by its ID (e.g., `POST /invoke/{entityId}`)
   - Use when you have a specific entity instance to operate on
   - The entity's `run()` or custom methods are executed
   - State is naturally scoped to that entity

2. **ID-less APIs via `@ApiEndpoint`**: Call bundle-level endpoints without an entity ID
   - Use for operations that don't naturally start with an existing entity
   - Useful for creating new workflows, querying across entities, or application-level operations
   - You control routing, parameters, and response structure

### Step 1: Your First `@ApiEndpoint`

Let's create an endpoint to analyze a new article:

```typescript
import { ApiEndpoint } from '@firebrandanalytics/ff-agent-sdk';

export class NewsAnalysisAgentBundle extends FFAgentBundle<any> {
  // ... constructor and init() ...

  @ApiEndpoint({ method: 'POST', route: 'analyze-article' })
  async analyzeArticle(
    body: any = {}
  ): Promise<{ articleId: string; message: string }> {
    const { articleText } = body;
    
    if (!articleText) {
      throw new Error('articleText is required');
    }

    // Create a new article entity
    const articleDto = await this.entity_factory.create_entity_node({
      app_id: this.get_app_id(),
      name: `article-${Date.now()}`,
      specific_type_name: 'ArticleEntity',
      general_type_name: 'Article',
      status: 'Pending',
      data: {
        text: articleText,
        received_at: new Date().toISOString(),
      },
    });

    logger.info('Created article entity:', articleDto.id);

    // Now we could invoke the entity to run its analysis
    // (We'll cover this pattern in the next section)

    return {
      articleId: articleDto.id,
      message: 'Article created and queued for analysis',
    };
  }
}
```

**Key Points:**
- The `@ApiEndpoint` decorator takes a configuration object with `method` and `route`
- The method receives a `body` parameter for POST requests (we'll see query params shortly)
- Return any JSON-serializable object; it will be sent as the HTTP response
- Throw errors directly—the framework handles error responses

**How It's Called:**
```bash
curl -X POST http://localhost:3000/analyze-article \
  -H "Content-Type: application/json" \
  -d '{"articleText": "Breaking news: New AI breakthrough..."}'
```

### Step 2: GET Endpoints with Query Parameters

For GET requests, use the `query` parameter instead of `body`:

```typescript
@ApiEndpoint({ method: 'GET', route: 'get-article' })
async getArticle(query: any = {}): Promise<any> {
  const { articleId } = query;
  
  if (!articleId) {
    throw new Error('articleId query parameter is required');
  }

  // Fetch the entity
  const article = await this.entity_factory.get_entity(articleId);
  const articleDto = await article.get_dto();

  return {
    id: articleDto.id,
    status: articleDto.status,
    text: articleDto.data.text,
    analysis: articleDto.data.analysis || null,
    created: articleDto.created,
  };
}
```

**How It's Called:**
```bash
curl "http://localhost:3000/get-article?articleId=123e4567-e89b-12d3-a456-426614174000"
```

### Step 3: Working with the Entity Factory and Client

Within your API endpoints, you have full access to the entity system:

```typescript
@ApiEndpoint({ method: 'GET', route: 'list-articles' })
async listArticles(query: any = {}): Promise<any[]> {
  const { status } = query;

  // Build search criteria
  const searchCriteria: any = { specific_type_name: 'ArticleEntity' };
  if (status) {
    searchCriteria.status = status;
  }

  // Use entity_client to search
  const result = await this.entity_client.search_nodes(
    searchCriteria,
    { created: 'desc' }  // Sort by creation date, newest first
  );

  // Transform and return
  return result.result.map(dto => ({
    id: dto.id,
    status: dto.status,
    excerpt: dto.data.text.substring(0, 100) + '...',
    created: dto.created,
  }));
}
```

**Available Tools:**
- `this.entity_factory`: Create and retrieve entity instances
- `this.entity_client`: Low-level operations like search, graph traversal, batch operations
- `this.get_app_id()`: Get the application's unique ID
- Entity methods: `get_dto()`, `get_node_io()`, `appendConnection()`, etc.

---

## Chapter 3: Bridging ID-less APIs and Entity Invocation

The real power comes from combining ID-less APIs (for creation and coordination) with entity-based invocation (for processing).

### Pattern: Create-then-Invoke

A common pattern is to create an entity via an `@ApiEndpoint`, then either:
1. Invoke it immediately for synchronous processing
2. Return the entity ID for the client to invoke later

Let's implement both:

### Synchronous Processing

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze-article-sync' })
async analyzeArticleSync(body: any = {}): Promise<any> {
  const { articleText } = body;
  
  if (!articleText) {
    throw new Error('articleText is required');
  }

  // Create the entity
  const articleDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `article-${Date.now()}`,
    specific_type_name: 'ArticleEntity',
    general_type_name: 'Article',
    status: 'Pending',
    data: { text: articleText },
  });

  // Get the entity instance and run it
  const article = await this.entity_factory.get_entity(articleDto.id);
  const result = await article.run({ articleText });

  return {
    articleId: articleDto.id,
    analysis: result,
    message: 'Analysis completed',
  };
}
```

### Asynchronous Processing

For long-running workflows, create the entity and return immediately:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze-article-async' })
async analyzeArticleAsync(body: any = {}): Promise<any> {
  const { articleText } = body;
  
  if (!articleText) {
    throw new Error('articleText is required');
  }

  // Create the entity
  const articleDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `article-${Date.now()}`,
    specific_type_name: 'ArticleEntity',
    general_type_name: 'Article',
    status: 'Pending',
    data: { text: articleText },
  });

  // Start processing in the background (don't await)
  this.start_article_processing(articleDto.id).catch(error => {
    logger.error(`Background processing failed for ${articleDto.id}:`, error);
  });

  return {
    articleId: articleDto.id,
    message: 'Article queued for analysis',
    statusUrl: `/get-article?articleId=${articleDto.id}`,
  };
}

private async start_article_processing(articleId: string) {
  const article = await this.entity_factory.get_entity(articleId);
  await article.run({});
  logger.info(`Article ${articleId} processing completed`);
}
```

**Client Usage:**
```typescript
// Client calls the async endpoint
const response = await fetch('/analyze-article-async', {
  method: 'POST',
  body: JSON.stringify({ articleText: '...' }),
});
const { articleId, statusUrl } = await response.json();

// Client can poll for status
const checkStatus = async () => {
  const statusResponse = await fetch(statusUrl);
  const article = await statusResponse.json();
  
  if (article.status === 'Completed') {
    console.log('Analysis ready:', article.analysis);
  } else {
    // Poll again later
    setTimeout(checkStatus, 2000);
  }
};
checkStatus();
```

---

## Chapter 4: When to Use Each Pattern

### Use `@ApiEndpoint` (ID-less) When:
- **Creating new workflows**: External systems don't have an entity ID yet
- **Application-level operations**: Health checks, stats, list operations
- **Bulk operations**: Processing multiple entities in one request
- **Custom routing needs**: You want REST-style URLs like `/articles/{year}/{month}`

### Use Entity-Based Invocation When:
- **Processing a specific entity**: You have the entity ID and want to execute its logic
- **Resumable operations**: Leveraging the runnable pattern for idempotency
- **Entity context matters**: The operation is naturally scoped to a specific entity instance

### Example Decision Matrix

| Operation | Pattern | Why |
|-----------|---------|-----|
| Submit new article for analysis | `@ApiEndpoint` | Client doesn't have an entity ID yet |
| Get analysis results | Either | `@ApiEndpoint` for convenience, entity invocation if you need entity methods |
| Resume a paused workflow | Entity-based | The workflow entity knows its state |
| List all articles | `@ApiEndpoint` | Cross-entity query, no single entity context |
| Re-analyze an article | Entity-based | Operating on a specific entity with existing state |

---

## Chapter 5: Advanced Patterns

### Pattern: Factory Endpoints

Create endpoints that handle common entity creation patterns:

```typescript
@ApiEndpoint({ method: 'POST', route: 'create-analysis-workflow' })
async createAnalysisWorkflow(body: any = {}): Promise<any> {
  const { articleText, analysisType = 'standard' } = body;
  
  if (!articleText) {
    throw new Error('articleText is required');
  }

  // Create the root request entity
  const requestDto = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `analysis-request-${Date.now()}`,
    specific_type_name: 'AnalysisRequest',
    general_type_name: 'Request',
    status: 'Pending',
    data: { articleText, analysisType },
  });

  // Create and connect a workflow entity
  const requestEntity = await this.entity_factory.get_entity(requestDto.id);
  const workflow = await requestEntity.appendConnection(
    'TriggersRun',
    'AnalysisWorkflow',  // Entity type name
    `workflow-${requestDto.id}`,
    { articleText, analysisType }
  );

  const workflowDto = await workflow.get_dto();

  // Start the workflow
  const generator = await workflow.start();
  
  // Process in background
  (async () => {
    for await (const step of generator) {
      logger.info(`Workflow ${workflowDto.id} step:`, step);
    }
  })().catch(error => {
    logger.error(`Workflow ${workflowDto.id} failed:`, error);
  });

  return {
    requestId: requestDto.id,
    workflowId: workflowDto.id,
    message: 'Analysis workflow started',
  };
}
```

### Pattern: Error Handling

Use try-catch blocks and meaningful error messages:

```typescript
@ApiEndpoint({ method: 'POST', route: 'analyze-article' })
async analyzeArticle(body: any = {}): Promise<any> {
  try {
    const { articleText } = body;
    
    // Validation
    if (!articleText) {
      throw new Error('articleText is required');
    }
    
    if (articleText.length < 50) {
      throw new Error('Article text must be at least 50 characters');
    }

    // Process...
    const articleDto = await this.entity_factory.create_entity_node({
      // ...
    });

    return {
      success: true,
      articleId: articleDto.id,
    };
  } catch (error) {
    logger.error('Failed to analyze article:', error);
    
    // Rethrow with context
    throw new Error(`Article analysis failed: ${error.message}`);
  }
}
```

### Pattern: Accessing Bundle Context

Store bundle-level state for quick access:

```typescript
export class NewsAnalysisAgentBundle extends FFAgentBundle<any> {
  private collectionId?: string;

  override async init() {
    await super.init();
    
    // Store the collection ID for quick access
    const collection = await this.entity_client.get_node_by_name('news-collection');
    if (collection) {
      this.collectionId = collection.id;
    }
  }

  @ApiEndpoint({ method: 'POST', route: 'analyze-article' })
  async analyzeArticle(body: any = {}): Promise<any> {
    // ... create article ...
    
    // Link to collection if available
    if (this.collectionId) {
      await this.entity_client.create_edge({
        from_node_id: this.collectionId,
        to_node_id: articleDto.id,
        edge_type: 'Contains',
      });
    }

    return { articleId: articleDto.id };
  }
}
```

---

## Chapter 6: Consuming Your Agent Bundle

Now that you've built and exposed APIs, let's look at how external systems consume your agent bundle.

### Understanding Access Patterns

There are three main deployment and access patterns:

#### 1. **Production: Access via Kong Gateway (Recommended)**

In production, agent bundles are accessed through the **Kong API Gateway**, which provides:
- Authentication and authorization
- Rate limiting and throttling
- SSL/TLS termination
- Request routing and load balancing

```
Client → Kong Gateway → Agent Bundle
```

**This is the only pattern where the ff-sdk works**, because Kong adds the necessary routing and authentication layers.

#### 2. **Development: Local with Port Forwarding**

When running locally for development, you can port-forward to your agent bundle service:
- Requires port-forwarding the bundle AND all FireFoundry services (Context Service, Broker, etc.)
- Suitable for debugging specific bundle logic
- Does NOT work with ff-sdk (use direct HTTP calls)

```
Client → Port Forward → Agent Bundle → Port Forward → Platform Services
```

#### 3. **Testing: Deploy to Minikube, Port Forward Bundle**

Deploy to a local FireFoundry cluster (Minikube) and port-forward just the agent bundle:
- Platform services run in the cluster
- Agent bundle communicates internally via gRPC
- Does NOT work with ff-sdk (use direct HTTP calls)

```
Client → Port Forward → Agent Bundle → gRPC → Platform Services (in cluster)
```

### Primary Method: Using the FF SDK (Production)

**For production and Kong-fronted deployments**, use the FireFoundry SDK:

```typescript
import { RemoteAgentBundleClient } from '@firebrandanalytics/ff-sdk';

// Create client pointing to Kong gateway
const client = new RemoteAgentBundleClient(
  'https://api.yourcompany.com/news-analysis',  // Kong gateway URL
  {
    api_key: process.env.API_KEY,
    timeout: 60000,
  }
);

// Call your custom @ApiEndpoint
const result = await client.call_api_endpoint('analyze-article', {
  method: 'POST',
  body: {
    articleText: 'Breaking: New AI breakthrough...',
  },
});

console.log('Analysis result:', result);

// Call a GET endpoint
const article = await client.call_api_endpoint('get-article', {
  query: { articleId: 'abc-123' },
});

console.log('Article:', article);

// Invoke a specific entity (entity-based invocation)
const entityResult = await client.invoke_entity_method(
  articleEntityId,
  'run',
  { /* args */ }
);
```

**Key Features of FF SDK:**
- ✅ Type-safe API calls with TypeScript
- ✅ Automatic authentication with API keys
- ✅ Built-in retry and error handling
- ✅ WebSocket streaming support
- ✅ Binary upload/download support
- ✅ Works seamlessly with Kong routing

**Installation:**
```bash
npm install @firebrandanalytics/ff-sdk
```

**Full Documentation:** See the [FF SDK Tutorial](../../ff_sdk/ff_sdk_tutorial.md) for comprehensive examples.

### Alternative: Direct HTTP Access (Debugging Only)

For **local debugging or testing without Kong**, you can use direct HTTP calls:

```typescript
// Direct HTTP (local/debugging only)
async function analyzeArticleDirect(articleText: string) {
  const response = await fetch('http://localhost:3000/analyze-article', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleText }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}
```

**⚠️ Important:** Direct HTTP access is **NOT recommended** for production. Use it only for:
- Local development without Kong
- Low-level debugging
- Testing bundle endpoints directly

**Limitations of Direct HTTP:**
- ❌ No built-in authentication
- ❌ No retry logic
- ❌ No type safety
- ❌ Manual error handling required
- ❌ Doesn't work with Kong routing

### Testing Locally

For local development, run your bundle standalone:

```typescript
// index.ts
import { createStandaloneAgentBundle, logger } from '@firebrandanalytics/ff-agent-sdk';
import { NewsAnalysisAgentBundle } from './agent-bundle.js';

async function startServer() {
  const port = parseInt(process.env.PORT || '3000', 10);

  logger.info(`Starting NewsAnalysis server on port ${port}`);

  const server = await createStandaloneAgentBundle(
    NewsAnalysisAgentBundle,
    { port }
  );

  logger.info(`Server running on port ${port}`);
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`Custom endpoints: http://localhost:${port}/<route>`);
}

startServer();
```

**Test with curl (local debugging):**
```bash
# Health check
curl http://localhost:3000/health

# Test custom endpoint
curl -X POST http://localhost:3000/analyze-article \
  -H "Content-Type: application/json" \
  -d '{"articleText": "Breaking news..."}'

# Test GET endpoint
curl "http://localhost:3000/get-article?articleId=abc-123"
```

### Recommended Workflow

```
┌─────────────────────────────────────────────────────┐
│              Development Workflow                    │
└─────────────────────────────────────────────────────┘

1. Local Development
   └─→ Run bundle standalone (port 3000)
   └─→ Test with curl or direct HTTP
   └─→ Iterate quickly

2. Integration Testing  
   └─→ Deploy to Minikube cluster
   └─→ Port-forward agent bundle
   └─→ Test with other services

3. Staging/Production
   └─→ Deploy through Kong gateway
   └─→ Use FF SDK for all consumption
   └─→ Full authentication & observability
```

---

## Summary

You've now learned how to:

✅ **Create an agent bundle class** that extends `FFAgentBundle`  
✅ **Initialize your application** with the `init()` lifecycle method  
✅ **Expose ID-less APIs** using the `@ApiEndpoint` decorator  
✅ **Handle POST and GET requests** with body and query parameters  
✅ **Work with the entity factory and client** within API endpoints  
✅ **Bridge ID-less and entity-based invocation** patterns  
✅ **Implement common patterns** like create-then-invoke and async processing  
✅ **Understand when to use each invocation pattern** based on your use case  
✅ **Test your bundle locally** using the standalone server

### What's Next?

- **Comprehensive Reference**: Read the [Agent Bundles Guide](./agent_bundles.md) for in-depth coverage of all features
- **Deployment**: Learn how to package and deploy your bundle to the FireFoundry platform
- **Advanced Patterns**: Explore workflow orchestration, cross-bundle communication, and human-in-the-loop patterns
- **Production Best Practices**: Authentication, rate limiting, monitoring, and error handling strategies

Your agent bundle is the entry point to your AI application. With the patterns you've learned here, you can build sophisticated, production-ready services that expose your AI capabilities to the world.

