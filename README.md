# Pi Config

Windows-first [pi](https://github.com/badlogic/pi) config for LM Studio, with optional native Codex login through Pi when you want ChatGPT Plus-backed online help.

## Setup

Clone this repo directly to `"$HOME\.pi\agent"` so Pi auto-discovers the config.

### Fresh machine

```powershell
# 1. Install pi and LM Studio

# 2. Clone this repo as your Pi agent config
git clone <your-fork-url> "$HOME\.pi\agent"

# 3. Run setup
Set-Location "$HOME\.pi\agent"
.\setup.ps1
```

### Updating

```powershell
Set-Location "$HOME\.pi\agent"
git pull
```

## LM Studio

This repo assumes exactly one local chat model is loaded at a time under the shared alias `pi-local`.

```powershell
lms ls
lms server start
lms load <your-chosen-local-model> --identifier pi-local -c 32768
lms ps
pi --list-models
```

Example loads:

```powershell
lms load huihui-qwen3-coder-30b-a3b-instruct-abliterated-i1 --identifier pi-local -c 32768
lms load qwen3.5-9b-claude-code --identifier pi-local -c 32768
```

The repo does not require `pi-fast`, `pi-main`, or `pi-heavy`. If you want extra LM Studio aliases for your own experiments, you can create them, but the shipped config only depends on `LM Studio/pi-local`.

## Codex OAuth

This repo does not use `openai-oauth` and does not require an OpenAI API key for Codex access.

Use Pi's native login flow instead:

```text
/login
```

Choose `ChatGPT Plus/Pro (Codex)`, then verify what Pi can see:

```powershell
pi --list-models codex
```

Local agents remain the default. Use the Codex-specific agents only when you explicitly want online help for planning, review, or research.

## Architecture

This config uses subagents, visible cmux terminals, local-first model defaults, and a small set of repo-local extensions.

### Key Concepts

- `agents/*.md` defines the role, default model, and workflow for each specialist.
- `models.json` defines the single shipped LM Studio alias: `pi-local`.
- `settings.json` keeps the default provider on `LM Studio` and the default model on `pi-local`.
- `/login` is the optional online path for native Codex OAuth.

## Agents

| Agent | Default model | Purpose |
|-------|---------------|---------|
| **planner** | `LM Studio/pi-local` | Interactive brainstorming, planning, and todo creation |
| **scout** | `LM Studio/pi-local` | Fast reconnaissance and codebase mapping |
| **worker** | `LM Studio/pi-local` | Implements scoped tasks and verifies results |
| **reviewer** | `LM Studio/pi-local` | Reviews code for correctness, risk, and quality |
| **researcher** | `LM Studio/pi-local` | Uses installed research tools plus local code analysis |
| **visual-tester** | `LM Studio/pi-local` | Visual QA through Chrome CDP |
| **autoresearch** | `LM Studio/pi-local` | Autonomous experiment loop |

Codex offload agents:

| Agent | Default model | Purpose |
|-------|---------------|---------|
| **planner-codex** | `openai-codex/gpt-5.4` | Cloud planning when you want to spend Codex quota |
| **reviewer-codex** | `openai-codex/gpt-5.4` | Cloud review for deeper second-pass analysis |
| **researcher-codex** | `openai-codex/gpt-5.4` | Cloud research and synthesis when local context is not enough |

## Extensions

| Extension | What it provides |
|-----------|------------------|
| **answer/** | `/answer` command plus `Ctrl+.` for interactive Q&A |
| **cmux/** | cmux integration, notifications, and sidebar status |
| **cost/** | `/cost` command for session cost summaries |
| **execute-command/** | lets the agent self-invoke slash commands |
| **todos/** | `/todos` command plus `todo` tool |
| **watchdog/** | monitors agent behavior |

The helper extensions are local-first too:

- `answer` prefers the active LM Studio session model, then `LM Studio/pi-local`, then falls back to the current model.
- `watchdog` tries `LM Studio/pi-local` first, then the current session model.

## Packages

Installed through `pi install`, managed in `settings.json`.

| Package | Description |
|---------|-------------|
| [pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents) | subagent tools plus `/plan`, `/subagent`, `/iterate` |
| [pi-parallel](https://github.com/HazAT/pi-parallel) | optional web search and research tools |
| [pi-smart-sessions](https://github.com/HazAT/pi-smart-sessions) | AI-generated session names |
| [pi-autoresearch](https://github.com/HazAT/pi-autoresearch) | autonomous experiment loop |
| [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) | MCP server integration |
| [chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill) | Chrome DevTools Protocol CLI for visual testing |

## Notes

- This repo is intentionally Windows-first and local-first.
- The main path is one loaded LM Studio model under `pi-local`.
- Codex is an explicit secondary path through `planner-codex`, `reviewer-codex`, and `researcher-codex`.
- API-key-based OpenAI usage is still possible in Pi generally, but it is not the primary path for this config.

## Credits

Extensions from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `answer`, `todos`

Skills from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `commit`, `github`

Skills from [getsentry/skills](https://github.com/getsentry/skills): `code-simplifier`
