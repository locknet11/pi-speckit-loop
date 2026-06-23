import type { SessionRunner } from "./runner.js";

export const PHASES = ["specify", "plan", "tasks", "implement"] as const;
export type Phase = (typeof PHASES)[number];

export interface FeatureInput {
  prd: string;
  technicalView: string;
  /** Optional label shown in the footer status (e.g. the feature name). */
  label?: string;
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

const PHASE_ORDER: Record<Phase, number> = {
  specify: 1,
  plan: 2,
  tasks: 3,
  implement: 4,
};

/**
 * Run the four Spec Kit phases in order, awaiting idle between each. PRD and
 * Technical view are appended after the slash command (Spec Kit commands accept
 * free-text args). `/speckit.tasks` and `/speckit.implement` take no args.
 *
 * Phases are delivered as user messages so Pi's input pipeline expands the
 * `/speckit.*` slash commands exactly as if the user typed them. Each phase is:
 *  - announced via `runner.notify(...)` (toast),
 *  - shown persistently in the footer via `runner.setStatus(...)` and left there
 *    until the next phase starts. This is especially useful for /speckit.tasks,
 *    which (a template paste + a single short assistant turn) can otherwise be
 *    too brief to notice.
 *
 * The status is cleared when the pipeline ends (success or failure).
 */
export async function runPipeline(
  runner: SessionRunner,
  input: FeatureInput,
  opts: PipelineHooks & { availableCommands?: Iterable<string> } = {},
): Promise<void> {
  const available = opts.availableCommands
    ? new Set(opts.availableCommands)
    : undefined;
  const prefix = input.label ? `[SDD ${input.label}] ` : "[SDD] ";

  const steps: Array<{ phase: Phase; message: string }> = [
    { phase: "specify", message: buildSpecify(input.prd) },
    { phase: "plan", message: buildPlan(input.technicalView) },
    { phase: "tasks", message: "/speckit.tasks" },
    { phase: "implement", message: "/speckit.implement" },
  ];

  try {
    for (const step of steps) {
      // If we have the live command list, surface a missing phase loudly instead
      // of silently sending a literal string the agent will ignore.
      // pi.getCommands() returns names WITHOUT a leading slash; strip ours to match.
      const cmdName = PHASE_COMMANDS[step.phase].replace(/^\//, "");
      if (available && !available.has(cmdName) && !available.has(PHASE_COMMANDS[step.phase])) {
        runner.notify(
          `${PHASE_COMMANDS[step.phase]} is NOT a registered command — stopping. ` +
            `Install/configure Spec Kit, then re-run /sdd-loop.`,
          "error",
        );
        throw new Error(
          `Spec Kit command not registered: ${PHASE_COMMANDS[step.phase]}`,
        );
      }

      const status = `${prefix}phase ${PHASE_ORDER[step.phase]}/4 ${PHASE_COMMANDS[step.phase]}`;
      runner.setStatus(status);
      runner.notify(`${prefix}${PHASE_COMMANDS[step.phase]}`, "info");
      opts.onPhase?.(step.phase);
      await runner.send(step.message);
      await runner.waitForIdle();
    }
  } finally {
    // Clear the footer status whether the pipeline succeeded or threw.
    runner.setStatus(undefined);
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