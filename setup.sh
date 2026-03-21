#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPECTED_DIR="$HOME/.pi/agent"
BACKUP_ROOT="$HOME/.pi_backup"

prompt_yes_no() {
  local message="$1"
  local default="${2:-Y}"
  local prompt

  if [ "$default" = "Y" ]; then
    prompt="[Y/n]"
  else
    prompt="[y/N]"
  fi

  while true; do
    read -r -p "$message $prompt " answer
    answer="${answer:-$default}"
    case "${answer,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *)
        echo "Please answer y or n."
        ;;
    esac
  done
}

backup_pi_config() {
  local timestamp destination
  timestamp="$(date +%Y%m%d-%H%M%S)"
  destination="$BACKUP_ROOT/agent-$timestamp"

  mkdir -p "$destination"

  shopt -s dotglob nullglob
  for path in "$EXPECTED_DIR"/*; do
    local name
    name="$(basename "$path")"
    case "$name" in
      .git|bin|sessions|.pi)
        continue
        ;;
    esac
    cp -R "$path" "$destination/"
  done
  shopt -u dotglob nullglob

  echo "Backup created at $destination"
}

if [ "$SCRIPT_DIR" != "$EXPECTED_DIR" ]; then
  echo "This repo should be cloned to $EXPECTED_DIR"
  echo "Current location: $SCRIPT_DIR"
  echo "Expected: $EXPECTED_DIR"
  exit 1
fi

if command -v pwsh >/dev/null 2>&1; then
  exec pwsh -File "$SCRIPT_DIR/setup.ps1"
fi

echo "Setting up pi config at $EXPECTED_DIR"
echo

if prompt_yes_no "Create a backup of the current pi config in $BACKUP_ROOT before installing?" Y; then
  backup_pi_config
else
  echo "Skipping backup."
fi

packages=(
  "git:github.com/nicobailon/pi-mcp-adapter"
  "git:github.com/HazAT/pi-smart-sessions"
  "git:github.com/HazAT/pi-parallel"
  "git:github.com/pasky/chrome-cdp-skill"
  "git:github.com/HazAT/pi-interactive-subagents"
  "git:github.com/HazAT/pi-autoresearch"
)

echo
if prompt_yes_no "Install configured pi packages now?" Y; then
  echo "Installing packages..."
  for package in "${packages[@]}"; do
    echo "  $package"
    if ! pi install "$package"; then
      echo "    skipped (already installed or install failed)"
    fi
  done
else
  echo "Skipping package installation."
fi

echo
if prompt_yes_no "Run the LM Studio CLI check now?" Y; then
  echo "LM Studio checks:"
  if lms --help >/dev/null 2>&1; then
    echo "  LM Studio CLI detected."
  else
    echo "  LM Studio CLI not detected. Install LM Studio and make sure 'lms' is on PATH."
  fi
else
  echo "Skipping LM Studio CLI check."
fi

echo
echo "Recommended LM Studio load commands:"
echo "  lms server start"
echo "  lms load <your-chosen-local-model> --identifier pi-local -c 32768"
echo
echo "Examples:"
echo "  lms load huihui-qwen3-coder-30b-a3b-instruct-abliterated-i1 --identifier pi-local -c 32768"
echo "  lms load qwen3.5-9b-claude-code --identifier pi-local -c 32768"

echo
echo "Verify local models:"
echo "  lms ps"
echo "  pi --list-models"

echo
echo "Backup agent:"
echo "  Start pi and use the backup-config agent when you want another snapshot under $BACKUP_ROOT."

echo
echo "Optional Codex login:"
echo "  Start pi, then run /login and choose ChatGPT Plus/Pro (Codex)."
echo "  Use planner-codex, reviewer-codex, or researcher-codex when you want cloud help."

echo
echo "Setup complete."
echo "Restart pi after loading your pi-local LM Studio model."
