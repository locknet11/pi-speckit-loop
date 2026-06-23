import type { SessionRunner } from "./runner.js";

export const PHASES = ["specify", "plan", "tasks", "implement"] as const;
export type Phase = (typeof PHASES)[number];

export interface FeatureInput {
  prd: string;
  technicalView: string;
}

/** Runner with optional live notification of each phase start. */
export interface PipelineHooks {
  onPhase?: (p: Phase) => void;
}

/** Commands the SDD loop relays to the agent for each phase. */
export const PHASE_COMMANDS = {
  specify: "/speckit.specify",
  plan: "/speckit.plan",
  tasks: "/speckit.tasks",
  implement: "/speckit.implement",
} as const;

/**
 * Run the four Spec Kit phases in order, awaiting idle between each. PRD and
 * Technical view are appended after the slash command (Spec Kit commands accept
 * free-text args). `/speckit.tasks` and `/speckit.implement` take no args.
 *
 * Phases are delivered as user messages so Pi's input pipeline expands the
 * `/speckit.*` slash commands exactly as if the user typed them. Each phase is
 * announced via `runner.notify(...)` so the user can see it dispatch in the TUI,
 * including `/speckit.tasks` which can otherwise run very briefly.
 */
export async function runPipeline(
  runner: SessionRunner,
  input: FeatureInput,
  opts: PipelineHooks & { availableCommands?: Iterable<string> } = {},
): Promise<void> {
  const available = opts.availableCommands
    ? new Set(opts.availableCommands)
    : undefined;

  const steps: Array<{ phase: Phase; message: string; announce: string }> = [
    { phase: "specify", message: buildSpecify(input.prd), announce: "SDD: /speckit.specify" },
    { phase: "plan", message: buildPlan(input.technicalView), announce: "SDD: /speckit.plan" },
    { phase: "tasks", message: "/speckit.tasks", announce: "SDD: /speckit.tasks" },
    { phase: "implement", message: "/speckit.implement", announce: "SDD: /speckit.implement" },
  ];

  for (const step of steps) {
    // If we have the live command list, surface a missing phase loudly instead
    // of silently sending a literal string the agent will ignore.
    if (available && !available.has(PHASE_COMMANDS[step.phase])) {
      runner.notify(
        `${step.announce} is NOT a registered command — skipping silently would break the loop. ` +
          `Stopping. Install/configure Spec Kit, then re-run /sdd-loop.`,
        "error",
      );
      throw new Error(
        `Spec Kit command not registered: ${PHASE_COMMANDS[step.phase]}`,
      );
    }

    runner.notify(step.announce, "info");
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