#!/usr/bin/env bash
# FireFoundry AI Assistant Skills Installer
# Installs skills for Claude Code and/or Cursor.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS=(ff-cli ff-local-dev ff-agent-sdk ff-create-bundle ff-add-bot ff-add-entity ff-deploy-local ff-setup-cluster ff-eg-read ff-diagnostics ff-telemetry-read)

CLAUDE_ONLY=false
CURSOR_ONLY=false
UNINSTALL=false
PROJECT_DIR="$(pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --claude-only) CLAUDE_ONLY=true; shift ;;
    --cursor-only) CURSOR_ONLY=true; shift ;;
    --uninstall)   UNINSTALL=true; shift ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --claude-only         Install only for Claude Code"
      echo "  --cursor-only         Install only for Cursor"
      echo "  --project-dir <path>  Cursor project directory (default: cwd)"
      echo "  --uninstall           Remove previously installed skills"
      echo "  -h, --help            Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Detect available tools
HAS_CLAUDE=false
HAS_CURSOR=false

if [[ -d "$HOME/.claude" ]]; then
  HAS_CLAUDE=true
fi

if command -v cursor &>/dev/null || [[ -d "$PROJECT_DIR/.cursor" ]]; then
  HAS_CURSOR=true
fi

if $CURSOR_ONLY; then HAS_CLAUDE=false; fi
if $CLAUDE_ONLY; then HAS_CURSOR=false; fi

if ! $HAS_CLAUDE && ! $HAS_CURSOR; then
  echo "No supported AI tools detected."
  echo "  Claude Code: ~/.claude directory not found"
  echo "  Cursor: 'cursor' command not found and no .cursor directory in $PROJECT_DIR"
  exit 1
fi

# Extract SKILL.md content after frontmatter (skips the YAML block)
extract_body() {
  local file="$1"
  awk 'BEGIN{n=0} /^---$/{n++; if(n==2){found=1; next}} found{print}' "$file"
}

# Extract description from SKILL.md frontmatter
extract_description() {
  local file="$1"
  awk '/^---$/{n++; next} n==1 && /^description:/{sub(/^description: */, ""); print; exit}' "$file"
}

# --- Uninstall ---
if $UNINSTALL; then
  count=0
  if $HAS_CLAUDE; then
    for skill in "${SKILLS[@]}"; do
      if [[ -d "$HOME/.claude/skills/$skill" ]]; then
        rm -rf "$HOME/.claude/skills/$skill"
        echo "Removed Claude Code skill: $skill"
        ((count++))
      fi
    done
  fi
  if $HAS_CURSOR; then
    for skill in "${SKILLS[@]}"; do
      if [[ -f "$PROJECT_DIR/.cursor/rules/$skill.mdc" ]]; then
        rm "$PROJECT_DIR/.cursor/rules/$skill.mdc"
        echo "Removed Cursor rule: $skill"
        ((count++))
      fi
    done
  fi
  echo "Uninstalled $count items."
  exit 0
fi

# --- Install ---
claude_count=0
cursor_count=0

for skill in "${SKILLS[@]}"; do
  skill_dir="$SCRIPT_DIR/$skill"
  skill_file="$skill_dir/SKILL.md"

  if [[ ! -f "$skill_file" ]]; then
    echo "Warning: $skill_file not found, skipping"
    continue
  fi

  # Claude Code: copy skill directory
  if $HAS_CLAUDE; then
    dest="$HOME/.claude/skills/$skill"
    mkdir -p "$dest"
    cp "$skill_file" "$dest/SKILL.md"
    if [[ -d "$skill_dir/modes" ]]; then
      cp -r "$skill_dir/modes" "$dest/"
    fi
    ((claude_count++))
  fi

  # Cursor: generate .mdc file
  if $HAS_CURSOR; then
    mkdir -p "$PROJECT_DIR/.cursor/rules"
    desc=$(extract_description "$skill_file")
    body=$(extract_body "$skill_file")
    dest="$PROJECT_DIR/.cursor/rules/$skill.mdc"
    {
      echo "---"
      echo "description: $desc"
      echo "globs: "
      echo "alwaysApply: false"
      echo "---"
      echo "$body"
    } > "$dest"
    ((cursor_count++))
  fi
done

echo ""
echo "Installation complete:"
if $HAS_CLAUDE; then
  echo "  Claude Code: $claude_count skills installed to ~/.claude/skills/"
fi
if $HAS_CURSOR; then
  echo "  Cursor: $cursor_count rules installed to $PROJECT_DIR/.cursor/rules/"
fi
