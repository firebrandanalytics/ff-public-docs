# FireFoundry SDK Tutorials

Welcome to the FireFoundry SDK tutorials! This collection of guides demonstrates how to build, consume, and integrate with AI agent bundles deployed on the FireFoundry platform.

## Overview

These tutorials walk you through building a complete end-to-end application using the **News Analysis Agent Bundle** as a reference example. You'll learn how to:

- **Consume** agent bundles using the FF SDK
- **Build APIs** with Express.js middleware
- **Create UIs** with Next.js
- **Stream real-time updates** with WebSockets
- **Structure projects** as monorepos with shared types

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Consumer Layer                          │
├─────────────────────┬───────────────────┬───────────────────┤
│   CLI Tool          │   Next.js Web UI  │   Express API     │
│   (Command Line)    │   (React/GUI)     │   (REST/WS)       │
└──────────┬──────────┴─────────┬─────────┴─────────┬─────────┘
           │                    │                   │
           └────────────────────┼───────────────────┘
                                │
                         FF SDK (Client)
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Agent Bundle        │
                    │   (News Analysis)     │
                    │                       │
                    │   - Entities          │
                    │   - Bots              │
                    │   - Prompts           │
                    └───────────────────────┘
```

## Tutorial Progression

### Foundation

**Prerequisites:**

- Understanding of the [FireFoundry Platform](../../README.md)
- Completed the [AgentSDK Getting Started Guide](../agent_sdk/agent_sdk_getting_started.md)
- News Analysis Agent Bundle deployed (locally or staging)

### 📚 Tutorial Index

#### 1. [FF SDK Tutorial: Getting Started](./ff_sdk_tutorial.md)

**What you'll learn:**

- Core concepts of the FF SDK
- Setting up the RemoteAgentBundleClient
- Invoking entity methods with type safety
- Custom API endpoints
- Binary downloads
- Streaming with iterators
- Error handling and retry logic

**Who it's for:** Anyone consuming agent bundles programmatically

**Time:** 30-45 minutes

**Key takeaways:**

```typescript
import { RemoteAgentBundleClient } from "@firebrandanalytics/ff-sdk";

const client = new RemoteAgentBundleClient("http://localhost:3001", {
  api_key: "your-api-key",
  timeout: 60000,
});

const result = await client.invoke_entity_method(
  entityId,
  "method_name",
  arg1,
  arg2
);
```

---

#### 2. [Consuming the News Analysis Agent Bundle](./news_analysis_consumer.md)

**What you'll learn:**

- Practical application of FF SDK patterns
- Building a complete CLI tool with yargs
- Working with shared types in a monorepo
- Batch processing and error handling
- Exporting results in multiple formats

**Who it's for:** Developers building CLI tools or programmatic consumers

**Time:** 45-60 minutes

**Key takeaways:**

```bash
# Analyze a single article
npm start analyze ./article.txt

# Batch process multiple articles
npm start batch ./articles -c 5 -o results.csv

# View analysis history
npm start history -l 10
```

---

#### 3. [Express.js Middleware with WebSocket Streaming](./express_middleware_tutorial.md)

**What you'll learn:**

- Building a REST API middleware layer
- WebSocket connection management
- Real-time progress streaming
- Advanced features: authentication, rate limiting, caching
- Production deployment patterns

**Who it's for:** Backend developers building APIs for web/mobile apps

**Time:** 60-90 minutes

**Architecture:**

```
Client Apps → Express Middleware → Agent Bundle
              ↓
              REST API + WebSocket
```

**Key takeaways:**

```typescript
// REST endpoint
app.post("/api/analyze", async (req, res) => {
  const result = await analysisService.analyzeArticle(req.body.article);
  res.json({ success: true, data: result });
});

// WebSocket streaming
ws.on("message", async (data) => {
  await handleAnalyze(ws, message, wsManager);
});
```

---

#### 4. [Next.js GUI for News Analysis](./nextjs_news_analysis_gui.md)

**What you'll learn:**

- Building a web interface with Next.js
- Form validation and loading states
- Displaying structured analysis results
- Working with shared types in a monorepo
- Responsive design with Tailwind CSS

**Who it's for:** Frontend developers building web applications

**Time:** 45-60 minutes

**Key takeaways:**

```typescript
// Type-safe API calls
import type { IMPACT_ANALYSIS_OUTPUT } from "@my-workspace/shared-types";

const result = await analyzeArticle({
  article: articleText,
  metadata: { source_url: sourceUrl },
});
```

---

#### 5. [Frontend Development Guide for Agent Bundles](./frontend_development_guide.md) ⭐ **NEW**

**What you'll learn:**

- Using `RemoteAgentBundleClient` and `RemoteEntityClient` correctly
- Setting up server-side configuration in Next.js
- Common patterns: creating entities, file uploads, entity queries
- When to use each client type
- Architecture patterns: Next.js API routes as proxy
- Error handling and best practices

**Who it's for:** Coding agents building frontends for FireFoundry agent bundles

**Time:** 30-45 minutes

**Key takeaways:**

```typescript
// Server-side configuration
import { getAgentBundleClient, getEntityClient } from "@/lib/serverConfig";

// In Next.js API route (server-side only)
const bundleClient = getAgentBundleClient();
const entityClient = getEntityClient();

// Call agent bundle endpoint
await bundleClient.call_api_endpoint("create-report", { method: "POST", body });

// Query entity graph
await entityClient.search_nodes_scoped(criteria, sort, pagination);
```

**Why this guide:** Specifically written for coding agents who need to understand the two client types (`RemoteAgentBundleClient` vs `RemoteEntityClient`) and when to use each. Emphasizes using official FireFoundry clients instead of generic HTTP clients.

---

## Learning Paths

Choose your path based on your role and goals:

### 🎯 Path 1: Backend Developer

**Goal:** Build robust APIs for consuming agent bundles

1. Start with [FF SDK Tutorial](#1-ff-sdk-tutorial-getting-started) (Foundation)
2. Read [News Analysis Consumer](#2-consuming-the-news-analysis-agent-bundle) (Practical examples)
3. Build [Express Middleware](#3-expressjs-middleware-with-websocket-streaming) (Production API)

**Outcome:** Production-ready REST/WebSocket API with authentication, rate limiting, and monitoring

---

### 🎨 Path 2: Frontend Developer

**Goal:** Create user interfaces for agent bundle features

1. Read [Frontend Development Guide](#5-frontend-development-guide-for-agent-bundles--new) (Core concepts and patterns)
2. Jump to [Next.js GUI](#4-nextjs-gui-for-news-analysis) (Build the UI)
3. Reference [Express Middleware](#3-expressjs-middleware-with-websocket-streaming) (Add real-time features)

**Outcome:** Modern, responsive web interface with real-time updates

---

### 🔧 Path 3: DevOps / Full-Stack

**Goal:** Deploy complete end-to-end solutions

1. Complete [FF SDK Tutorial](#1-ff-sdk-tutorial-getting-started) (Foundation)
2. Build [News Analysis Consumer](#2-consuming-the-news-analysis-agent-bundle) (CLI tool)
3. Deploy [Express Middleware](#3-expressjs-middleware-with-websocket-streaming) (API layer)
4. Deploy [Next.js GUI](#4-nextjs-gui-for-news-analysis) (Web interface)

**Outcome:** Complete stack from database to UI, ready for production

---

### 📱 Path 4: CLI/Automation Developer

**Goal:** Build command-line tools and automation

1. Complete [FF SDK Tutorial](#1-ff-sdk-tutorial-getting-started) (Foundation)
2. Focus on [News Analysis Consumer](#2-consuming-the-news-analysis-agent-bundle) (CLI patterns)
3. Add scripting and automation features

**Outcome:** Powerful CLI tools for batch processing and automation

---

## Common Patterns

### Monorepo Structure

All tutorials assume a monorepo structure for type safety and code sharing:

```
my-app-monorepo/
├── packages/
│   ├── agent-bundle/         # AgentSDK (built with tutorial)
│   ├── shared-types/          # Shared TypeScript types
│   ├── cli-tool/              # CLI consumer (Tutorial 2)
│   ├── api-middleware/        # Express API (Tutorial 3)
│   └── web-ui/                # Next.js UI (Tutorial 4)
├── package.json
└── pnpm-workspace.yaml
```

### Shared Types Pattern

**Why:** Maintain type safety between agent bundle and consumers

**Example:**

```typescript
// packages/shared-types/src/index.ts
export interface IMPACT_ANALYSIS_OUTPUT {
  article_summary: string;
  healthcare: VerticalImpact;
  shipping_logistics: VerticalImpact;
  technology: VerticalImpact;
  overall_significance: "low" | "medium" | "high";
}

// Used in agent bundle, CLI, API, and web UI
```

### Environment Configuration

All tutorials use environment variables for configuration:

```bash
# Common across all consumers
AGENT_BUNDLE_URL=http://localhost:3001
AGENT_BUNDLE_API_KEY=your-api-key-here
NEWS_COLLECTION_ID=c0000000-0000-0000-0001-000000000001
```

---

## Quick Start Guide

### Prerequisites

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Verify Node.js version
node --version  # Should be 20+
```

### 1. Set Up Monorepo

```bash
# Create monorepo structure
mkdir my-news-app && cd my-news-app
pnpm init

# Create workspace
mkdir -p packages/{agent-bundle,shared-types,cli-tool,api,web-ui}
```

### 2. Add Agent Bundle

Follow the [AgentSDK Getting Started Guide](../agent_sdk/agent_sdk_getting_started.md) to build the News Analysis agent bundle.

### 3. Add Shared Types

```bash
cd packages/shared-types
# Create package.json and tsconfig.json (see Tutorial 4)
pnpm install
pnpm build
```

### 4. Choose Your Consumer

**Option A: CLI Tool**

```bash
cd packages/cli-tool
# Follow Tutorial 2
```

**Option B: API Middleware**

```bash
cd packages/api
# Follow Tutorial 3
```

**Option C: Web UI**

```bash
cd packages/web-ui
# Follow Tutorial 4
```

---

## Code Examples Repository

Each tutorial includes complete, runnable code examples. You can find them in:

```
docs/sdk/ff_sdk/examples/
├── 01-basic-client/           # From Tutorial 1
├── 02-news-analysis-cli/      # From Tutorial 2
├── 03-express-middleware/     # From Tutorial 3
└── 04-nextjs-gui/             # From Tutorial 4
```

---

## Troubleshooting

### Common Issues

**Connection Errors**

```bash
# Check agent bundle is running
curl http://localhost:3001/health

# Verify API key
echo $AGENT_BUNDLE_API_KEY

# Check collection ID
curl -H "Authorization: Bearer $AGENT_BUNDLE_API_KEY" \
  http://localhost:3001/info
```

**Type Errors**

```bash
# Rebuild shared types
cd packages/shared-types
pnpm build

# Restart dev server
cd packages/web-ui  # or other package
pnpm dev
```

**Timeout Errors**

```typescript
// Increase timeout in client
const client = new RemoteAgentBundleClient(url, {
  api_key: apiKey,
  timeout: 120000, // 2 minutes
});
```

---

## Best Practices

### 1. Type Safety

✅ **Do:** Use shared types from workspace package

```typescript
import type { IMPACT_ANALYSIS_OUTPUT } from "@my-workspace/shared-types";
```

❌ **Don't:** Duplicate types across packages

```typescript
// Don't do this in multiple places
interface AnalysisOutput { ... }
```

### 2. Error Handling

✅ **Do:** Provide clear, actionable error messages

```typescript
try {
  const result = await analyzeArticle(text);
} catch (error) {
  console.error("Analysis failed:", error.message);
  // Show user-friendly message
}
```

❌ **Don't:** Swallow errors silently

```typescript
try {
  await analyzeArticle(text);
} catch (error) {
  // Silent failure - bad!
}
```

### 3. Configuration Management

✅ **Do:** Use environment variables

```typescript
const config = {
  url: process.env.AGENT_BUNDLE_URL,
  apiKey: process.env.AGENT_BUNDLE_API_KEY,
};
```

❌ **Don't:** Hardcode configuration

```typescript
const url = "http://localhost:3001"; // Don't hardcode
const apiKey = "my-secret-key"; // Never commit secrets
```

### 4. Loading States

✅ **Do:** Show progress feedback

```typescript
setLoading(true);
setStatus("Analyzing article...");
// ... perform analysis
setLoading(false);
```

❌ **Don't:** Leave users wondering

```typescript
// No feedback during long operations
await analyzeArticle(text);
```

---

## Additional Resources

### FireFoundry Platform Documentation

- [Platform Overview](../../README.md) - Architecture and concepts
- [AgentSDK Getting Started](../agent_sdk/agent_sdk_getting_started.md) - Building agent bundles
- [Frontend Development Guide](./frontend_development_guide.md) - **Recommended for coding agents building frontends**
- [Entity Client Reference](./ENTITY_CLIENT_REFERENCE.md) - `RemoteEntityClient` API documentation
- [RemoteAgentBundleClient](./RemoteAgentBundleClient.md) - Agent bundle client API documentation

### External Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)
- [WebSocket Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

### Community and Support

- GitHub Issues: Report bugs and request features
- Discussions: Ask questions and share examples
- Examples Repository: Reference implementations

---

## Contributing

We welcome contributions to these tutorials! If you find errors, have suggestions, or want to add new examples:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## Tutorial Maintenance

These tutorials are tested against:

- **FF SDK**: v0.8.1+
- **AgentSDK**: v0.6.0+
- **Next.js**: v15.3.2+
- **Node.js**: v20+

Last updated: January 2025

---

## What's Next?

After completing these tutorials, you might want to explore:

### Advanced Topics

- **Multi-agent Coordination**: Orchestrating multiple agent bundles
- **Custom Streaming Protocols**: Implementing custom progress updates
- **Advanced Caching Strategies**: Redis integration for performance
- **Monitoring and Observability**: Distributed tracing and metrics
- **Security Hardening**: Authentication, authorization, and rate limiting

### Integration Patterns

- **Mobile Apps**: React Native or Flutter integration
- **Desktop Apps**: Electron or Tauri integration
- **Serverless**: AWS Lambda or Cloudflare Workers
- **Message Queues**: RabbitMQ or Kafka integration

### Scaling and Operations

- **Load Balancing**: Distributing requests across agent bundles
- **Auto-scaling**: Dynamic scaling based on demand
- **Multi-region Deployment**: Geographic distribution
- **Backup and Disaster Recovery**: Data protection strategies

---

## Feedback

We're constantly improving these tutorials based on user feedback. If you have suggestions, please:

- Open an issue on GitHub
- Submit a pull request
- Contact us at support@firefoundry.ai

---

**Generated by Claude**

Happy building with FireFoundry! 🚀
