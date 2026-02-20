# FireFoundry Platform — Overview (Consolidated Revision)

**Scope:** This overview focuses on platform concepts and developer/operations workflows. Detailed security, compliance, and testing procedures are documented separately.

## Executive Summary

FireFoundry is an **Agent-as-a-Service** platform for enterprises that need to build, deploy, and operate sophisticated GenAI applications. It combines **opinionated runtime services** (Broker, Context Service, Code Sandbox, Entity Service, Document Processing), **developer tooling** (AgentSDK, ff-cli, testing), and a **Management Console** into a single, batteries‑included stack. Teams ship faster because persistence, observability, deployment, and streaming are built‑in—not bolted on. Developers write agents; operations teams get standard Kubernetes‑native controls; consumers integrate via the **FF SDK** and stable **REST**/**WebSockets** interfaces (with **MCP** and **A2A** planned). Internally, platform services communicate over **gRPC**.

---

## 1. What is FireFoundry?

### 1.1 Conceptual Overview

FireFoundry provides a complete platform suite where infrastructure, development tools, runtime services, and client libraries work together. The platform is intentionally opinionated and **batteries‑included** to reduce integration complexity and accelerate delivery.

It is optimized for enterprise environments where AI applications must meet requirements for reliability, observability, and scale. While usable for simple applications, FireFoundry particularly shines with multi‑step reasoning, complex data integration, and coordinated AI workflows.

### 1.2 What is it Technically?

FireFoundry consists of seven major technical components:

* **Infrastructure as Code**: Terraform modules provision Kubernetes clusters and cloud dependencies for automated setup and configuration management.
* **ff-cli**: Command‑line tool for creating, packaging, deploying, and managing agent bundles; on a path toward full platform lifecycle management.
* **Kubernetes Platform**: Microservices runtime hosting specialized AI services—**Broker** (model routing), **Context Service** (working memory/persistence), **Code Sandbox** (secure code execution), **Entity Service** (graph management/vector search), **Document Processing** (extraction/generation)—plus supporting infrastructure including Kong Gateway and PostgreSQL.
* **AgentSDK**: Development framework for building agent bundles with zero‑code persistence via an entity graph and structured AI behavior.
* **FF SDK**: Client library for external systems consuming deployed agents and platform services over **REST** and **WebSockets**. (**gRPC is internal‑only.** **MCP** and **A2A** are planned.)
* **Testing Framework (LLM‑as‑Validator)**: GenAI‑aware testing using AI validators to evaluate semantic correctness, with integrated test management and analysis.
* **Management Console**: Web UI for environment management, agent lifecycle control, observability, and testing—including one‑click **Continue in Playground** and **Mock Cache** management.

#### Protocol & Interface Matrix

| Surface                     | Purpose                           | Protocols        | Status  |
| --------------------------- | --------------------------------- | ---------------- | ------- |
| Internal service‑to‑service | Broker, Context, Sandbox, bundles | **gRPC**         | GA      |
| External client‑to‑platform | API calls to bundles/platform     | **REST**         | GA      |
| External streaming          | Progress & event streaming        | **WebSockets**   | GA      |
| Extensibility               | External tooling/interop          | **MCP**, **A2A** | Planned |

*Note: Context Service uses MCP internally for AI agent interfaces (GA), but MCP as an external-facing extensibility protocol is planned.*

### 1.3 Why This Approach?

* **Zero‑Code Persistence**: The **entity graph** provides ORM‑like capabilities tuned for AI applications. Developers model the business domain; the platform persists state automatically.
* **Complexity Reduction**: Interdependent, opinionated components reduce configuration and integration error classes.
* **Enterprise‑Ready from Day One**: Built‑in observability, scaling, error handling, and operational tooling minimize the gap from prototype to production.
* **AI‑First Design**: Components address non‑deterministic outputs, multi‑step reasoning, and debugging/validation.
* **Human‑in‑the‑Loop via Waitables**: **Waitables** pause workflows for human input and then resume deterministically. Built on the entity graph.
* **Real‑Time Progress Streaming**: Progress updates propagate end‑to‑end and are streamed to clients over **WebSockets**. Each update has a unique ID and is persisted per entity to support reconnection, replay, and deduplication.
* **Observability**: Distributed tracing and breadcrumbs map activity across services and entities, enabling targeted drill‑downs and AI‑assisted diagnostics.
* **Reproducibility & Cost Control**: **Mock Cache** saves Broker request/response pairs; runs can bind to a cache to bypass live LLM calls, simulate outcomes/errors, and enable deterministic tests (Copy‑on‑Write edits).
* **Integrated Playground**: From any Broker log, **Continue in Playground** launches an interactive session with exact prompt, context, and history for faster investigation.
* **Advanced Prompting Framework**: Treats prompts as first‑class code with typing and composition patterns. Conditional prompting supports future data validation capabilities.

---

## 2. How It All Works Together

### 2.1 Platform Lifecycles

FireFoundry supports installation and bootstrap, service configuration, agent bundle lifecycle, and consumer integration—each with clear tooling pathways.

### 2.2 Agent Bundle Architecture

Agent bundles are the core deployment unit—containerized collections of agents and workflows running in a shared process for low‑latency coordination.

* **Entities & Invocation**: In FireFoundry, **agents** and **workflows** are **entities** in the graph and can have behavior. You can invoke a **specific entity** by **Entity ID** to execute logic in that node’s context (read attributes, traverse relationships). Bundles can also expose **ID‑less APIs** for bootstrapping when no natural starting entity exists.
* **Isolation & Composition**: The bundle is the primary isolation boundary; a misbehaving agent impacts its bundle but not others. Cross‑bundle calls use efficient internal **gRPC** with Kubernetes DNS for discovery. We encourage specialized bundles and mono‑repo development for related bundle collections.
* **API Exposure**: Entities and orchestration endpoints are exposed through the **Kong Gateway**, with flexible policies for internal vs external consumers.

---

## 3. Core Platform Components

### 3.1 Kubernetes Runtime Platform

**Core Runtime Services**

* **Broker Service**: Intelligent router for AI model interactions with multi-provider support, cost-based selection, automatic failover, and streaming.
* **Context Service**: Working memory and context API. **All metadata/state persists in PostgreSQL**; **binary artifacts associated with working memory** are stored in **blob storage**.
* **Code Sandbox**: Secure execution of AI‑generated code. **One sandbox per environment** (each environment maps to a Kubernetes **namespace**). Supports **TypeScript** today; **Python** planned. **Secrets are handled via KeyVault** and **not directly exposed** to AI‑generated code; the sandbox establishes connections and provides pre‑authorized handles when appropriate. **Egress whitelisting** is planned. Resource limits rely on Kubernetes. The sandbox does **not** guarantee idempotency; most use is **read‑only**, and **consumers must handle retries/failures**.

**Extended Services**

* **Entity Service**: Entity graph management with pgvector-based semantic search and vector similarity matching for knowledge retrieval.
* **Document Processing Service**: Unified document processing (extraction, generation, transformation) with Azure Document Intelligence integration.

**Platform Infrastructure**

* **Kong Gateway**: API management, security policy enforcement, and external exposure of agent/bundle capabilities.
* **PostgreSQL** is the primary store for the **entity graph** and platform metadata (initiative underway to host inside the cluster). Additional infrastructure includes blob storage, application‑aware monitoring, and auto‑scaling via Kubernetes HPA.

**Persistence Model**

* Platform entities—including **agents**, **workflows**, **runnables**, **waitables**, and **progress**—persist to **PostgreSQL**. Working‑memory binaries reside in **blob storage**.

### 3.2 AgentSDK (Agent Development Framework)

* **Entity System**: Zero‑code persistence via a graph of business objects; relationships are first‑class and maintained automatically.
* **Runnable & Waitable Entities**: **Runnables** represent single invocations of resumable computations; the **Entity ID is the idempotency key**. Re‑running either resumes from the last checkpoint or returns the existing result if complete. **Waitables** are specialized runnables that pause for human input and then resume deterministically.
* **Bot System**: Stateless, reusable units of LLM‑powered computation (prompts + validation + error handling) with built‑in retries and recovery.
* **Working Memory**: Seamless read/write of context across workflows.
* **Tool Integration**: Function calling to interact with external systems.
* **Job Scheduling**: Background processing and workflow orchestration.

### 3.3 FF SDK (Consumer Integration Library)

* **Purpose**: External systems integrate with deployed agents and platform services via **REST** and **WebSockets** (for streaming/progress). **gRPC is internal‑only.**
* **Design**: Thin, language‑agnostic clients with standardized error handling and integration patterns. **MCP** and **A2A** are planned.

### 3.4 ff‑cli (Command Line Interface)

* Packages and deploys agent bundles; integrates with CI/CD. Roadmap toward kubectl‑like full platform lifecycle management.

### 3.5 Testing Framework (LLM‑as‑Validator)

* AI validators assess semantic correctness for non‑deterministic systems. Integrated agent bundle and Console interface provide test authoring, execution, and results analysis (stored in the entity graph). Use **Mock Cache** to bypass live LLM calls for speed, cost control, and reproducibility.

### 3.6 Management Console

* Central interface for platform administration: environment management, bundle lifecycle control, observability, and testing. Includes **Continue in Playground** for one‑click reproduction of Broker interactions and **Mock Cache** management for deterministic runs.

### 3.7 Platform Services (Comprehensive Microservices)

FireFoundry provides a collection of specialized microservices that work together to enable sophisticated AI applications. Services are organized by maturity level:

**Tier 1 - Core Runtime (GA - Production Ready)**
* **[Broker Service](./platform/services/ff-broker.md)** (v5.2.7): Intelligent AI model routing with multi-provider support, cost-based selection, and automatic failover.
* **[Context Service](./platform/services/context-service/README.md)** (v2.0.0): Working memory and blob storage with multi-cloud support (Azure, Google Cloud) and MCP integration.
* **[Code Sandbox](./platform/services/code-sandbox.md)** (v2.0.0): Secure code execution environment with ODBC connectivity, Chart.js visualization, and DataFrame processing.

**Tier 2 - Extended Services (Beta)**
* **[Entity Service](./platform/services/entity-service.md)** (v0.3.0-beta.0): Entity graph management with pgvector-based semantic search and vector similarity matching.
* **[Document Processing Service](./platform/services/doc-proc-service.md)** (v0.1.10): Unified document processing (extraction, generation, transformation) with Azure Document Intelligence integration.

**Tier 3 - Emerging Services (Planning/Early Development)**
* **[Document Processing Python Worker](./platform/services/doc-proc-pyworker.md)** (Planning): Advanced ML-based document processing with local OCR and complex table extraction.
* **[Web Search Service](./platform/services/web-search.md)** (Planning): Web search capabilities for agent workflows.

**See [Platform Services Overview](./platform/services/README.md)** for detailed architecture, service communication patterns, data flows, configuration, deployment, monitoring, and troubleshooting guidance.

---

## 4. Application & Integration Patterns

### 4.1 Development Lifecycle

* **Local Development**: Build agent logic with the AgentSDK in a standard Node.js toolchain (hot‑reload, debugger).
* **High‑Fidelity Environment**: Run the platform locally via **Minikube**. A common pattern is running bundle code locally while using Kubernetes port‑forwarding to connect to core services (Broker, Context) in Minikube.
* **Entity Modeling & Behavior**: Define business objects in the entity system; implement AI logic with the Bot System.
* **Testing & Validation**: Use the Testing Framework and **Mock Cache** for deterministic paths and error simulation.
* **Deployment**: Package with **ff‑cli** and deploy to target environments; integrate with CI/CD.

### 4.2 Platform Operations

* **Infrastructure Management**: Terraform automates Kubernetes clusters and dependencies.
* **Service Configuration**: Use the Management Console for provider connections, database settings, and API gateway policies.
* **Monitoring & Observability**: Application‑aware monitoring with entity‑level tracking and distributed tracing; exportable to enterprise stacks.

### 4.3 Key Integration Points

* **Consuming AI Services**: External systems integrate via the **FF SDK** over REST/WebSockets.
* **Data Connectivity**: Agents access enterprise systems (e.g., PostgreSQL, Databricks) through the **Code Sandbox**, which enforces access control and auditability.
* **AI Model Ecosystem**: The **Broker** unifies access to providers (e.g., OpenAI, Anthropic, Google) with cost and resiliency policies.
* **Enterprise Identity & Networking**: Integrates with **OpenID Connect** identity providers for single sign‑on. Secure connectivity to internal systems follows enterprise networking patterns; details live outside this overview.

---

## 5. Current State & Vision

### 5.1 Production‑Ready Components

Core platform (Kubernetes runtime and services), **AgentSDK**, **FF SDK**, **Management Console**, and infrastructure components (Terraform, Helm) are production‑ready and validated in enterprise deployments.

### 5.2 Active Development Areas

Cloud independence (moving dependencies into Kubernetes), expanded **ff‑cli** capabilities, multi‑cloud support, and performance optimizations.

### 5.3 Future Capabilities

On‑premises and hybrid deployments, a broader ecosystem of AI providers/protocols (including **MCP** and **A2A**), and advanced agent orchestration.

---

## 6. Use Cases & Applications

### 6.1 Target Applications

Complex multi‑step AI workflows, enterprise data analysis, agentic automation of business processes, and API‑driven AI services.

### 6.2 Reference Implementation: FinanceIQ

A reference app for natural‑language financial analysis that demonstrates multi‑agent coordination, secure data processing in the **Code Sandbox**, and enterprise integration patterns.

---

## 7. Platform Comparison Context

### 7.1 Versus Framework‑Only Approaches

Compared to tools like LangChain, FireFoundry is a complete, integrated platform with built‑in persistence, deployment, and observability—reducing integration effort and time‑to‑value.

### 7.2 Versus Cloud AI Platforms

General cloud AI services are broad; FireFoundry focuses on sophisticated, agent‑based applications with enterprise requirements (compliance, auditability, advanced error handling).

---

## Appendices

### A. Technical Specifications (at a glance)

* Kubernetes version/support matrix, cluster sizing guidance, network configuration, resource planning per component. Details are in the installation docs.

### B. Getting Started Resources

* **Installation Guide**: Terraform for infrastructure, Helm for services, **ff‑cli** for bundle management. Includes local setup via **Minikube**.
* **Quick Start Tutorial**: Build and deploy a simple agent bundle; integrate via the **FF SDK**.
* **Example Applications**: Reference implementations (e.g., **FinanceIQ**) with best practices.
* **Best Practices**: Entity modeling patterns, bot implementation, testing methods, deployment workflows, and efficient local development.

### C. Glossary

* **Entity Graph**: Persistent graph of business objects and relationships.
* **Entity**: A node in the graph (e.g., agent, workflow, runnable, waitable); can have behavior.
* **Runnable**: Entity representing a single invocation of a resumable computation; **Entity ID = idempotency key**.
* **Waitable**: Runnable that pauses for human input and resumes deterministically.
* **Bot**: Stateless, reusable unit of LLM‑powered computation (prompts + validation + error handling).
* **Broker**: Model routing and interaction service.
* **Context Service**: Working memory/persistence API (metadata in PostgreSQL; binaries in blob storage).
* **Code Sandbox**: Isolated execution for AI‑generated code; per‑environment namespace.
* **FF SDK**: External client library over REST/WebSockets (streaming); **gRPC internal‑only**.
* **ff‑cli**: Packaging/deployment tool for agent bundles.
* **Management Console**: Web UI for operations, observability, testing, and developer experience features.
