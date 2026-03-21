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
| **python-worker** | `LM Studio/pi-local` | Python specialist for scripts, packages, tooling, APIs, and tests |
| **dotnet-worker** | `LM Studio/pi-local` | .NET specialist for C# apps, libraries, ASP.NET Core, and test workflows |
| **docker-worker** | `LM Studio/pi-local` | Docker specialist for Dockerfiles, Compose stacks, and local service orchestration |
| **env-doctor** | `LM Studio/pi-local` | Diagnoses broken local setup across Pi, LM Studio, MCP, Docker, and tooling |
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

## Which Agent Should I Use?

Use a specialist worker when the dominant task matches its domain. Use the generic `worker` when the task is mixed or no single domain clearly owns it.

| Agent | Use it when | Why | When not to use it |
|-------|-------------|-----|--------------------|
| **worker** | The task is mixed-stack, generic, or not clearly owned by one specialty | Lowest-friction default execution path | When Python, .NET, or Docker clearly dominates the task |
| **python-worker** | The task is mainly Python scripts, packages, APIs, tooling, data work, or pytest-heavy changes | Better environment, dependency, and verification choices for Python work | When Python is incidental to a broader task |
| **dotnet-worker** | The task is mainly C# or .NET and should be verified with `dotnet` | Better solution/project discovery and .NET build-test discipline | When the task is Unity-specific or not primarily .NET |
| **docker-worker** | The task is about Dockerfiles, Compose, local services, ports, images, or container debugging | Thinks in services, images, logs, health checks, and startup order | When the real problem is app logic, not the container layer |
| **env-doctor** | Pi, LM Studio, MCP, Docker, or local tooling is broken before feature work can proceed | Isolates machine/setup diagnosis from product implementation | When the task is normal implementation rather than environment diagnosis |
| **scout** | You need quick reconnaissance before making changes | Maps structure, patterns, and gotchas fast | When the task is ready for implementation |
| **planner** | Requirements or design are fuzzy | Turns ambiguity into plans and todos | When scope is already clear and execution can start |
| **reviewer** | Substantial implementation is complete | Gives a focused correctness and risk pass | When no meaningful implementation has happened yet |
| **researcher** | The task needs outside docs or ecosystem research | Uses research tools plus local analysis | When the answer is fully local to the repo |

### Selection Rules

- Use `scout` to map an unfamiliar codebase before implementation.
- Use `planner` when scope or design is still fuzzy.
- Use `python-worker`, `dotnet-worker`, or `docker-worker` when the main task clearly fits that specialty.
- Use `worker` when the task is mixed or generic.
- Use `reviewer` after substantial implementation.
- Use `env-doctor` when local tools or infrastructure are failing.

### Example Prompts

- `python-worker`: `Fix this failing pytest and keep the change minimal.`
- `python-worker`: `Add a CLI option to this Python script and verify it directly.`
- `dotnet-worker`: `Implement this C# change and verify the affected project with dotnet build.`
- `dotnet-worker`: `Fix this failing .NET test and keep the change scoped to the right project.`
- `docker-worker`: `Debug why this compose stack fails locally and verify the affected service comes up.`
- `docker-worker`: `Update this Dockerfile for local development and verify the image still builds.`
- `env-doctor`: `Diagnose why pi-local is not available even though LM Studio is running.`
- `env-doctor`: `Figure out why Docker compose fails before the app starts.`

For a longer operator guide with workflow examples, see [docs/agent-guide.md](docs/agent-guide.md).

## Notes

- This repo is intentionally Windows-first and local-first.
- The main path is one loaded LM Studio model under `pi-local`.
- Codex is an explicit secondary path through `planner-codex`, `reviewer-codex`, and `researcher-codex`.
- API-key-based OpenAI usage is still possible in Pi generally, but it is not the primary path for this config.

## Credits

Extensions from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `answer`, `todos`

Skills from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `commit`, `github`

Skills from [getsentry/skills](https://github.com/getsentry/skills): `code-simplifier`

Repo-local skills added in this config: `learn-codebase`, `frontend-design`, `cmux`, `add-mcp-server`, `session-reader`, `iterate-pr`, `presentation-creator`, `dev-environment`, `python-project`, `dotnet-project`
