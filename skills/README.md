# FireFoundry AI Assistant Skills

AI assistant skills that help developers work with the FireFoundry platform. These skills provide context and tooling knowledge to AI coding assistants like Claude Code and Cursor, enabling them to help you build, deploy, and debug FireFoundry agent bundles.

## Available Skills

### Essential (Start Here)

| Skill | Description |
|-------|-------------|
| **ff-cli** | CLI commands for project creation, building Docker images, and deploying to Kubernetes |
| **ff-local-dev** | Setting up your local FireFoundry development environment from scratch |
| **ff-agent-sdk** | Writing TypeScript code with the FireFoundry Agent SDK (entities, bots, workflows) |

### Development Workflows

| Skill | Description |
|-------|-------------|
| **ff-create-bundle** | Scaffold and implement a FireFoundry agent bundle (SDK v4) |
| **ff-add-bot** | Add a bot with prompt templates to an existing agent bundle (SDK v4) |
| **ff-add-entity** | Add a domain entity to an existing agent bundle (SDK v4) |
| **ff-deploy-local** | Build, deploy, and verify an agent bundle on local minikube |
| **ff-setup-cluster** | Bootstrap a local FireFoundry cluster from scratch |

### Debugging

| Skill | Description |
|-------|-------------|
| **ff-eg-read** | Querying and exploring the entity graph for debugging and analysis |
| **ff-diagnostics** | Orchestrating diagnostic workflows across entity graph, telemetry, and logs |
| **ff-telemetry-read** | Reading request telemetry for tracing broker requests, LLM calls, and tool invocations |

## Installation

### Automated

The installer detects your AI tools and installs skills appropriately:

```bash
bash install.sh
```

Options:

| Flag | Description |
|------|-------------|
| `--claude-only` | Install only for Claude Code |
| `--cursor-only` | Install only for Cursor |
| `--project-dir <path>` | Cursor project directory (defaults to current directory) |
| `--uninstall` | Remove previously installed skills |

### Manual: Claude Code

Claude Code reads skills from `~/.claude/skills/<name>/SKILL.md`. Copy each skill directory:

```bash
mkdir -p ~/.claude/skills
cp -r ff-cli ~/.claude/skills/
cp -r ff-local-dev ~/.claude/skills/
cp -r ff-agent-sdk ~/.claude/skills/
cp -r ff-create-bundle ~/.claude/skills/
cp -r ff-add-bot ~/.claude/skills/
cp -r ff-add-entity ~/.claude/skills/
cp -r ff-deploy-local ~/.claude/skills/
cp -r ff-setup-cluster ~/.claude/skills/
cp -r ff-eg-read ~/.claude/skills/
cp -r ff-diagnostics ~/.claude/skills/
cp -r ff-telemetry-read ~/.claude/skills/
```

Skills with `modes/` subdirectories (ff-eg-read, ff-diagnostics, ff-telemetry-read) will have their modes copied automatically.

### Manual: Cursor

Cursor reads rules from `.cursor/rules/*.mdc` files in your project directory. For each skill, create a `.mdc` file with the following format:

```
---
description: <description from SKILL.md frontmatter>
globs:
alwaysApply: false
---
<content of SKILL.md after the frontmatter>
```

For example, to install ff-cli:

1. Create `.cursor/rules/` in your project if it doesn't exist
2. Create `.cursor/rules/ff-cli.mdc`
3. Copy the `description` from the SKILL.md YAML frontmatter into the .mdc frontmatter
4. Copy the rest of the SKILL.md content (after the closing `---`) as the body

The `install.sh` script automates this conversion.

## Skill Structure

Each skill directory contains:

- `SKILL.md` - The main skill file with YAML frontmatter and markdown content
- `modes/` (optional) - Additional context files that the skill can reference for deeper topics

## More Information

See the [platform documentation](../docs/) for full FireFoundry reference material.
