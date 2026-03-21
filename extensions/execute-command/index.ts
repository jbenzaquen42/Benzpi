import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // Queue only commands that truly must wait for the turn to finish.
  const pendingCommands: Array<{ command: string; reason?: string }> = [];

  // Tool to execute a command/message directly (self-invoke)
  pi.registerTool({
    name: "execute_command",
    label: "Execute Command",
    description: `Execute a slash command or send a message as if the user typed it. The message is added to the session history and triggers a new turn. Use this to:
- Self-invoke /answer after asking multiple questions
- Run /reload after creating skills
- Execute any slash command programmatically
- Send follow-up prompts to yourself

The command/message appears in the conversation as a user message.`,
    promptSnippet:
      "Execute a slash command or send a message as if the user typed it. " +
      "Use to self-invoke /answer after asking questions, run /reload after creating skills, or send follow-up prompts.",

    parameters: Type.Object({
      command: Type.String({ 
        description: "The command or message to execute (e.g., '/answer', '/reload', or any text)" 
      }),
      reason: Type.Optional(
        Type.String({ 
          description: "Optional explanation for why you're executing this command (shown to user)" 
        })
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { command, reason } = params;
      let explanation: string;
      if (command === "/answer") {
        pendingCommands.push({ command, reason });
        explanation = reason
          ? `Queued for execution: ${command}\nReason: ${reason}`
          : `Queued for execution: ${command}`;
      } else if (command.startsWith("/")) {
        pi.sendUserMessage(command, { deliverAs: "followUp" });
        explanation = reason
          ? `Scheduled follow-up command: ${command}\nReason: ${reason}`
          : `Scheduled follow-up command: ${command}`;
      } else {
        pi.sendUserMessage(command, { deliverAs: "followUp" });
        explanation = reason
          ? `Scheduled follow-up message: ${command}\nReason: ${reason}`
          : `Scheduled follow-up message: ${command}`;
      }

      return {
        content: [{ type: "text", text: explanation }],
        details: { 
          command,
          reason,
          queued: command === "/answer",
        },
      };
    },
  });

  // Execute pending command after agent turn completes
  pi.on("agent_end", async (event, ctx) => {
    if (!pendingCommands.length) {
      return;
    }

    const queued = pendingCommands.splice(0, pendingCommands.length);
    for (const { command } of queued) {
      // Special handling for /answer via event bus (needs context)
      if (command === "/answer") {
        pi.events.emit("trigger:answer", ctx);
      }
    }
  });
}
