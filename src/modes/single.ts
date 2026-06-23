import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { askMultiline } from "../util/prompt.js";
import { runnerFromCommand } from "../runner.js";
import { runPipeline } from "../phases.js";

export async function runSingle(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  availableCommands?: string[],
): Promise<void> {
  const prd = await askMultiline(
    ctx,
    "PRD",
    "Describe WHAT and WHY to build (no tech stack yet)...",
  );
  if (prd === undefined) {
    ctx.ui.notify("Cancelled.", "info");
    return;
  }

  const technicalView = await askMultiline(
    ctx,
    "Technical view",
    "Tech stack & architecture choices...",
  );
  if (technicalView === undefined) {
    ctx.ui.notify("Cancelled.", "info");
    return;
  }

  try {
    pi.setSessionName("sdd: single-feature");
  } catch {
    /* naming is best-effort */
  }

  const runner = runnerFromCommand(pi, ctx);
  ctx.ui.notify("Starting single-feature SDD...", "info");
  const commands = availableCommands ?? pi.getCommands().map((c) => c.name);

  try {
    await runPipeline(runner, { prd, technicalView }, { availableCommands: commands });
    ctx.ui.notify("Single-feature SDD complete.", "info");
  } catch (err) {
    ctx.ui.notify(`SDD failed: ${(err as Error).message}`, "error");
  }
}