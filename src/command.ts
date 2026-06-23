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
      const speckitPresent = commands.some(
        (c) => c.name === "speckit.specify" || c.name === "speckit.implement",
      );
      if (!speckitPresent) {
        ctx.ui.notify(
          "Spec Kit slash commands (/speckit.*) not detected. " +
            "Install github/spec-kit for your coding agent before running /sdd-loop.",
          "warning",
        );
        const proceed = await ctx.ui.confirm(
          "Continue anyway?",
          "The Spec Kit phases may not expand/run as user messages.",
        );
        if (!proceed) return;
      }

      const mode = await pickMode(ctx);
      if (!mode) {
        ctx.ui.notify("Cancelled.", "info");
        return;
      }

      if (mode === "single") {
        await runSingle(pi, ctx);
      } else {
        await runMulti(ctx);
      }
    },
  });
}