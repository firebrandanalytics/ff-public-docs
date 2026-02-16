# FireFoundry AI Assistant Skills

FireFoundry is an AI agent development platform for building, deploying, and operating domain-specific AI applications. These skills help AI assistants (Claude Code, Cursor, etc.) help you build, deploy, and debug FireFoundry agent bundles.

## Available Skills

### Essential (Start Here)
- **ff-cli** -- CLI commands for project creation, building, and deploying agent bundles
- **ff-local-dev** -- Setting up your local FireFoundry development environment
- **ff-agent-sdk** -- Writing TypeScript code with the FireFoundry Agent SDK

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
| ff-eg-read | `skills/ff-eg-read/SKILL.md` | `modes/configuration.md` |
| ff-diagnostics | `skills/ff-diagnostics/SKILL.md` | 9 mode files (entity-graph, telemetry, logs, cluster, etc.) |
| ff-telemetry-read | `skills/ff-telemetry-read/SKILL.md` | `modes/configuration.md` |

## Documentation

Full platform documentation is in the [docs/](docs/) directory.
