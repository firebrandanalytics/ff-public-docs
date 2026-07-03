# EVIDENCE.md — WS#22 Session 991150 (P8 Implementation)

This file points the gate auditor at the commands, files, and verification steps that prove each functional requirement from `deliverables/03-requirements-specs.md`.

---

## R01 — Six tutorial files exist in the target directory

```bash
ls -1 docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/
```

Expected output:
```
README.md
part-01.md
part-02.md
part-03.md
part-04.md
part-05.md
```

Files: 6 (README + 5 parts). The `.gitkeep` placeholder from P7 has been replaced by real content.

---

## R02 — README follows Pattern 2 (Architecture Overview + Diagnostic Tools)

```bash
grep "^## " docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/README.md
```

Expected sections in order:
```
## What You'll Learn
## Prerequisites
## Tutorial Parts
## How to Use This Tutorial
## Architecture Overview
## Diagnostic Tools
## Source Code
```

Both `## Architecture Overview` and `## Diagnostic Tools` are present (required for the 5-part tier).

---

## R03 — Tutorial Parts table has exact column headers

```bash
grep "| Part | Title" docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/README.md
```

Expected:
```
| Part | Title | What You Build | Key Concepts |
```

---

## R04 — Minimum word counts per part

```bash
for f in docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-0*.md; do
  echo "$(wc -w < $f) $f"
done
```

Requirements: Part 1 ≥600, Part 2 ≥700, Part 3 ≥750, Part 4 ≥800, Part 5 ≥650.

---

## R05 — Zero TypeScript code blocks for bundle code

```bash
grep -c '```typescript' docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-0*.md
grep -c '```ts' docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-0*.md
```

Expected: all counts = 0. No TypeScript code blocks appear in any part file.

---

## R06 — At least one XML code block per part

```bash
for f in docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-0*.md; do
  echo "$(grep -c '^\`\`\`xml' $f) xml blocks in $f"
done
```

Expected: each part has ≥1 XML code block.

---

## R07 — Verifiable "Run and Verify" step in each part

Each part ends with a "Run and Verify" section that describes GUI or browser-based verification (AP-DOC-02 prohibits raw `curl` commands — zero hits required):

```bash
grep "^## Run and Verify" docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-0*.md
```

Expected: all 5 part files contain the heading. Verification uses the demo GUI at `http://localhost:4000` (for POST-based analysis) and browser-accessible GET endpoints (`/api/dsl-info`, `/api/latest-result`). Part 5 uses `kubectl rollout status` and port-forward.

```bash
# Confirm zero curl commands (AP-DOC-02 compliance)
grep -r 'curl' docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/ | wc -l
```

Expected: 0

---

## R08 — agent_sdk README updated with XML DSL Demo Tutorial link

```bash
grep "XML DSL Demo Tutorial" docs/firefoundry/sdk/agent_sdk/README.md
```

Expected:
```
- **[XML DSL Demo Tutorial](tutorials/xml-dsl-demo/README.md)** - Guided tour of the Content Analyzer demo...
```

---

## R09 — dsl/README.md updated with reference to tutorial

```bash
grep "XML DSL Demo Tutorial" docs/firefoundry/sdk/agent_sdk/dsl/README.md
```

Expected:
```
- **[XML DSL Demo Tutorial](../tutorials/xml-dsl-demo/README.md)** -- guided tour of the Content Analyzer demo bundle...
```

---

## R10 — All relative links resolve

```bash
# Spot-check: links in README point to files that exist
ls docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-01.md
ls docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-05.md
ls docs/firefoundry/sdk/agent_sdk/dsl/getting-started-tutorial.md
ls docs/firefoundry/sdk/agent_sdk/dsl/advanced-patterns-tutorial.md
ls docs/firefoundry/sdk/agent_sdk/dsl/reference/bundleml-reference.md
```

---

## Domain Policy Checks

**DP01 — `.promptml` not auto-loaded:**
```bash
grep -n "not auto-loaded\|not loaded at runtime\|NOT loaded\|NOT auto-load" \
  docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-04.md
```
Expected: 2+ matches confirming the constraint is stated.

**DP02 — CDATA context stated correctly (body/query/registry/logger, not request/bundle):**
```bash
grep -n "body.*query.*registry.*logger\|NOT available.*request\|NOT available.*bundle" \
  docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-02.md
```
Expected: matches in the CDATA context table.

**DP03 — `input.*` vs `args.*` distinction stated:**
```bash
grep -n "input\.\*\|input\.topic\|input\.\* vs" \
  docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-04.md | head -5
```
Expected: matches in Part 4 explaining the distinction.

**DP04 — Actual bundle API used (entity_factory, async response):**
```bash
grep -n "entity_factory\|status.*pending\|entity_id" \
  docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-02.md | head -5
```
Expected: matches for the actual API pattern (not DESIGN.md's synchronous `registry.createEntity()`).

**DP05 — Zero TypeScript bundle code blocks:**
See R05 above.

---

## NFR Checks

**NFR01 — Tour tone (not build-from-scratch):**
```bash
head -5 docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/README.md
```
Expected: first paragraph explicitly says "This is not a build-from-scratch tutorial."

**NFR02 — File names part-01.md through part-05.md (no slugs):**
```bash
ls docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/
```
Expected: `part-01.md`, `part-02.md`, ..., `part-05.md` — no slug suffixes.

**NFR03 — `# Part N: Title` heading format:**
```bash
grep "^# Part" docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-0*.md
```
Expected: each file has exactly one `# Part N: Title` heading.

**NFR05 — XML code blocks match actual bundle (model pool, API):**
```bash
# Model pool should be firebrand_completion_default (not firebrand-gpt-5.2-failover from DESIGN.md)
grep "firebrand_completion_default" docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-04.md

# Async API (entity_factory.create_entity_node) should appear in Part 2
grep "entity_factory" docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-02.md
```

---

## D10 — Unit Tests

A test suite is provided at `tests/check-xml-dsl-tutorials.sh`. It verifies 14 integrity properties of the tutorial files:

```bash
bash tests/check-xml-dsl-tutorials.sh
```

The suite covers:
- T01: All 6 files exist
- T02: No TypeScript code blocks (zero-TypeScript constraint)
- T03: At least one XML block per part
- T04: Zero curl commands (AP-DOC-02)
- T05: Zero internal hostnames (AP-DOC-03)
- T06: README has `What You'll Learn` heading
- T07–T08: README Architecture Overview + Diagnostic Tools sections
- T09: Parts table column headers
- T10–T11: Part 2 CDATA context table + entity_factory API
- T12: Part 4 correct model pool name
- T13: Part 4 documents promptml not auto-loaded
- T14: Part 1 uses env-var for LLM broker host

Expected: `All checks passed.` with exit code 0. All 27 assertions pass against the committed files.

---

## Git State

```bash
git log --oneline -5
git diff --stat HEAD~1 HEAD
```

The P8 commit covers:
- `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/README.md` (new)
- `docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo/part-01.md` through `part-05.md` (new)
- `docs/firefoundry/sdk/agent_sdk/README.md` (updated — XML DSL Demo Tutorial link added)
- `docs/firefoundry/sdk/agent_sdk/dsl/README.md` (updated — tutorial reference added)
- `EVIDENCE.md` (this file)
