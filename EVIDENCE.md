# Evidence — WS#22 Documentation (Session 991150)

## What was done

### Primary deliverable

Created `docs/firefoundry/sdk/agent_sdk/dsl/examples/xml-dsl-demo.md` — the guided tour document specified by the DESIGN.md in `/workspace/context/ws22-xml-dsl-demo-DESIGN.md`.

The document is a **5-part guided tour** (+ Part 6 optional) of the XML DSL Content Analyzer demo bundle:
- Part 1: Run It, See It, Believe It — quick start with Docker + curl
- Part 2: The Bundle Manifest: BundleML — annotated walkthrough of `bundle.bundleml`
- Part 3: The Workflow: AgentML — traced execution sequence of `analysis-workflow.agentml`
- Part 4: The Bot and Its Prompt: BotML + PromptML — bot configuration, inline prompt, `input.*` vs `args.*`
- Part 5: Ship It — xml-bundle-server fleet model, ConfigMap deployment, Helm chart
- Part 6: Fork It — how to adapt the demo to a new use case

Content sourced entirely from the DESIGN.md in `/workspace/context/` as specified by the design instructions. No source repos were read.

### Secondary deliverables (bugs fixed)

1. **Broken validation library links in `agent_sdk/README.md`** — three links pointed to `../utils/validation-library-*.md` but the actual files are at `../utils/validation/validation-library-*.md`. Fixed all three.

2. **Dead link in `feature_guides/README.md`** — removed link to `uploading_files_example.md` which does not exist in the repository.

3. **Updated `dsl/examples/README.md`** — added entry for the new xml-dsl-demo.md with architecture diagram.

4. **Updated `agent_sdk/README.md`** — added link to xml-dsl-demo.md under the XML DSL section.

## Files changed

| File | Change |
|------|--------|
| `docs/firefoundry/sdk/agent_sdk/dsl/examples/xml-dsl-demo.md` | **Created** — primary deliverable (541 lines) |
| `docs/firefoundry/sdk/agent_sdk/README.md` | Fixed 3 broken links + added xml-dsl-demo reference |
| `docs/firefoundry/sdk/agent_sdk/dsl/examples/README.md` | Added xml-dsl-demo entry with architecture diagram |
| `docs/firefoundry/sdk/agent_sdk/feature_guides/README.md` | Removed dead link to uploading_files_example.md |

## Commit

```
d547a67 docs(dsl): add XML DSL Content Analyzer guided tour and fix broken links
```

Branch: `ws22/991150`  
Pushed: `origin/ws22/991150`

## Verify the key result

```bash
# Check the new file exists and has expected content
wc -l docs/firefoundry/sdk/agent_sdk/dsl/examples/xml-dsl-demo.md
grep "^## Part" docs/firefoundry/sdk/agent_sdk/dsl/examples/xml-dsl-demo.md

# Verify broken links are fixed
grep "validation/" docs/firefoundry/sdk/agent_sdk/README.md | grep "utils"

# Verify examples README was updated
grep "xml-dsl-demo" docs/firefoundry/sdk/agent_sdk/dsl/examples/README.md
```

## Known gaps

- The document is based entirely on the DESIGN.md; the actual deployed demo application was not verified to be running (no FF environment available in this worker).
- The `xml-dsl-bundle` and `xml-dsl-gui` apps are in `ff-demo-apps` (separate repo, not provisioned here); this PR covers only the `ff-public-docs` side.
- Part 4 references `analyzer-prompt.promptml` with a note that it's not loaded at runtime; this matches the DESIGN.md invariant documented in Section 7.
