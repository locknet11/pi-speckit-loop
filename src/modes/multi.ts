import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { readIfExists } from "../util/fs.js";
import {
  DEFAULT_TEMPLATE,
  scaffoldProjectSpec,
} from "../spec/template.js";
import { parseProjectSpec, type Feature, type FeatureStatus } from "../spec/parser.js";
import { setStatusByIndex } from "../spec/status.js";
import { runnerFromRepl } from "../runner.js";
import { runPipeline } from "../phases.js";

export { DEFAULT_TEMPLATE, scaffoldProjectSpec };

const PROJECT_SPEC = "PROJECT_SPEC.md";

export async function runMulti(
  ctx: ExtensionCommandContext,
  availableCommands?: string[],
): Promise<void> {
  const path = join(ctx.cwd, PROJECT_SPEC);
  const text = await readIfExists(path);
  if (text === undefined) {
    await scaffoldProjectSpec(path);
    ctx.ui.notify(
      `Created ${PROJECT_SPEC}. Fill in the features and re-run /sdd-loop.`,
      "info",
    );
    return;
  }

  const features = parseProjectSpec(text);
  if (features.length === 0) {
    ctx.ui.notify(`No features found in ${PROJECT_SPEC}.`, "warning");
    return;
  }

  const remaining = features.filter((f) => f.status !== "COMPLETED");
  if (remaining.length === 0) {
    ctx.ui.notify("All features already COMPLETED.", "info");
    return;
  }

  ctx.ui.notify(
    `SDD loop: ${remaining.length} of ${features.length} feature(s) to process.`,
    "info",
  );

  await runFeatureChain(ctx, path, features, 0, availableCommands);
}

/**
 * Recursively process outstanding features, opening a fresh session per feature.
 *
 * Important session-replacement rules (see Pi docs "Session replacement
 * lifecycle and footguns"):
 *  - After `ctx.newSession`, the outer `ctx` is stale; only use the `repl`
 *    passed to `withSession` for session-bound work.
 *  - Capture plain data (parentSession string, features array, path) before
 *    replacement; these survive.
 *  - Thread the *current* context forward: after a feature completes inside its
 *    `withSession`, recurse using `repl` as the new outer ctx for the next
 *    feature.
 */
async function runFeatureChain(
  ctx: ExtensionCommandContext,
  path: string,
  features: Feature[],
  startIndex: number,
  availableCommands?: string[],
): Promise<void> {
  let i = startIndex;
  while (i < features.length && features[i]!.status === "COMPLETED") i++;
  if (i >= features.length) {
    ctx.ui.notify("All features completed. SDD loop done.", "info");
    return;
  }

  const feature = features[i]!;
  const parentSession = ctx.sessionManager.getSessionFile();

  await setStatusByIndex(path, i, "IN_PROGRESS");
  feature.status = "IN_PROGRESS";

  let result: { cancelled?: boolean };
  try {
    result = await ctx.newSession({
      parentSession,
      withSession: async (repl) => {
        const runner = runnerFromRepl(repl);
        const label = feature.name || `feature #${i}`;
        await runPipeline(
          runner,
          { prd: feature.prd, technicalView: feature.technicalView, label },
          { availableCommands },
        );
        await setStatusByIndex(path, i, "COMPLETED");
        feature.status = "COMPLETED";
        // Thread the current replacement ctx forward to the next feature.
        await runFeatureChain(repl, path, features, i + 1, availableCommands);
      },
    });
  } catch (err) {
    ctx.ui.notify(
      `Feature "${feature.name || `#${i}`}" failed: ${(err as Error).message}. ` +
        `Status left IN_PROGRESS; re-run /sdd-loop to resume.`,
      "error",
    );
    return;
  }

  if (result?.cancelled) {
    ctx.ui.notify("Session replacement cancelled; loop stopped.", "warning");
  }
}

// Re-export for tests and external tooling.
export { setStatusByIndex };
export type { Feature, FeatureStatus };