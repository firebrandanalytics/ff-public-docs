# FireFoundry Local Development

This directory contains guides for setting up and running FireFoundry on your local machine.

## Quick Start

Follow the **[Getting Started Guide](./getting-started.md)** for a complete walkthrough from zero to a working FireFoundry environment.

## What You'll Set Up

1. **Local Kubernetes** - Minikube cluster with adequate resources
2. **Control Plane** - Infrastructure services (Kong, Flux, Helm API, Console)
3. **Environment** - AI services (FF Broker, Context Service, Code Sandbox, Entity Service)
4. **Agent Bundle** - Your first custom agent

## Prerequisites Summary

- Docker Desktop
- Minikube
- kubectl, helm
- FireFoundry license (`~/.ff/license.jwt`)
- 8GB RAM, 4 CPU cores, 40GB disk

## Key Commands

```bash
# Initialize cluster with license
ff-cli cluster init --license ~/.ff/license.jwt

# Install control plane
ff-cli cluster install --self-serve --license ~/.ff/license.jwt --cluster-type local -y

# Create environment
ff-cli env create -t minimal-self-contained -n ff-dev -y

# Add LLM API key
ff-cli env broker-secret add ff-dev --key OPENAI_API_KEY --value "sk-..." -y
```

## Guides

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Complete setup from zero to working environment |

## Architecture

FireFoundry uses a two-tier architecture:

```
┌─────────────────────────────────────────────────────────┐
│                  Control Plane                          │
│              (ff-control-plane namespace)               │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  Kong   │ │  Flux   │ │ Helm API │ │ FF Console  │  │
│  │ Gateway │ │ Ctrl    │ │          │ │             │  │
│  └─────────┘ └─────────┘ └──────────┘ └─────────────┘  │
│              ┌────────────────────┐                     │
│              │    PostgreSQL      │                     │
│              └────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Manages
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Environment                          │
│                  (ff-dev namespace)                     │
│  ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌────────────┐  │
│  │FF Broker │ │ Context │ │ Code     │ │  Entity    │  │
│  │          │ │ Service │ │ Sandbox  │ │  Service   │  │
│  └──────────┘ └─────────┘ └──────────┘ └────────────┘  │
│  ┌────────────────────┐  ┌────────────────────┐        │
│  │    PostgreSQL      │  │       MinIO        │        │
│  └────────────────────┘  └────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## Getting Help

- Check pod logs: `kubectl logs -n <namespace> <pod-name>`
- Firebrand Support: support@firebrand.ai
