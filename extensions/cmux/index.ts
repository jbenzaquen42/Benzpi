/**
 * Push Pi session state into the cmux sidebar.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  WATCHDOG_STATUS_EVENT,
  STATUS_KEYS,
  type StatusSnapshot,
  type WatchdogStatusPayload,
  buildStatusSnapshot,
  cmuxColorForLevel,
} from "../context-status";

const CMUX_SOCKET = process.env.CMUX_SOCKET_PATH;

export default function (pi: ExtensionAPI) {
  if (!CMUX_SOCKET) return;

  let hasUI = false;
  let sessionCtx: ExtensionContext | null = null;
  let sessionCost = 0;
  let activeTool: string | undefined;
  let sessionState: "idle" | "working" = "idle";
  let watchdog: WatchdogStatusPayload | undefined;

  function run(...args: string[]) {
    if (!hasUI) return;
    pi.exec("cmux", args, { timeout: 2_000 }).catch(() => {});
  }

  function clearAll() {
    for (const key of Object.values(STATUS_KEYS)) {
      run("clear-status", key);
    }
  }

  function setStatus(key: string, text: string, level: StatusSnapshot["state"]["level"], icon: string) {
    run("set-status", key, text, "--icon", icon, "--color", cmuxColorForLevel(level));
  }

  function rebuildCost(ctx: ExtensionContext): void {
    sessionCost = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        (entry.message as any).usage?.cost?.total
      ) {
        sessionCost += (entry.message as any).usage.cost.total;
      }
    }
  }

  function renderSnapshot(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const snapshot = buildStatusSnapshot({
      model: ctx.model,
      usage: ctx.getContextUsage(),
      sessionCost,
      activeTool,
      watchdog,
      state: sessionState,
    });

    setStatus(STATUS_KEYS.state, snapshot.state.text, snapshot.state.level, "circle.fill");
    setStatus(STATUS_KEYS.model, snapshot.model.text, snapshot.model.level, "brain");
    setStatus(STATUS_KEYS.context, snapshot.context.text, snapshot.context.level, "gauge");

    if (snapshot.cost) {
      setStatus(STATUS_KEYS.cost, snapshot.cost.text, snapshot.cost.level, "dollarsign.circle");
    } else {
      run("clear-status", STATUS_KEYS.cost);
    }

    if (snapshot.tool) {
      setStatus(STATUS_KEYS.tool, snapshot.tool.text, snapshot.tool.level, "wrench");
    } else {
      run("clear-status", STATUS_KEYS.tool);
    }

    if (snapshot.watchdog) {
      setStatus(STATUS_KEYS.watchdog, snapshot.watchdog.text, snapshot.watchdog.level, "shield");
    } else {
      run("clear-status", STATUS_KEYS.watchdog);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionCtx = ctx;
    hasUI = ctx.hasUI;
    if (!hasUI) return;
    rebuildCost(ctx);
    activeTool = undefined;
    sessionState = "idle";
    renderSnapshot(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionCtx = null;
    if (!ctx.hasUI) return;
    clearAll();
  });

  pi.on("agent_start", async (_event, ctx) => {
    sessionState = "working";
    renderSnapshot(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    sessionState = "idle";
    activeTool = undefined;
    renderSnapshot(ctx);
    run("notify", "--title", "Needs attention");
  });

  pi.on("turn_end", async (event, ctx) => {
    const message = event.message;
    if (message?.role === "assistant" && (message as any).usage?.cost?.total) {
      sessionCost += (message as any).usage.cost.total;
    }
    renderSnapshot(ctx);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    activeTool = event.toolName;
    renderSnapshot(ctx);
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    activeTool = undefined;
    renderSnapshot(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    renderSnapshot(ctx);
  });

  pi.events.on(WATCHDOG_STATUS_EVENT, (payload: WatchdogStatusPayload) => {
    watchdog = payload;
    if (sessionCtx) {
      renderSnapshot(sessionCtx);
    }
  });
}
