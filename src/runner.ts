import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface SessionRunner {
  /**
   * Send a user message (e.g. a slash command + args) to the agent. Resolves on
   * dispatch, not on turn completion. Pair with waitForIdle().
   */
  send(message: string): Promise<void>;
  /** Wait until the agent stops streaming. */
  waitForIdle(): Promise<void>;
  notify(text: string, level: "info" | "warning" | "error"): void;
  cwd: string;
}

/**
 * Minimal structural shape of a `ReplacedSessionContext` (post `ctx.newSession`).
 * We use a local interface because `ReplacedSessionContext` is not part of the
 * public exports of `@earendil-works/pi-coding-agent`; the real context is
 * structurally assignable to this interface.
 */
export interface ReplacementContext {
  sendUserMessage(
    content: string,
    options?: { deliverAs?: "steer" | "followUp" },
  ): Promise<unknown>;
  waitForIdle(): Promise<unknown>;
  ui: { notify(text: string, level: "info" | "warning" | "error"): void };
  cwd: string;
}

/** Runner bound to the current command session (single-feature mode). */
export function runnerFromCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): SessionRunner {
  return {
    async send(message) {
      pi.sendUserMessage(message);
    },
    async waitForIdle() {
      await ctx.waitForIdle();
    },
    notify(text, level) {
      ctx.ui.notify(text, level);
    },
    cwd: ctx.cwd,
  };
}

/**
 * Runner bound to a replacement-session context (post `ctx.newSession`). MUST be
 * built from the `repl` passed to `withSession`; the outer `pi`/`ctx` are stale.
 *
 * `ReplacedSessionContext.sendUserMessage` awaits the full turn, but we still
 * call `waitForIdle()` afterward for ordering safety across phases.
 */
export function runnerFromRepl(repl: ReplacementContext): SessionRunner {
  return {
    async send(message) {
      await repl.sendUserMessage(message);
    },
    async waitForIdle() {
      await repl.waitForIdle();
    },
    notify(text, level) {
      repl.ui.notify(text, level);
    },
    cwd: repl.cwd,
  };
}