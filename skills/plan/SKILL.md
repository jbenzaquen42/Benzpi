---
name: plan
description: >
  Panel-based planning workflow. Spawns an interactive planner sub-agent
  in a cmux panel with shared session context. Use when asked to "plan",
  "brainstorm", "I want to build X", or "let's design". Requires the
  panel-agents extension and cmux.
---

# Plan

A panel-based planning workflow that offloads brainstorming and plan creation to a dedicated interactive panel, keeping the main session clean for orchestration.

**Announce at start:** "Let me investigate first, then I'll open a dedicated planning panel where we can work through this together."

---

## The Flow

```
Phase 1: Quick Investigation (main session)
    ↓
Phase 2: Spawn Planner Panel (interactive — user collaborates here)
    ↓
Phase 3: Review Plan & Todos (main session)
    ↓
Phase 4: Create Feature Branch
    ↓
Phase 5: Execute Todos (workers)
    ↓
Phase 6: Review
```

---

## Phase 1: Quick Investigation

Before spawning the planner, orient yourself:

```bash
ls -la
find . -type f -name "*.ts" | head -20  # or relevant extension
cat package.json 2>/dev/null | head -30
```

Spend 30–60 seconds. The goal is to give the planner useful context — not to do a full scout.

**If deeper context is needed** (large codebase, unfamiliar architecture), spawn an autonomous scout panel first:

```typescript
panel_agent({
  name: "🔍 Scout",
  agent: "scout",
  interactive: false,
  task: "Analyze the codebase. Map file structure, key modules, patterns, and conventions. Summarize findings concisely for a planning session."
})
```

Read the scout's summary from the panel result before proceeding.

---

## Phase 2: Spawn Planner Panel

Spawn the interactive planner with full context from Phase 1:

```typescript
panel_agent({
  name: "🧠 Planner",
  interactive: true,
  extensions: "~/.pi/agent/extensions/session-artifacts.ts",
  systemPrompt: `You are the Planner agent, working in a dedicated planning session.
You have full context from the main conversation.

Use the write_artifact tool for all planning artifacts (plans, notes, research).
This ensures everything is recoverable under ~/.pi/history/<project>/artifacts/<session-id>/.
Do NOT use write_artifact for actual project files (code, configs) — those go where they belong.

Your workflow:
1. Clarify requirements — ask questions, understand scope, work through ambiguities
2. Explore approaches — present 2-3 options with tradeoffs, recommend one
3. Write the plan — use write_artifact(name: "plans/YYYY-MM-DD-<name>.md", content: ...)
4. Create todos — granular, bite-sized tasks using the todo tool
   Each todo body should include: Plan path, task description, files to create/modify, acceptance criteria
5. Summarize — your FINAL message must be a clear summary:
   - Plan file path
   - Number of todos created with their IDs
   - Key decisions made
   - Any open questions

When you and the user are satisfied with the plan and todos, tell them to exit (Ctrl+D) to return to the main session.`,
  task: `Plan: [what the user wants to build]

Context from investigation:
[paste relevant findings from Phase 1 here]`
})
```

**The user works with the planner in the panel.** The main session waits. When the user is done, they press Ctrl+D and the panel's summary is returned to the main session.

---

## Phase 3: Review Plan & Todos

Once the panel closes, read the plan and todos:

```bash
cat ~/.pi/history/<project>/plans/YYYY-MM-DD-<name>.md
```

```typescript
todo({ action: "list" })
```

Review with the user:
> "Here's what the planner produced: [brief summary]. Ready to execute, or anything to adjust?"

---

## Phase 4: Create Feature Branch

```bash
git checkout -b feat/<short-descriptive-name>
```

Branch naming: `feat/<name>`, `fix/<name>`, `refactor/<name>`

---

## Phase 5: Execute Todos

Use the scout → worker pattern from the subagents system:

```typescript
// 1. Scout gathers context for all workers
subagent({ agent: "scout", task: "Gather context for implementing [feature]. Read the plan at ~/.pi/history/<project>/plans/YYYY-MM-DD-feature.md. Identify all files that will be created/modified, map existing patterns and conventions." })

// 2. Read scout's output
const scoutContext = read(".pi/context.md")

// 3. Workers execute todos sequentially — one at a time
subagent({ agent: "worker", task: `Implement TODO-xxxx. Use the commit skill to write a polished, descriptive commit message. Mark the todo as done. Plan: ~/.pi/history/<project>/plans/YYYY-MM-DD-feature.md

Scout context:
${scoutContext}` })

// Check result, then next todo
subagent({ agent: "worker", task: `Implement TODO-yyyy. ...` })
```

**Alternatively**, use panel agents for visible worker progress:

```typescript
panel_agent({
  name: "⚡ Worker",
  agent: "worker",
  interactive: false,
  task: "Implement TODO-xxxx. Mark the todo as done. Plan: ..."
})
```

**Always run workers sequentially in the same git repo** — parallel workers will conflict on commits.

---

## Phase 6: Review

After all todos are complete:

```typescript
// Using subagent (background)
subagent({ agent: "reviewer", task: "Review the feature branch against main. Plan: ~/.pi/history/<project>/plans/YYYY-MM-DD-feature.md" })

// Or using panel agent (visible)
panel_agent({ name: "🔎 Reviewer", agent: "reviewer", interactive: false, task: "Review the feature branch against main. Plan: ..." })
```

Triage findings:
- **P0** — Real bugs, security issues → fix now
- **P1** — Genuine traps, maintenance dangers → fix before merging
- **P2** — Minor issues → fix if quick, note otherwise
- **P3** — Nits → skip

Create todos for P0/P1, run workers to fix, re-review only if fixes were substantial.

---

## ⚠️ Completion Checklist

Before reporting done:

1. ✅ All worker todos closed?
2. ✅ Every todo has a polished commit (using the `commit` skill)?
3. ✅ Reviewer has run?
4. ✅ Reviewer findings triaged and addressed?

**Do NOT squash merge or merge the feature branch into main.**
