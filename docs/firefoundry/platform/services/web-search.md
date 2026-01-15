# Web Search Service

## Overview

The Web Search Service is an in-development FireFoundry microservice designed to provide web search capabilities for AI agents. Currently in the template stage, this service establishes the foundational structure for integrating search functionality into the FireFoundry platform.

## Purpose and Role in Platform

When complete, this service will enable FireFoundry agents to:
- **Search the Web**: Execute queries and retrieve relevant results
- **Access Current Information**: Supplement agent knowledge with up-to-date web data
- **Augment Context**: Provide search results for RAG (Retrieval-Augmented Generation) patterns
- **Research Capabilities**: Support multi-step research workflows with iterative searching

## Current Status

**Maturity Level**: Template Stage - Not Production Ready

This service is currently in the early planning phase:
- ✅ Repository created from FireFoundry service template
- ✅ Basic Express 5 service structure in place
- ✅ Standard health/readiness endpoints configured
- ✅ Docker and CI/CD pipeline scaffolding
- 📋 Search provider integration not yet implemented
- 📋 API endpoints for search operations not defined
- 📋 No production search capabilities available

## Planned Features

### Search Capabilities (Planned)
- **Web Search**: General web search using external search APIs
- **Result Filtering**: Relevance scoring and content filtering
- **Pagination**: Support for paginated result sets
- **Domain Filtering**: Restrict searches to specific domains or exclude domains
- **Safe Search**: Content filtering options

### Integration Points (Planned)
- **Search Providers**: Integration with Google Search API, Bing Search API, or alternative providers
- **Context Service**: Store search results in agent working memory
- **Caching Layer**: Cache frequently-requested queries to reduce API costs
- **Rate Limiting**: Manage search API quota consumption

### API Endpoints (Planned)
- `POST /api/search` - Execute web search query
- `GET /api/search/:id` - Retrieve cached search results
- `POST /api/search/batch` - Execute multiple searches

## Architecture

### Current Structure
The service uses the standard FireFoundry microservice template:
- **Express 5**: HTTP server with Router-based routing
- **Service Class**: Application lifecycle management
- **RouteManager**: Centralized route definitions (placeholder routes only)
- **Provider Pattern**: Business logic layer (not yet implemented for search)
- **TypeScript**: Full type safety with strict mode
- **Health Endpoints**: Kubernetes-ready probes

### Planned Components
- **SearchProvider**: Core business logic for search operations
- **Search Client Abstraction**: Pluggable search provider backends
- **Result Parser**: Normalize results from different search APIs
- **Cache Manager**: Redis or PostgreSQL-based result caching
- **Rate Limiter**: API quota management

## Dependencies

### Current Dependencies
- **Express 5**: Web framework
- **@firebrandanalytics/shared-utils**: Logging and common utilities
- **dotenv**: Environment configuration
- **winston**: Structured logging
- **zod**: Configuration validation

### Planned Dependencies
- Search API client libraries (Google, Bing, or alternatives)
- Redis client for result caching
- PostgreSQL client for persistent storage
- Rate limiting middleware

## Configuration

### Current Configuration
```bash
NODE_ENV=development
PORT=8080
LOG_LEVEL=info
SERVICE_NAME=websearch
```

### Planned Configuration
```bash
# Search provider configuration
SEARCH_PROVIDER=google  # google, bing, or custom
SEARCH_API_KEY=your-api-key
SEARCH_API_ENDPOINT=https://api.example.com

# Caching
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=3600

# Rate limiting
MAX_SEARCHES_PER_MINUTE=10
```

## Deployment Notes

This service is not yet ready for production deployment. Current deployment capabilities:
- ✅ Docker build process configured
- ✅ GitHub Actions CI/CD pipeline
- ✅ Azure Container Registry integration
- ❌ Search functionality not implemented
- ❌ No production-ready search provider integration

## Version and Maturity

- **Current Version**: 0.1.0
- **Status**: Template Stage - Foundation Only
- **Node.js Version**: 20+ required
- **License**: MIT

### Development Roadmap
- 📋 Phase 1: Search provider client implementation
- 📋 Phase 2: API endpoint development and result formatting
- 📋 Phase 3: Caching and performance optimization
- 📋 Phase 4: Rate limiting and quota management
- 📋 Phase 5: Integration testing with FireFoundry agents
- 📋 Phase 6: Production deployment

## Repository

**Source Code**: [ff-services-websearch](https://github.com/firebrandanalytics/ff-services-websearch) (private)

## Related Documentation

- **[Context Service](./context-service.md)**: Working memory for storing search results
- **[Platform Services Overview](../README.md)**: FireFoundry microservices architecture
- **[Service Template](./service-template.md)**: Template used to scaffold this service

## Notes for Developers

This service is currently a placeholder for future web search capabilities. If you're looking to implement web search functionality:

1. **Choose a Search Provider**: Evaluate Google Custom Search API, Bing Web Search API, or alternatives
2. **Implement SearchProvider**: Create business logic in `src/providers/SearchProvider.ts`
3. **Define API Endpoints**: Add routes in `src/routes/RouteManager.ts`
4. **Add Caching**: Implement result caching to reduce API costs
5. **Handle Rate Limits**: Implement quota management for search APIs
6. **Test Integration**: Verify integration with FireFoundry agents and Context Service
