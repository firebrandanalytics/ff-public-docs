#!/usr/bin/env bash
# Integrity checks for the xml-dsl-demo tutorial series.
# Run from the repo root: bash tests/check-xml-dsl-tutorials.sh

TUTORIAL_DIR="docs/firefoundry/sdk/agent_sdk/tutorials/xml-dsl-demo"
FAIL=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

check_file() {
  local f="$TUTORIAL_DIR/$1"
  [ -f "$f" ] && pass "File exists: $1" || fail "File missing: $1"
}

# T01 — All six tutorial files present
for f in README.md part-01.md part-02.md part-03.md part-04.md part-05.md; do
  check_file "$f"
done

# T02 — No TypeScript code blocks in any part file (AP-DSL-01: zero-TypeScript bundle)
for f in "$TUTORIAL_DIR"/part-0*.md; do
  if grep -qE '^\`\`\`(typescript|ts)$' "$f" 2>/dev/null; then
    fail "TypeScript blocks found: $(basename "$f")"
  else
    pass "No TypeScript blocks: $(basename "$f")"
  fi
done

# T03 — At least one XML code block per part file
for f in "$TUTORIAL_DIR"/part-0*.md; do
  if grep -q '^\`\`\`xml' "$f" 2>/dev/null; then
    pass "XML block present: $(basename "$f")"
  else
    fail "No XML block: $(basename "$f")"
  fi
done

# T04 — No curl commands anywhere (AP-DOC-02)
if grep -qr 'curl' "$TUTORIAL_DIR" 2>/dev/null; then
  hits=$(grep -r 'curl' "$TUTORIAL_DIR" 2>/dev/null | wc -l)
  fail "curl commands found: $hits hits (AP-DOC-02 violation)"
else
  pass "No curl commands (AP-DOC-02)"
fi

# T05 — No internal cluster hostnames (AP-DOC-03)
if grep -qr '\.internal' "$TUTORIAL_DIR" 2>/dev/null; then
  hits=$(grep -r '\.internal' "$TUTORIAL_DIR" 2>/dev/null | wc -l)
  fail "Internal hostnames found: $hits hits (AP-DOC-03 violation)"
else
  pass "No internal hostnames (AP-DOC-03)"
fi

# T06 — README has 'What You'll Learn' (exact required heading)
if grep -q "What You'll Learn" "$TUTORIAL_DIR/README.md"; then
  pass "README heading: 'What You'll Learn'"
else
  fail "README missing 'What You'll Learn'"
fi

# T07 — README has Architecture Overview section (Pattern 2 requirement)
if grep -q "^## Architecture Overview" "$TUTORIAL_DIR/README.md"; then
  pass "README has Architecture Overview"
else
  fail "README missing Architecture Overview"
fi

# T08 — README has Diagnostic Tools section (Pattern 2 requirement)
if grep -q "^## Diagnostic Tools" "$TUTORIAL_DIR/README.md"; then
  pass "README has Diagnostic Tools"
else
  fail "README missing Diagnostic Tools"
fi

# T09 — Tutorial parts table has required columns
if grep -q "| Part | Title | What You Build | Key Concepts |" "$TUTORIAL_DIR/README.md"; then
  pass "Parts table columns correct"
else
  fail "Parts table columns wrong or missing"
fi

# T10 — Part 2 CDATA context table documents body/query/registry/logger
if grep -q '`body`' "$TUTORIAL_DIR/part-02.md" && grep -q '`registry`' "$TUTORIAL_DIR/part-02.md" && grep -q '`logger`' "$TUTORIAL_DIR/part-02.md"; then
  pass "Part 2 CDATA context table present"
else
  fail "Part 2 CDATA context table missing"
fi

# T11 — Part 2 uses actual entity_factory API (not DESIGN.md's registry.createEntity)
if grep -q "entity_factory" "$TUTORIAL_DIR/part-02.md"; then
  pass "Part 2 uses entity_factory"
else
  fail "Part 2 missing entity_factory"
fi

# T12 — Part 4 uses correct model pool name
if grep -q "firebrand_completion_default" "$TUTORIAL_DIR/part-04.md"; then
  pass "Part 4 model pool name correct"
else
  fail "Part 4 model pool name wrong or missing"
fi

# T13 — Part 4 documents that .promptml is NOT auto-loaded
if grep -qiE "not auto.loaded|not loaded at runtime|NOT loaded|not automatically loaded|does not exist in this zero" "$TUTORIAL_DIR/part-04.md"; then
  pass "Part 4 documents promptml not auto-loaded"
else
  fail "Part 4 missing promptml not-auto-loaded note"
fi

# T14 — Part 1 uses env-var placeholder for LLM broker host (not hardcoded internal hostname)
if grep -q 'LLM_BROKER_HOST=\$' "$TUTORIAL_DIR/part-01.md"; then
  pass "Part 1 uses env-var for LLM broker host"
else
  fail "Part 1 hardcodes LLM broker host"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "All checks passed."
  exit 0
else
  echo "One or more checks failed — see FAIL lines above."
  exit 1
fi
