import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { dirname, join } from "node:path";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
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

const PanelAgentParams = Type.Object({
  name: Type.String({ description: "Display name for the cmux panel" }),
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
  extensions: Type.Optional(Type.String({ description: "Comma-separated extension paths to load" })),
});

interface AgentDefaults {
  model?: string;
  tools?: string;
  skills?: string;
  thinking?: string;
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
    return {
      model: get("model"),
      tools: get("tools"),
      skills: get("skill") ?? get("skills"),
      thinking: get("thinking"),
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

export default function panelAgentsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "panel_agent",
    label: "Panel Agent",
    description:
      "Spawn a sub-agent in a dedicated cmux panel with shared session context. " +
      "The sub-agent branches from the current session, works independently (interactive or autonomous), " +
      "and returns results via a branch summary. Requires cmux to be running (CMUX_SOCKET_PATH must be set).",
    parameters: PanelAgentParams,

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
              text: "Error: cmux is not available. Set CMUX_SOCKET_PATH to use panel agents.",
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
              text: "Error: no session file. Start pi with a persistent session to use panel agents.",
            },
          ],
          details: { error: "no session file" },
        };
      }

      let surface: string | null = null;

      try {

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
          : "Complete your task autonomously. When finished, call the panel_done tool to close this session.";
        const summaryInstruction =
          "Your FINAL assistant message (before calling panel_done or before the user exits) should summarize what you accomplished.";
        const roleBlock = params.systemPrompt
          ? `\n\n${params.systemPrompt}`
          : "";

        // Prepend /skill:name for each skill so pi expands them inline in the
        // user message. This is far more effective than --skill which adds to
        // the system prompt where it gets buried in long sessions.
        const skillPrefix = effectiveSkills
          ? effectiveSkills.split(",").map((s) => s.trim()).filter(Boolean)
              .map((s) => `/skill:${s}`).join("\n") + "\n\n"
          : "";

        const fullTask =
          `${skillPrefix}${roleBlock}\n\n${modeHint}\n\n${params.task}\n\n${summaryInstruction}`;

        // Build pi command
        // Default: fresh session. The caller passes context in the task message.
        // Sharing the full session overwhelms the agent in long conversations —
        // it continues the parent conversation instead of focusing on its task.
        // The branch_summary still gets written to the MAIN session for /tree visibility.
        const parts: string[] = ["pi"];
        parts.push("--session-dir", shellEscape(dirname(sessionFile)));
        parts.push("--no-extensions");

        // Always load panel-done extension so autonomous agents can self-terminate
        const panelDonePath = join(dirname(new URL(import.meta.url).pathname), "panel-done.ts");
        parts.push("-e", shellEscape(panelDonePath));

        // Load additional extensions (e.g. session-artifacts for write_artifact)
        if (params.extensions) {
          for (const ext of params.extensions.split(",").map((s) => s.trim()).filter(Boolean)) {
            parts.push("-e", shellEscape(ext));
          }
        }

        // Skills are loaded via /skill:name in the user message (inline expansion).
        // We need skill discovery enabled for /skill:name to resolve, so only
        // pass --no-skills when there are no skills to load.
        if (!effectiveSkills) {
          parts.push("--no-skills");
        }

        if (effectiveModel) {
          const model = effectiveThinking
            ? `${effectiveModel}:${effectiveThinking}`
            : effectiveModel;
          parts.push("--model", shellEscape(model));
        }

        if (effectiveTools) {
          parts.push("--tools", shellEscape(effectiveTools));
        }

        // Never use -p. All agents run in interactive mode so the user can
        // watch progress in real-time. Autonomous agents call panel_done to
        // self-terminate. Interactive agents wait for user Ctrl+D.
        parts.push(shellEscape(fullTask));

        const piCommand = parts.join(" ");
        const command = `${piCommand}; echo '__PANEL_DONE_'$?'__'`;

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

        // Find the sub-agent's session file (newest .jsonl in the session dir)
        const sessionDir = dirname(sessionFile);
        const sessionFiles = readdirSync(sessionDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => ({ name: f, path: join(sessionDir, f), mtime: statSync(join(sessionDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        const subSessionFile = sessionFiles.find((f) => f.path !== sessionFile);

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
          ? `\n\nSession: ${subSessionFile.path}`
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
            content: [{ type: "text", text: "Panel agent cancelled." }],
            details: { error: "cancelled" },
          };
        }

        const message = err?.message ?? String(err);
        return {
          content: [{ type: "text", text: `Panel agent error: ${message}` }],
          details: { error: message },
        };
      }
    },

    renderCall(args, theme) {
      const interactive = args.interactive !== false;
      const icon = interactive ? "🧠" : "⚡";
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

        const icon = interactive ? "🧠" : "⚡";
        let text =
          `${icon} ` +
          theme.fg("toolTitle", theme.bold(name)) +
          theme.fg("dim", ` — ${elapsedText}`);

        if (interactive) {
          text +=
            "\n" +
            theme.fg("accent", `Switch to the "${name}" panel. `) +
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
      const cleanSummary = summaryText.replace(/\n\nSession: .+$/, "");
      const preview =
        expanded || cleanSummary.length <= 120
          ? cleanSummary
          : cleanSummary.slice(0, 120) + "…";

      const sessionLine = sessionPath
        ? "\n" + theme.fg("dim", `Session: ${sessionPath}`)
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
}
