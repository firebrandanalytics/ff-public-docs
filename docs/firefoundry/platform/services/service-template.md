# FireFoundry Service Template

## Overview

The FireFoundry Service Template is the official scaffolding tool for creating new microservices within the FireFoundry platform. It provides a production-ready foundation with TypeScript, Express 5, Docker containerization, CI/CD pipelines, and standardized development patterns.

## Purpose and Role

This template serves as the starting point for all new FireFoundry microservices, providing:
- **Consistent Structure**: Standardized project layout across all services
- **Best Practices**: Pre-configured tooling and patterns proven in production
- **Rapid Development**: Skip boilerplate setup and focus on business logic
- **Quality Assurance**: Built-in testing, linting, and CI/CD from day one
- **Production Readiness**: Security-hardened Docker images and Kubernetes integration

## Key Features

### Development Toolchain
- **TypeScript 5.x**: Strict type safety with ES2022 target
- **Express 5**: Modern web framework with Router-based routing
- **pnpm**: Fast, disk-efficient package management
- **Vitest**: Lightning-fast testing with coverage reports
- **ESLint**: TypeScript-aware linting with inline configuration
- **tsx**: Hot-reload development server
- **Husky**: Git hooks for pre-commit tests and pre-push validation

### Infrastructure Components
- **Multi-stage Dockerfile**: Optimized production images with security hardening
- **Health Endpoints**: `/health` (liveness), `/ready` (readiness), `/status` (metrics)
- **Graceful Shutdown**: SIGTERM/SIGINT handlers for container orchestration
- **Structured Logging**: ApplicationInsights integration via shared-utils
- **Non-root Container**: Security-first Docker configuration

### CI/CD Pipeline
- **GitHub Actions**: Automated build and deployment workflow
- **Branch-based Deployment**:
  - `main` branch → Production releases with semantic versioning
  - `dev` branch → Development releases with `-dev` suffix
- **Version Validation**: Pre-push hooks prevent duplicate version releases
- **Multi-tag Strategy**: Convenience tags (`latest`, `dev`) plus semantic versions
- **Azure Container Registry**: Direct integration with ACR

### Quality Assurance
- **Pre-commit Hook**: Runs tests before every commit
- **Pre-push Hook**: Validates version increment for main branch pushes
- **Type Checking**: Separate `typecheck` script for CI validation
- **Test Coverage**: Comprehensive coverage reports with Vitest + v8

## Standard Service Structure

```
firefoundry-service-template/
├── .github/workflows/
│   └── deploy.yml              # CI/CD pipeline
├── .husky/
│   ├── pre-commit              # Runs tests before commit
│   └── pre-push                # Validates version before push to main
├── scripts/
│   ├── build.sh                # Local Docker build script
│   ├── check-version.js        # Version validation logic
│   └── setup-service.sh        # Post-template setup script
├── src/
│   ├── __tests__/              # Vitest test files
│   │   ├── setup.ts            # Test environment configuration
│   │   └── *.test.ts           # Test files
│   ├── config/
│   │   └── index.ts            # Zod-validated configuration
│   ├── routes/
│   │   └── RouteManager.ts     # Centralized route definitions
│   ├── providers/
│   │   └── XxProvider.ts       # Business logic (renamed during setup)
│   ├── Service.ts              # Express application class
│   └── index.ts                # Entry point
├── .dockerignore               # Docker build optimization
├── .env.example                # Environment variable template
├── .gitignore                  # Git ignore patterns
├── .releaserc.json             # Semantic release configuration
├── Dockerfile                  # Multi-stage production build
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
└── vitest.config.ts            # Test configuration
```

## Getting Started with the Template

### Option 1: Use GitHub Template (Recommended)

1. Click "Use this template" on GitHub → "Create a new repository"
2. Name your repository (e.g., `ff-services-your-service`)
3. Clone your new repository locally
4. Run the setup script:
   ```bash
   ./scripts/setup-service.sh
   ```
5. Follow prompts to configure:
   - Service name (lowercase, hyphens)
   - Azure Container Registry name
   - Provider name (e.g., `Order`, `Payment`, `Auth`)
   - Service description

### Option 2: Clone Directly

1. Clone the template repository:
   ```bash
   git clone https://github.com/firebrandanalytics/firefoundry-service-template.git your-service
   cd your-service
   ```
2. Run setup script (will offer to clean .git history):
   ```bash
   ./scripts/setup-service.sh
   ```

### Post-Setup Steps

1. Install dependencies: `pnpm install`
2. Configure environment: `cp .env.example .env`
3. Verify setup: `pnpm test:run && pnpm build`
4. Start development: `pnpm dev`
5. Commit and push to GitHub
6. Configure GitHub Secrets:
   - `ACR_PASSWORD`: Azure Container Registry password
   - `NPM_TOKEN`: GitHub token with `read:packages` scope

## Development Patterns

### Provider Pattern
Business logic is encapsulated in provider classes:
- Located in `src/providers/`
- Injected into Service and RouteManager
- Testable in isolation
- Example: `OrderProvider`, `PaymentProvider`, `AuthProvider`

### Route Management
HTTP routes defined in `src/routes/RouteManager.ts`:
- Centralized route registration
- Middleware composition
- Request validation
- Response formatting
- Error handling with proper status codes

### Configuration Management
Environment variables validated with Zod in `src/config/index.ts`:
- Type-safe configuration
- Runtime validation
- Default values
- Clear error messages for misconfiguration

### Health Checks
Standard endpoints for Kubernetes:
- `GET /health`: Always returns 200 (liveness probe)
- `GET /ready`: Returns 200 when dependencies are ready (readiness probe)
- `GET /status`: Returns uptime and service metadata

### Logging
Structured logging via winston and ApplicationInsights:
- Log levels: error, warn, info, debug
- Contextual metadata
- Automatic correlation IDs
- Azure integration for production monitoring

## Development Workflow

### Daily Development
```bash
pnpm dev          # Start with hot reload
pnpm test         # Run tests in watch mode
pnpm typecheck    # Validate types
```

### Before Committing
Tests run automatically via pre-commit hook:
```bash
git commit -m "feat: add new feature"  # Runs tests first
```

### Before Releasing to Main
```bash
npm version patch|minor|major  # Increment version
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git push origin main  # Triggers production CI/CD
```

### Testing Docker Locally
```bash
./scripts/build.sh  # Build image
docker run -p 8080:8080 --env-file .env your-service:local
curl http://localhost:8080/health  # Verify
```

## Best Practices

### Service Development
- **Keep Providers Focused**: One provider per domain/feature area
- **Validate Early**: Use Zod schemas for request validation
- **Error Handling**: Use structured errors with appropriate HTTP status codes
- **Logging**: Log at entry/exit points with contextual data
- **Testing**: Test providers and routes separately for better isolation

### Configuration
- **Never Commit Secrets**: Use environment variables only
- **Validate Early**: Configuration validated at startup, fail fast
- **Document Variables**: Keep .env.example up to date
- **Use Defaults**: Provide sensible defaults where possible

### Docker and Deployment
- **Optimize Images**: Multi-stage builds, minimal base images
- **Security First**: Non-root user, minimal dependencies
- **Health Checks**: Implement /ready endpoint for external dependencies
- **Graceful Shutdown**: Close connections cleanly on SIGTERM

### Version Management
- **Semantic Versioning**: MAJOR.MINOR.PATCH
- **Always Increment**: Pre-push hook enforces this for main branch
- **Tag Strategy**: Git tags created automatically by CI/CD

## Repository

**Source Code**: [firefoundry-service-template](https://github.com/firebrandanalytics/firefoundry-service-template) (private)

## Related Documentation

- **[Platform Services Overview](../README.md)**: FireFoundry microservices architecture
- **[Context Service](./context-service.md)**: Example of a production service built from this template
- **[Broker Service](./ff-broker.md)**: Another service using these patterns

## Customization Points

After running setup, customize these areas:

1. **Business Logic** (`src/providers/{Your}Provider.ts`)
   - Core service functionality
   - Domain-specific operations
   - External API integrations

2. **HTTP Routes** (`src/routes/RouteManager.ts`)
   - Custom endpoints in `registerCustomRoutes()`
   - Request validation and response formatting
   - Middleware composition

3. **Configuration** (`src/config/index.ts`)
   - Service-specific environment variables
   - Extend Zod schema for validation
   - Add typed configuration exports

4. **Service Setup** (`src/Service.ts`)
   - Custom Express middleware
   - CORS, rate limiting, compression
   - Usually minimal changes needed

5. **Tests** (`src/__tests__/`)
   - Provider unit tests
   - Route integration tests
   - Follow existing Vitest patterns

## Version and Maturity

- **Current Version**: 0.1.0 (Template Version)
- **Status**: Production-Ready Template
- **Node.js Version**: 20+ required
- **License**: MIT
