# Skills Commands

`ff-cli skills` has two groups of subcommands:

- **Coding-assistant skills** (`install`, `list`, `uninstall`): installs the FireFoundry skills that ship inside `ff-cli` into Claude Code or Cursor on your machine, so your coding assistant knows how to scaffold, deploy, and debug FireFoundry bundles.
- **Skills Service commands** (`svc-list`, `svc-read`, `svc-files`, `svc-read-file`): read skills from your environment's [Skills Service](../firefoundry/platform/services/skills-service/README.md) as a given application sees them. Use them to check what your agents will get.

The Skills Service commands are read-only. To create, version, activate, or grant skills, use the FF Console, or the Skills Service [admin API](../firefoundry/platform/services/skills-service/reference.md#admin-api-admin) for automation.

## Coding-Assistant Skills

```bash
ff-cli skills list                 # skills embedded in this ff-cli version
ff-cli skills install              # Claude Code (~/.claude/skills/), plus Cursor if ~/.cursor/ exists
ff-cli skills install --claude     # Claude Code only
ff-cli skills install --cursor     # Cursor only (~/.cursor/skills/)
ff-cli skills uninstall            # remove from both
ff-cli skills uninstall --claude   # remove from Claude Code only
```

Re-run `install` after upgrading `ff-cli` to pick up updated skills.

## Skills Service Commands

### Connecting

| Setting | Flag / variable | Notes |
|---------|-----------------|-------|
| Service URL | `--service-url <url>` or `SKILLS_SERVICE_URL` | Required. The service is cluster-internal, so port-forward it for local use. |
| Caller identity | `FF_ON_BEHALF_OF` | Sent as the `X-On-Behalf-Of` header, e.g. `app=<application-id>; bundle=<bundle-id>`. Without it the service returns no skills. |

```bash
ff-cli port-forward firefoundry-core-skills-service 8080:8080 -n <namespace>
export SKILLS_SERVICE_URL=http://localhost:8080
export FF_ON_BEHALF_OF="app=<application-id>; bundle=<bundle-id>"
```

Results reflect that application's access grants, just like an agent's `skills_list` call through the MCP Gateway.

### Commands

| Command | What it does |
|---------|--------------|
| `ff-cli skills svc-list [--tags a,b] [--name 'pattern*']` | List visible skills (name, description, tags). `--tags` requires all tags; `--name` is a glob. |
| `ff-cli skills svc-read <name>` | Print a skill's name, description, tags, version, and `SKILL.md` content (latest version) |
| `ff-cli skills svc-files <name>` | List the files in a skill |
| `ff-cli skills svc-read-file <name> <path>` | Print one file, e.g. `references/routing.md` or `modes/review.md` |

```bash
ff-cli skills svc-list --tags support
ff-cli skills svc-read ticket-triage
ff-cli skills svc-read-file ticket-triage references/routing.md
```

`svc-files` expects a different response format than the current Skills Service returns and can fail with `failed to parse files list response`. Until that is fixed, call the service's [files endpoint](../firefoundry/platform/services/skills-service/reference.md#get-v1skillsnamefiles) directly, or read known paths with `svc-read-file`.

## Related

- [Skills Service](../firefoundry/platform/services/skills-service/README.md): managing skills, grants, and the API
- [Skills in Agent Bundles](../firefoundry/sdk/agent_sdk/feature_guides/skills.md): how agents load skills and how they can update them
