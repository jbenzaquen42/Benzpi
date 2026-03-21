import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface CostEntry {
  cost: number;
  model: string;
  date: string;
}

function extractCosts(filePath: string): CostEntry[] {
  const entries: CostEntry[] = [];
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (
          entry.type === "message" &&
          entry.message?.role === "assistant" &&
          entry.message?.usage?.cost?.total
        ) {
          entries.push({
            cost: Number(entry.message.usage.cost.total),
            model: String(entry.message.model ?? "unknown"),
            date: path.basename(filePath).slice(0, 10),
          });
        }
      } catch {
        // Ignore malformed lines.
      }
    }
  } catch {
    // Ignore unreadable files.
  }
  return entries;
}

function findJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  };

  try {
    walk(dir);
  } catch {
    return files;
  }

  return files;
}

function getCutoffDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatBar(value: number, total: number, width = 24): string {
  if (total <= 0 || value <= 0) return "";
  return "#".repeat(Math.max(1, Math.round((value / total) * width)));
}

function normalizeProjectName(filePath: string): string {
  const dirName = path.basename(path.dirname(filePath));
  let project = dirName
    .replace(/^--/, "")
    .replace(/--$/, "")
    .replace(/^Users-[^-]+-Projects-/, "")
    .replace(/^private-tmp-/, "tmp/");
  if (!project || project.startsWith("Users-")) project = "other";
  return project;
}

function buildCostReport(days: number, ctx: ExtensionCommandContext): string {
  const cutoff = getCutoffDate(days);
  const sessionsDir = ctx.sessionManager.getSessionDir();
  const tmpDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? os.tmpdir();

  const mainFiles = findJsonlFiles(sessionsDir);
  const subagentDirs: string[] = [];
  try {
    for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("pi-subagent-session-")) {
        subagentDirs.push(path.join(tmpDir, entry.name));
      }
    }
  } catch {
    // Ignore temp directory scan failures.
  }
  const subagentFiles = subagentDirs.flatMap(findJsonlFiles);

  let mainCost = 0;
  let subagentCost = 0;
  let mainSessions = 0;
  let subagentSessions = 0;
  const byDate: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byProject: Record<string, number> = {};

  const processFile = (filePath: string, isSubagent: boolean) => {
    const datePart = path.basename(filePath).slice(0, 10);
    if (datePart < cutoff) return;

    const entries = extractCosts(filePath);
    if (!entries.length) return;

    let sessionCost = 0;
    for (const entry of entries) {
      sessionCost += entry.cost;
      byDate[entry.date] = (byDate[entry.date] ?? 0) + entry.cost;
      byModel[entry.model] = (byModel[entry.model] ?? 0) + entry.cost;
    }

    if (isSubagent) {
      subagentCost += sessionCost;
      subagentSessions += 1;
      return;
    }

    mainCost += sessionCost;
    mainSessions += 1;
    const project = normalizeProjectName(filePath);
    byProject[project] = (byProject[project] ?? 0) + sessionCost;
  };

  for (const filePath of mainFiles) processFile(filePath, false);
  for (const filePath of subagentFiles) processFile(filePath, true);

  const total = mainCost + subagentCost;
  const totalSessions = mainSessions + subagentSessions;

  if (totalSessions === 0) {
    return `No session cost records found in the last ${days} day${days === 1 ? "" : "s"}.`;
  }

  const lines: string[] = [];
  lines.push(`Cost summary for the last ${days} day${days === 1 ? "" : "s"}`);
  lines.push(`Total: ${formatCost(total)} across ${totalSessions} sessions`);
  lines.push(`Main: ${formatCost(mainCost)} (${mainSessions}) | Subagents: ${formatCost(subagentCost)} (${subagentSessions})`);

  const dates = Object.keys(byDate).sort();
  if (dates.length) {
    lines.push("");
    lines.push("By date");
    for (const date of dates) {
      lines.push(`  ${date}  ${formatCost(byDate[date]).padStart(8)}  ${formatBar(byDate[date], total)}`);
    }
  }

  const projects = Object.entries(byProject)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (projects.length) {
    lines.push("");
    lines.push("By project");
    for (const [name, cost] of projects) {
      lines.push(`  ${name.padEnd(30)} ${formatCost(cost).padStart(8)}`);
    }
  }

  const models = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
  if (models.length) {
    lines.push("");
    lines.push("By model");
    for (const [name, cost] of models) {
      lines.push(`  ${name.padEnd(30)} ${formatCost(cost).padStart(8)}`);
    }
  }

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("cost", {
    description: "Show session cost summary (default: 7 days). Usage: /cost [days]",
    handler: async (args, ctx) => {
      const days = args?.trim() ? parseInt(args.trim(), 10) : 7;
      if (isNaN(days) || days < 1) {
        return "Usage: /cost [days] (example: /cost 7)";
      }

      const report = buildCostReport(days, ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(report, "info");
      }
      return report;
    },
  });
}
