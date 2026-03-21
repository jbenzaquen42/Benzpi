#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v pwsh >/dev/null 2>&1; then
  exec pwsh -File "$SCRIPT_DIR/setup.ps1"
fi

echo "This repo is Windows-first now. Run setup.ps1 from PowerShell."
echo "If you need a manual fallback, install the packages from settings.json and load the LM Studio model identifiers documented in README.md."
exit 1
