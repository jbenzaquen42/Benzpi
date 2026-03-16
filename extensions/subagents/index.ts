import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { dirname, join } from "node:path";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  isCmuxAvailable,
  createSurface,
  sendCommand,
  pollForExit,
  closeSurface,
  shellEscape,
} from "./cmux.ts";
import {
  getNewEntries,
  findLastAssistantMessage,
} from "./session.ts";

const SubagentParams = Type.Object({
  name: Type.String({ description: "Display name for the subagent" }),
  task: Type.String({ description: "Task/prompt for the sub-agent" }),
  agent: Type.Optional(
    Type.String({ description: "Agent name to load defaults from (e.g. 'worker', 'scout', 'reviewer'). Reads ~/.pi/agent/agents/<name>.md for model, tools, skills." })
  ),
  systemPrompt: Type.Optional(
    Type.String({ description: "Appended to system prompt (role instructions)" })
  ),
  interactive: Type.Optional(
    Type.Boolean({ description: "true = user collaborates, false = autonomous. Default: true" })
  ),
  model: Type.Optional(Type.String({ description: "Model override (overrides agent default)" })),
  skills: Type.Optional(Type.String({ description: "Comma-separated skills (overrides agent default)" })),
  tools: Type.Optional(Type.String({ description: "Comma-separated tools (overrides agent default)" })),
  fork: Type.Optional(Type.Boolean({ description: "Fork the current session — sub-agent gets full conversation context. Use for iterate/bugfix patterns." })),
});

interface AgentDefaults {
  model?: string;
  tools?: string;
  skills?: string;
  thinking?: string;
  body?: string;
}

function loadAgentDefaults(agentName: string): AgentDefaults | null {
  const paths = [
    join(process.cwd(), ".pi", "agents", `${agentName}.md`),
    join(homedir(), ".pi", "agent", "agents", `${agentName}.md`),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const content = readFileSync(p, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;
    const frontmatter = match[1];
    const get = (key: string) => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m ? m[1].trim() : undefined;
    };
    // Extract body (everything after frontmatter)
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    return {
      model: get("model"),
      tools: get("tools"),
      skills: get("skill") ?? get("skills"),
      thinking: get("thinking"),
      body: body || undefined,
    };
  }
  return null;
}

/**
 * Resolve a skill name or path to a full filesystem path.
 * Checks: as-is (absolute/relative), project .pi/skills/<name>/SKILL.md,
 * then user ~/.pi/agent/skills/<name>/SKILL.md.
 */
function resolveSkillPath(nameOrPath: string): string {
  // Already an absolute path or file path
  if (nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.endsWith(".md")) {
    return nameOrPath;
  }
  // Check project-local
  const projectPath = join(process.cwd(), ".pi", "skills", nameOrPath, "SKILL.md");
  if (existsSync(projectPath)) return projectPath;
  // Check user-global
  const userPath = join(homedir(), ".pi", "agent", "skills", nameOrPath, "SKILL.md");
  if (existsSync(userPath)) return userPath;
  // Fallback: return as-is (pi will error if not found)
  return nameOrPath;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Spawn a sub-agent in a dedicated cmux terminal with shared session context. " +
      "The sub-agent branches from the current session, works independently (interactive or autonomous), " +
      "and returns results via a branch summary. Requires cmux to be running (CMUX_SOCKET_PATH must be set).",
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const interactive = params.interactive !== false; // default true
      const startTime = Date.now();

      // Load agent defaults if specified — explicit params override
      const agentDefs = params.agent ? loadAgentDefaults(params.agent) : null;
      const effectiveModel = params.model ?? agentDefs?.model;
      const effectiveTools = params.tools ?? agentDefs?.tools;
      const effectiveSkills = params.skills ?? agentDefs?.skills;
      const effectiveThinking = agentDefs?.thinking;

      // Validate prerequisites
      if (!isCmuxAvailable()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: cmux is not available. Set CMUX_SOCKET_PATH to use subagents.",
            },
          ],
          details: { error: "cmux not available" },
        };
      }

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        return {
          content: [
            {
              type: "text",
              text: "Error: no session file. Start pi with a persistent session to use subagents.",
            },
          ],
          details: { error: "no session file" },
        };
      }

      let surface: string | null = null;

      try {

        // Record existing session files BEFORE spawning so we can identify
        // which file the sub-agent created (not just "newest")
        const sessionDir = dirname(sessionFile);
        const existingSessionFiles = new Set(
          readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"))
        );

        // Create cmux surface
        surface = createSurface(params.name);

        // Wait for surface to initialize
        await new Promise<void>((resolve) => setTimeout(resolve, 500));

        // Build the task message with preamble baked in.
        // In a long session, --append-system-prompt gets buried and ignored.
        // Putting the preamble in the user message ensures it's the last thing
        // the agent sees and actually responds to.
        const modeHint = interactive
          ? "The user will interact with you here. When done, they will exit with Ctrl+D."
          : "Complete your task autonomously. When finished, call the subagent_done tool to close this session.";
        const summaryInstruction =
          "Your FINAL assistant message (before calling subagent_done or before the user exits) should summarize what you accomplished.";
        // Agent identity: agent .md body > explicit systemPrompt > nothing.
        const identity = agentDefs?.body ?? params.systemPrompt ?? null;
        const roleBlock = identity ? `\n\n${identity}` : "";

        const fullTask =
          `${roleBlock}\n\n${modeHint}\n\n${params.task}\n\n${summaryInstruction}`;

        // Build pi command
        const parts: string[] = ["pi"];

        // Fork mode: copy the session file so the sub-agent has full context.
        // Used for iterate/bugfix patterns where context matters.
        // Default: fresh session — avoids overwhelming the agent in long sessions.
        let forkedSessionFile: string | null = null;
        if (params.fork) {
          const { copySessionFile } = await import("./session.ts");
          forkedSessionFile = copySessionFile(sessionFile, dirname(sessionFile));
          parts.push("--session", shellEscape(forkedSessionFile));
        } else {
          parts.push("--session-dir", shellEscape(dirname(sessionFile)));
        }
        // Always load subagent-done on top of whatever extensions auto-discover.
        // Subagents are full pi sessions — same extensions, same skills.
        // This means a subagent CAN spawn another subagent (planner → scout).
        const subagentDonePath = join(dirname(new URL(import.meta.url).pathname), "subagent-done.ts");
        parts.push("-e", shellEscape(subagentDonePath));

        if (effectiveModel) {
          const model = effectiveThinking
            ? `${effectiveModel}:${effectiveThinking}`
            : effectiveModel;
          parts.push("--model", shellEscape(model));
        }

        if (effectiveTools) {
          // --tools only accepts builtins. Extension-provided tools (todo,
          // write_artifact, etc.) are available via auto-discovered extensions.
          const BUILTIN_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
          const builtins = effectiveTools.split(",").map((t) => t.trim()).filter((t) => BUILTIN_TOOLS.has(t));
          if (builtins.length > 0) {
            parts.push("--tools", shellEscape(builtins.join(",")));
          }
        }

        // Write task to a temp file and use @file syntax.
        // Terminal input buffers truncate around 4096 bytes, and agent bodies +
        // skills + task can easily exceed that when passed as a CLI argument.
        // Skills go as separate /skill:name messages so pi renders them
        // as proper skill invocation blocks, not buried in the task file.
        if (effectiveSkills) {
          for (const skill of effectiveSkills.split(",").map((s) => s.trim()).filter(Boolean)) {
            parts.push(shellEscape(`/skill:${skill}`));
          }
        }

        const taskFile = join(tmpdir(), `subagent-task-${Date.now()}.md`);
        writeFileSync(taskFile, fullTask, "utf8");
        parts.push(`@${taskFile}`);

        const piCommand = parts.join(" ");
        // Set SUBAGENT_NAME env var so subagent-done.ts can set the terminal title
        const command = `SUBAGENT_NAME=${shellEscape(params.name)} ${piCommand}; rm -f ${shellEscape(taskFile)}; echo '__SUBAGENT_DONE_'$?'__'`;

        // Send to surface
        sendCommand(surface, command);

        // Poll for exit
        const interval = interactive ? 3000 : 1000;

        const exitCode = await pollForExit(surface, signal ?? new AbortController().signal, {
          interval,
          onTick() {
            onUpdate?.({
              content: [{ type: "text", text: `${formatElapsed(Math.floor((Date.now() - startTime) / 1000))} elapsed` }],
              details: {
                name: params.name,
                interactive,
                task: params.task,
                startTime,
              },
            });
          },
        });

        const elapsed = Math.floor((Date.now() - startTime) / 1000);

        // Find the sub-agent's session file
        let subSessionFile: { path: string } | undefined;
        if (forkedSessionFile) {
          // Fork mode: the forked file IS the sub-agent's session
          subSessionFile = { path: forkedSessionFile };
        } else {
          // Find the NEW session file created by this sub-agent.
          // Compare current files against the snapshot taken before spawning.
          const newFiles = readdirSync(sessionDir)
            .filter((f) => f.endsWith(".jsonl") && !existingSessionFiles.has(f))
            .map((f) => ({ name: f, path: join(sessionDir, f), mtime: statSync(join(sessionDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          subSessionFile = newFiles[0];
        }

        let summary: string;
        if (subSessionFile) {
          const allEntries = getNewEntries(subSessionFile.path, 0);
          summary =
            findLastAssistantMessage(allEntries) ??
            (exitCode !== 0
              ? `Sub-agent exited with code ${exitCode}`
              : "Sub-agent exited without output");
        } else {
          summary = exitCode !== 0
            ? `Sub-agent exited with code ${exitCode}`
            : "Sub-agent exited without output";
        }

        // Close surface
        closeSurface(surface);
        surface = null;

        const sessionRef = subSessionFile
          ? `\n\nSession: ${subSessionFile.path}\nResume: pi --session ${subSessionFile.path}`
          : "";
        const resultText =
          exitCode !== 0
            ? `Sub-agent exited with code ${exitCode}.\n\n${summary}${sessionRef}`
            : `${summary}${sessionRef}`;

        return {
          content: [{ type: "text", text: resultText }],
          details: {
            name: params.name,
            sessionFile: subSessionFile?.path,
            interactive,
            exitCode,
            elapsed,
          },
        };
      } catch (err: any) {
        if (surface) {
          try {
            closeSurface(surface);
          } catch {
            // ignore cleanup errors
          }
          surface = null;
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Subagent cancelled." }],
            details: { error: "cancelled" },
          };
        }

        const message = err?.message ?? String(err);
        return {
          content: [{ type: "text", text: `Subagent error: ${message}` }],
          details: { error: message },
        };
      }
    },

    renderCall(args, theme) {
      const interactive = args.interactive !== false;
      const icon = interactive ? "▸" : "▹";
      const mode = interactive ? "interactive session" : "autonomous";
      const text =
        `${icon} ` +
        theme.fg("toolTitle", theme.bold(args.name ?? "(unnamed)")) +
        theme.fg("dim", ` — ${mode}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as any;
      const name = details?.name ?? "(unnamed)";
      const interactive = details?.interactive !== false;

      if (isPartial) {
        // Show progress/instructions while running
        const startTime: number | undefined = details?.startTime;
        const elapsedText = startTime
          ? formatElapsed(Math.floor((Date.now() - startTime) / 1000))
          : "running…";

        const icon = interactive ? "▸" : "▹";
        let text =
          `${icon} ` +
          theme.fg("toolTitle", theme.bold(name)) +
          theme.fg("dim", ` — ${elapsedText}`);

        if (interactive) {
          text +=
            "\n" +
            theme.fg("accent", `Switch to the "${name}" terminal. `) +
            theme.fg("dim", "Exit (Ctrl+D) to return.");
        } else {
          const taskPreview: string = details?.task ?? "";
          const preview = taskPreview.length > 80 ? taskPreview.slice(0, 80) + "…" : taskPreview;
          if (preview) {
            text += "\n" + theme.fg("dim", `Task: ${preview}`);
          } else {
            text += "\n" + theme.fg("dim", "Running...");
          }
        }

        return new Text(text, 0, 0);
      }

      // Completed
      const exitCode = details?.exitCode ?? 0;
      const elapsed = details?.elapsed != null ? formatElapsed(details.elapsed) : "?";
      const summaryText =
        typeof result.content?.[0]?.text === "string" ? result.content[0].text : "";

      if (exitCode !== 0) {
        const text =
          theme.fg("error", "✗") +
          " " +
          theme.fg("toolTitle", theme.bold(name)) +
          theme.fg("dim", ` — failed (exit code ${exitCode})`);
        return new Text(text, 0, 0);
      }

      // Strip session path from summary for the preview (it's shown separately)
      const sessionPath: string | undefined = details?.sessionFile;
      const cleanSummary = summaryText.replace(/\n\nSession: .+\nResume: .+$/, "").replace(/\n\nSession: .+$/, "");
      const preview =
        expanded || cleanSummary.length <= 120
          ? cleanSummary
          : cleanSummary.slice(0, 120) + "…";

      const sessionLine = sessionPath
        ? "\n" + theme.fg("dim", `Session: ${sessionPath}`) +
          "\n" + theme.fg("dim", `Resume:  pi --session ${sessionPath}`)
        : "";

      const text =
        theme.fg("success", "✓") +
        " " +
        theme.fg("toolTitle", theme.bold(name)) +
        theme.fg("dim", ` — completed (${elapsed})`) +
        (preview ? "\n" + theme.fg("text", preview) : "") +
        sessionLine;

      return new Text(text, 0, 0);
    },
  });

  // subagents_list tool — discover available agent definitions
  pi.registerTool({
    name: "subagents_list",
    label: "List Subagents",
    description:
      "List all available subagent definitions. " +
      "Scans project-local .pi/agents/ and global ~/.pi/agent/agents/. " +
      "Project-local agents override global ones with the same name.",
    parameters: Type.Object({}),

    async execute() {
      const agents = new Map<string, { name: string; description?: string; model?: string; source: string }>();

      const dirs = [
        { path: join(homedir(), ".pi", "agent", "agents"), source: "global" },
        { path: join(process.cwd(), ".pi", "agents"), source: "project" },
      ];

      for (const { path: dir, source } of dirs) {
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
          const content = readFileSync(join(dir, file), "utf8");
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (!match) continue;
          const frontmatter = match[1];
          const get = (key: string) => {
            const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
            return m ? m[1].trim() : undefined;
          };
          const name = get("name") ?? file.replace(/\.md$/, "");
          agents.set(name, {
            name,
            description: get("description"),
            model: get("model"),
            source,
          });
        }
      }

      if (agents.size === 0) {
        return {
          content: [{ type: "text", text: "No subagent definitions found." }],
          details: { agents: [] },
        };
      }

      const list = [...agents.values()];
      const lines = list.map((a) => {
        const badge = a.source === "project" ? " (project)" : "";
        const desc = a.description ? ` — ${a.description}` : "";
        const model = a.model ? ` [${a.model}]` : "";
        return `• ${a.name}${badge}${model}${desc}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { agents: list },
      };
    },

    renderResult(result, _opts, theme) {
      const details = result.details as any;
      const agents = details?.agents ?? [];
      if (agents.length === 0) {
        return new Text(theme.fg("dim", "No subagent definitions found."), 0, 0);
      }
      const lines = agents.map((a: any) => {
        const badge = a.source === "project" ? theme.fg("accent", " (project)") : "";
        const desc = a.description ? theme.fg("dim", ` — ${a.description}`) : "";
        const model = a.model ? theme.fg("dim", ` [${a.model}]`) : "";
        return `  ${theme.fg("toolTitle", theme.bold(a.name))}${badge}${model}${desc}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });

  // /iterate command — fork the session into an interactive subagent
  pi.registerCommand("iterate", {
    description: "Fork session into an interactive subagent for focused work (bugfixes, iteration)",
    handler: async (args, ctx) => {
      const task = args?.trim() || "";
      const toolCall = task
        ? `Use subagent to start an interactive iterate session. fork: true, name: "Iterate", task: ${JSON.stringify(task)}`
        : `Use subagent to start an interactive iterate session. fork: true, name: "Iterate", task: "The user wants to do some hands-on work. Help them with whatever they need."`;
      pi.sendUserMessage(toolCall);
    },
  });

  // /subagent command — spawn a subagent by name
  pi.registerCommand("subagent", {
    description: "Spawn a subagent: /subagent <agent> <task>",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      if (!trimmed) {
        ctx.ui.notify("Usage: /subagent <agent> [task]", "warning");
        return;
      }

      const spaceIdx = trimmed.indexOf(" ");
      const agentName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const task = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

      const defs = loadAgentDefaults(agentName);
      if (!defs) {
        ctx.ui.notify(`Agent "${agentName}" not found in ~/.pi/agent/agents/ or .pi/agents/`, "error");
        return;
      }

      const taskText = task || `You are the ${agentName} agent. Wait for instructions.`;
      const toolCall = `Use subagent with agent: "${agentName}", name: "${agentName[0].toUpperCase() + agentName.slice(1)}", interactive: false, task: ${JSON.stringify(taskText)}`;
      pi.sendUserMessage(toolCall);
    },
  });

  // /plan command — start the full planning workflow
  pi.registerCommand("plan", {
    description: "Start a planning session: /plan <what to build>",
    handler: async (args, ctx) => {
      const task = (args ?? "").trim();
      if (!task) {
        ctx.ui.notify("Usage: /plan <what to build>", "warning");
        return;
      }

      // Load the plan skill from the subagents extension directory
      const planSkillPath = join(dirname(new URL(import.meta.url).pathname), "plan-skill.md");
      let content = readFileSync(planSkillPath, "utf8");
      content = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
      pi.sendUserMessage(`<skill name="plan" location="${planSkillPath}">\n${content.trim()}\n</skill>\n\n${task}`);
    },
  });
}
