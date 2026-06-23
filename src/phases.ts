import type { SessionRunner } from "./runner.js";

export const PHASES = ["specify", "plan", "tasks", "implement"] as const;
export type Phase = (typeof PHASES)[number];

export interface FeatureInput {
  prd: string;
  technicalView: string;
}

/**
 * Run the four Spec Kit phases in order, awaiting idle between each. PRD and
 * Technical view are appended after the slash command (Spec Kit commands accept
 * free-text args). `/speckit.tasks` and `/speckit.implement` take no args.
 *
 * Phases are delivered as user messages so Pi's input pipeline expands the
 * `/speckit.*` slash commands exactly as if the user typed them.
 */
export async function runPipeline(
  runner: SessionRunner,
  input: FeatureInput,
  opts: { onPhase?: (p: Phase) => void } = {},
): Promise<void> {
  const steps: Array<{ phase: Phase; message: string }> = [
    { phase: "specify", message: buildSpecify(input.prd) },
    { phase: "plan", message: buildPlan(input.technicalView) },
    { phase: "tasks", message: "/speckit.tasks" },
    { phase: "implement", message: "/speckit.implement" },
  ];

  for (const step of steps) {
    opts.onPhase?.(step.phase);
    await runner.send(step.message);
    await runner.waitForIdle();
  }
}

function buildSpecify(prd: string): string {
  const body = prd.trim();
  return body ? `/speckit.specify ${body}` : "/speckit.specify";
}

function buildPlan(tech: string): string {
  const body = tech.trim();
  return body ? `/speckit.plan ${body}` : "/speckit.plan";
}