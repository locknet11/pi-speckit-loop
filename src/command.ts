import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pickMode } from "./util/prompt.js";
import { runSingle } from "./modes/single.js";
import { runMulti } from "./modes/multi.js";

export function registerSddLoop(pi: ExtensionAPI): void {
  pi.registerCommand("sdd-loop", {
    description: "Run Spec Kit SDD loop: specify -> plan -> tasks -> implement",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        try {
          ctx.ui.notify("/sdd-loop requires interactive or RPC mode.", "warning");
        } catch {
          /* no-op in print mode */
        }
        return;
      }

      const commands = pi.getCommands();
      const commandNames = new Set(commands.map((c) => c.name));
      const REQUIRED = [
        "speckit.specify",
        "speckit.plan",
        "speckit.tasks",
        "speckit.implement",
      ] as const;
      const missing = REQUIRED.filter((name) => !commandNames.has(name));
      if (missing.length > 0) {
        ctx.ui.notify(
          "Spec Kit commands not detected: " + missing.join(", ") + ".",
          "warning",
        );
        const proceed = await ctx.ui.confirm(
          "Continue anyway?",
          "Without all /speckit.* phases the loop may skip steps " +
            "(the missing commands are sent as literal text and ignored).",
        );
        if (!proceed) return;
      }

      const mode = await pickMode(ctx);
      if (!mode) {
        ctx.ui.notify("Cancelled.", "info");
        return;
      }

      const availableCommands = pi.getCommands().map((c) => c.name);

      if (mode === "single") {
        await runSingle(pi, ctx, availableCommands);
      } else {
        await runMulti(ctx, availableCommands);
      }
    },
  });
}