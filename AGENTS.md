# FireFoundry AI Assistant Skills

FireFoundry is an AI agent development platform for building, deploying, and operating domain-specific AI applications. These skills help AI assistants (Claude Code, Cursor, etc.) help you build, deploy, and debug FireFoundry agent bundles.

## Available Skills

### Essential (Start Here)
- **ff-cli** -- CLI commands for project creation, building, and deploying agent bundles
- **ff-local-dev** -- Setting up your local FireFoundry development environment
- **ff-agent-sdk** -- Writing TypeScript code with the FireFoundry Agent SDK

### Development Workflows
- **ff-create-bundle** -- Scaffold and implement a FireFoundry agent bundle (SDK v4)
- **ff-add-bot** -- Add a bot with prompt templates to an existing agent bundle (SDK v4)
- **ff-add-entity** -- Add a domain entity to an existing agent bundle (SDK v4)
- **ff-deploy-local** -- Build, deploy, and verify an agent bundle on local minikube
- **ff-setup-cluster** -- Bootstrap a local FireFoundry cluster from scratch

### Debugging
- **ff-eg-read** -- Querying and exploring the entity graph
- **ff-diagnostics** -- Orchestrating diagnostic workflows across systems
- **ff-telemetry-read** -- Reading request telemetry for debugging

## Installation

Run the installer:
```bash
cd skills && bash install.sh
```

Or see [skills/README.md](skills/README.md) for manual installation.

## Skill Files

All skills are in the [skills/](skills/) directory:

| Skill | Path | Modes |
|-------|------|-------|
| ff-cli | `skills/ff-cli/SKILL.md` | -- |
| ff-local-dev | `skills/ff-local-dev/SKILL.md` | -- |
| ff-agent-sdk | `skills/ff-agent-sdk/SKILL.md` | -- |
| ff-create-bundle | `skills/ff-create-bundle/SKILL.md` | -- |
| ff-add-bot | `skills/ff-add-bot/SKILL.md` | -- |
| ff-add-entity | `skills/ff-add-entity/SKILL.md` | -- |
| ff-deploy-local | `skills/ff-deploy-local/SKILL.md` | -- |
| ff-setup-cluster | `skills/ff-setup-cluster/SKILL.md` | -- |
| ff-eg-read | `skills/ff-eg-read/SKILL.md` | `modes/configuration.md` |
| ff-diagnostics | `skills/ff-diagnostics/SKILL.md` | 9 mode files (entity-graph, telemetry, logs, cluster, etc.) |
| ff-telemetry-read | `skills/ff-telemetry-read/SKILL.md` | `modes/configuration.md` |

## Documentation

Full platform documentation is in the [docs/](docs/) directory.
