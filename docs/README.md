# Firebrand Analytics Developer Documentation

Welcome to the Firebrand Analytics technical documentation. This documentation covers our enterprise AI platform offerings and SDKs.

## About Firebrand Analytics

Firebrand Analytics provides enterprise AI platforms and applications that help organizations build, deploy, and operate sophisticated GenAI solutions.

## Product Offerings

### FireFoundry

**An Agent-as-a-Service platform for building sophisticated GenAI applications**

FireFoundry is a batteries-included platform that combines opinionated runtime services, developer tooling, and a management console. It enables teams to ship faster by providing built-in persistence, observability, deployment, and streaming capabilities.

- [FireFoundry Documentation](./firefoundry/README.md)
- [Getting Started with FireFoundry](./firefoundry/getting-started/README.md)
- [AgentSDK](./firefoundry/sdk/agent_sdk/README.md)
- [FF SDK](./firefoundry/sdk/ff_sdk/README.md)

**Key Features:**
- Zero-code persistence via entity graph
- Built-in observability and monitoring
- Secure code execution sandbox
- Agent bundle deployment and lifecycle management
- Human-in-the-loop workflows (Waitables)
- Testing framework with LLM-as-validator

### FireIQ Suite

**AI-powered data analysis and conversational data access applications built on FireFoundry**

The FireIQ Suite provides enterprise tools for preparing datasets and enabling natural language data access. It consists of applications for data ingestion, cleansing, analysis, and a chat interface for conversational data queries.

- [FireIQ Documentation](./fireiq/README.md)
- [Getting Started with FireIQ](./fireiq/getting-started/README.md)
- [Chat Application](./fireiq/chat-application/README.md)
- [Data Analysis Application](./fireiq/data-analysis-application/README.md)

**Key Features:**
- AI-assisted data preparation and cleansing
- Automated data dictionary and ontology generation
- Chat-with-your-data interface
- Customizable agent bundles per dataset
- Multi-dataset support with easy switching

## Getting Started

### For FireFoundry

If you're building custom GenAI applications and need a complete platform:

1. **[Getting Started Guide](./ff_local_dev/getting-started.md)** - Complete setup from zero to working environment
2. [Agent Development](./firefoundry/local-development/agent-development.md)
3. [AgentSDK Documentation](./firefoundry/sdk/agent_sdk/README.md)

### For FireIQ

If you want to enable conversational access to your data:

1. [Install FireFoundry](./firefoundry/getting-started/README.md) (required)
2. [FireIQ Prerequisites](./fireiq/getting-started/prerequisites.md)
3. [Install FireIQ](./fireiq/getting-started/installation.md)
4. [Prepare Your Data](./fireiq/data-analysis-application/data-preparation.md)

## Documentation Organization

```
docs/
├── ff_local_dev/         # Local development quick start (START HERE)
│   └── getting-started.md  # Zero to working environment
│
├── firefoundry/          # FireFoundry platform documentation
│   ├── getting-started/  # Prerequisites and concepts
│   ├── platform/         # Architecture and operations
│   ├── local-development/ # Development workflows
│   └── sdk/              # SDK documentation
│       ├── agent_sdk/    # Agent development SDK
│       ├── ff_sdk/       # Consumer integration SDK
│       └── utils/        # Utility libraries
│
└── fireiq/               # FireIQ Suite documentation
    ├── getting-started/  # Installation and setup
    ├── chat-application/ # Chat interface
    ├── data-analysis-application/ # Data preparation
    └── developer-guide/  # Custom bundle development
```

## Support & Resources

- [FireFoundry Troubleshooting](./firefoundry/local-development/troubleshooting.md)
- [FireFoundry Glossary](./firefoundry/README.md#appendices)

## Contributing

For information about contributing to this documentation, see CONTRIBUTING.md in the repository root.
