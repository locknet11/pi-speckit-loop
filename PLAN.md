# PLAN.md — pi-speckit-loop implementation plan

Concrete, file-by-file implementation plan. Authority order:
1. Code reality (run `pi -e ./src/index.ts`).
2. Pi [`extensions.md`](https://pi.dev/docs/latest/extensions).
3. [`AGENTS.md`](./AGENTS.md) (design/behaviour).
4. This file.

Pre-load checklist (do once before coding):
- Skim `extensions.md` §Custom Commands, §`sendUserMessage`, §Session replacement
  lifecycle and footguns, §`ExtensionContext`, §`ExtensionCommandContext`.
- Skim examples `handoff.ts`, `send-user-message.ts`, `pirate.ts`, `commands.ts`.

---

## 0. Verified API assumptions (re-confirm at step 1)

| Fact | Source | Plan impact |
|------|--------|-------------|
| `pi.registerCommand(name, { description, handler })` and `ctx` is `ExtensionCommandContext` with `waitForIdle`, `newSession`, `fork`, `switchSession`, `reload`. | extensions.md §ExtensionCommandContext | defines session-control surface |
| `ReplacedSessionContext` (the `withSession` arg) extends `ExtensionCommandContext` **and** adds async `sendUserMessage()` / `sendMessage()`. | extensions.md newSession / footguns | multi-feature sends via `repl.sendUserMessage`, not `pi.sendUserMessage` (pi is stale post-replacement) |
| After `ctx.newSession(...)`, the old `ctx` and module-scope `pi` are **stale** for session-bound ops. Plain data (strings, arrays, file paths) is safe. | extensions.md footguns | multi-feature must thread the replacement ctx forward; PROJECT_SPEC.md writes are plain fs (not session-bound) so safe |
| `pi.sendUserMessage(text)` triggers a turn; resolves on dispatch, **not** on turn completion → pair with `waitForIdle()`. | send-user-message.ts | pipeline waits for idle after every phase |
| Slash commands in injected user messages expand through Pi's input pipeline (extension commands → input event → skills → prompt templates). | extensions.md §input | phases are relayed as `/speckit.* ...` user messages |
| `ctx.ui.select/confirm/input/editor/notify` work in TUI and RPC (`ctx.hasUI`); `custom()` is TUI-only. | extensions.md §Custom UI / Mode behavior | guard dialogs with `ctx.hasUI`; never use `ctx.ui.custom` |
| No new runtime deps; `node:fs/promises`, `node:path`, `typebox`, `node:test` are available. | extensions.md §Available Imports | zero-dependency extension |

If any assumption fails at step 1, revise the affected module here before coding.

---

## 1. Layout

```
pi-speckit-loop/
├── README.md
├── AGENTS.md
├── PLAN.md
├── package.json            # { "name","type":"module","pi":{ "extensions":["./src/index.ts"] } }
├── tsconfig.json           # strict, ESM, NodeNext
├── src/
│   ├── index.ts            # factory: registers /sdd-loop (and v2 hooks)
│   ├── command.ts          # /sdd-loop handler: mode pick → dispatch
│   ├── phases.ts           # PHASES config + runPipeline()
│   ├── runner.ts           # SessionRunner abstraction + builders
│   ├── modes/
│   │   ├── single.ts       # interactive 2-step + one-shot pipeline
│   │   └── multi.ts         # parse/scaffold + per-feature newSession loop
│   ├── spec/
│   │   ├── parser.ts       # parse PROJECT_SPEC.md -> Feature[]
│   │   ├── status.ts       # surgical in-place status edit (preserves body)
│   │   └── template.ts     # DEFAULT_TEMPLATE + scaffoldProjectSpec()
│   └── util/
│       ├── fs.ts           # readIfExists, atomicWrite
│       └── prompt.ts       # pickMode, askMultiline
└── test/
    ├── parser.test.ts
    ├── status.test.ts
    └── pipeline.test.ts    # runPipeline with a fake runner
```

Rationale for splitting (vs single file): parser/status/runner/pipeline are
pure-ish and unit-testable without Pi; the orchestrator becomes a thin shell.
This matches AGENTS.md §3.

---

## 2. Data structures

`src/spec/parser.ts` and `src/spec/status.ts` share:

```ts
export type FeatureStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export interface Feature {
  index: number;          // 0-based block position; the only stable key
  name: string;           // frontmatter `feature:` value ("" if absent)
  status: FeatureStatus;  // frontmatter `status:` value (PENDING if absent)
  prd: string;            // body of `## PRD`
  technicalView: string;  // body of `## Technical view`
  additionalInfo: string; // body of `## Additional info`
}
```

`index` (not `name`) is the key because names can change/dupe; we only ever
mutate the `status` line in place, keyed by block index.

`src/runner.ts`:

```ts
export interface SessionRunner {
  send(message: string): Promise<void>;
  waitForIdle(): Promise<void>;
  notify(text: string, level: "info" | "warning" | "error"): void;
  cwd: string;
}
```

Two builders:
- `runnerFromCommand(pi, ctx)` → `{ send: (m) => pi.sendUserMessage(m), waitForIdle: () => ctx.waitForIdle(), notify: (t,l) => ctx.ui.notify(t,l), cwd: ctx.cwd }`
- `runnerFromRepl(repl)` → uses `repl.sendUserMessage` and `repl.waitForIdle` (pi is stale after replacement)

`src/phases.ts`:

```ts
export const PHASES = [
  "specify", "plan", "tasks", "implement",
] as const;
export type Phase = (typeof PHASES)[number];

export interface FeatureInput { prd: string; technicalView: string; }

export async function runPipeline(
  runner: SessionRunner,
  input: FeatureInput,
  opts?: { onPhase?: (p: Phase) => void },
): Promise<void>;
```

Pipeline body:

```
runner.send(`/speckit.specify ${input.prd}`)  → runner.waitForIdle()
runner.send(`/speckit.plan ${input.technicalView}`) → runner.waitForIdle()
runner.send("/speckit.tasks")                       → runner.waitForIdle()
runner.send("/speckit.implement")                   → runner.waitForIdle()
```

PRD/Technical view text is appended after the command (Spec Kit commands accept
free-text args; see README examples). Multi-line strings are fine as user
message text.

---

## 3. Module contracts

### `src/util/fs.ts`
- `readIfExists(path): Promise<string | undefined>`
- `atomicWrite(path, content): Promise<void>` — write to `path + ".tmp"` then `rename`. Mkdir-p parent.

### `src/util/prompt.ts`
- `pickMode(ctx): Promise<"single" | "multi" | undefined>` — `ctx.ui.select("SDD mode:", ["single-feature","multi-feature"])`. Return `undefined` on cancel/Esc. Guard `ctx.hasUI`.
- `askMultiline(ctx, label, placeholder): Promise<string | undefined>` — `ctx.ui.editor(label, placeholder)`. Empty string after trim → treat as `undefined` (no input). Multi-line because PRD/tech are long.

### `src/spec/template.ts`
- `DEFAULT_TEMPLATE: string` — verbatim two-feature block from README (`---\nfeature: Feature 1\nstatus: PENDING | IN_PROGRESS | COMPLETED\n---\n\n## PRD\n...`).
   - **Open decision Q-A:** the template's literal `status: PENDING | IN_PROGRESS | COMPLETED` shows all three options as the convention; the parser reads the **current concrete** value. Scaffold keeps the literal text; first parse will read `PENDING` only if we treat `|...` as garbage. **Decision:** scaffold template lines must be concrete so the scaffold is immediately runnable. Replace each section's `status:` line with `status: PENDING` in `DEFAULT_TEMPLATE`, and put the `| IN_PROGRESS | COMPLETED` legend in a comment line above the first block? Markdown has no comments. **Resolution:** keep the doc's template verbatim in README (as documentation) but make `DEFAULT_TEMPLATE` use `status: PENDING` concretely. Document this divergence above `DEFAULT_TEMPLATE`.
- `scaffoldProjectSpec(path): Promise<void>` — `atomicWrite(path, DEFAULT_TEMPLATE)`.

### `src/spec/parser.ts`
- `parseProjectSpec(text: string): Feature[]` — line-based parser:
  1. Treat a line matching `^---\s*$` as a delimiter.
  2. A block = frontmatter (lines between an opening `---` and the next `---`) + body (lines until the next opening `---` or EOF).
  3. Frontmatter: each `key: value` line; capture `feature` (raw value, trimmed) and `status` (uppercased; mapped to the enum; unknown → `PENDING`). Absent `status` → `PENDING`. Absent `feature` → `""`.
  4. Body: split into sections by top-level `## ` headings. Map `## PRD`→prd, `## Technical view`→technicalView, `## Additional info`→additionalInfo. Unknown headings: ignore for v1. Trim each section; keep internal newlines.
  5. Blocks with no frontmatter at all (e.g. stray `---` HR) are skipped (no `feature:` line and no headings) — tolerant.
  6. `index` = block ordinal among parsed blocks.
- Edge cases to handle: no delimiters at all (whole file parsed as one feature with empty frontmatter); CRLF (\r); leading/trailing blank lines; BOM.
- **No YAML dep.** Hand-rolled.

### `src/spec/status.ts`
- `setStatusByIndex(path: string, index: number, newStatus: FeatureStatus): Promise<void>`:
  1. `readIfExists` → text (throw if missing).
  2. Line scan counting frontmatter blocks (same delimiter rule as parser). Locate the n-th block's frontmatter span.
  3. Within that span: replace the first line matching `^status:\s*.*$` with `status: ${newStatus}`. If none exists, insert a `status:` line right after the block's opening `---`.
  4. `atomicWrite(path, newText)`.
  - Why surgical and not full re-serialize: preserve the user's body formatting/sections we don't model (per AGENTS.md §5 "never reorder, only update status").

### `src/runner.ts`
- Types + two builders above. Pure.

### `src/phases.ts`
- `PHASES`, `Phase`, `FeatureInput`, `runPipeline`. Pure except it calls `runner`.

### `src/modes/single.ts`
- `runSingle(pi, ctx): Promise<void>`:
  1. `prd = await askMultiline(ctx, "PRD", "Describe WHAT and WHY to build (no tech stack)...")`. If `undefined`/empty → `ctx.ui.notify("Cancelled","info")`, return.
  2. `tech = await askMultiline(ctx, "Technical view", "Tech stack & architecture choices...")`. Same cancellation handling.
  3. `runner = runnerFromCommand(pi, ctx)`.
  4. `ctx.ui.setSessionName?.("sdd: single-feature")` — only if available on pi; wrap in try/catch (naming is best-effort, see Open Q #3).
  5. `ctx.ui.notify("Starting single-feature SDD...","info")`.
  6. `await runPipeline(runner, { prd, technicalView: tech })`.
  7. `ctx.ui.notify("Single-feature SDD complete.","info")`.
  - On thrown error: `ctx.ui.notify(\`SDD failed: ${e.message}\`,"error")`; do not swallow beyond notifying.

### `src/modes/multi.ts`
- `runMulti(pi, ctx): Promise<void>`:
  ```
  path = join(ctx.cwd, "PROJECT_SPEC.md")
  text = await readIfExists(path)
  if (!text) { await scaffoldProjectSpec(path); ctx.ui.notify("PROJECT_SPEC.md created — fill it and re-run /sdd-loop","info"); return }
  features = parseProjectSpec(text)
  pending = features.filter(f => f.status !== "COMPLETED")
  if (pending.length === 0) { ctx.ui.notify("All features already COMPLETED.","info"); return }
  await runFeatureChain({ pi, ctx, path, features, startIndex: 0 })
  ```

- `runFeatureChain({ pi, ctx, path, features, startIndex }): Promise<void>`:
  ```
  // advance to next non-COMPLETED, updating startIndex in place
  let i = startIndex
  while (i < features.length && features[i].status === "COMPLETED") i++
  if (i >= features.length) { ctx.ui.notify("All features completed. SDD loop done.","info"); return }

  const feature = features[i]
  await setStatusByIndex(path, i, "IN_PROGRESS")
  feature.status = "IN_PROGRESS"
  const parentSession = ctx.sessionManager.getSessionFile()  // capture BEFORE replacement

  try {
    const result = await ctx.newSession({
      parentSession,
      withSession: async (repl) => {
        const runner = runnerFromRepl(repl)
        repl.ui.notify(`SDD: ${feature.name || "feature #"+i} — specify→plan→tasks→implement`,"info")
        await runPipeline(runner, { prd: feature.prd, technicalView: feature.technicalView })
        await setStatusByIndex(path, i, "COMPLETED")      // fs write: safe across sessions
        feature.status = "COMPLETED"
        // thread the CURRENT replacement ctx forward
        await runFeatureChain({ pi: undefined as any, ctx: repl, path, features, startIndex: i + 1 })
      },
    })
    if (result.cancelled) ctx.ui.notify("Session replacement cancelled; loop stopped.","warning")
  } catch (e) {
    ctx.ui.notify(`Feature "${feature.name}" failed: ${e.message}. Status left IN_PROGRESS.`,"error")
    // stop the chain; feature stays IN_PROGRESS → re-run resumes it
  }
  ```

  Notes:
  - `pi` is unused inside `withSession` (stale). The `undefined as any` is a smell — better: make `runFeatureChain` not take `pi` at all (it never uses it post-replacement). Drop `pi` from the params; only the outer caller needs `pi` for nothing. **Decision:** remove `pi` from `runFeatureChain`; the only Pi API used session-boundly is via the ctx. Keep `PI` only if a future naming hook needs it.
  - `parentSession` captured as a plain string before `newSession` — safe.
  - Nested `newSession` keeps us always in the most-recent session; each `withSession` receives the fresh ctx → correct session-bound calls.
  - `setStatusByIndex` uses plain fs → unaffected by session replacement.

### `src/command.ts`
```
export function registerSddLoop(pi: ExtensionAPI): void {
  pi.registerCommand("sdd-loop", {
    description: "Run Spec Kit SDD loop: specify→plan→tasks→implement",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI || ctx.mode === "json" || ctx.mode === "print") {
        // can't prompt; notify (no-op in print/json) and bail
        try { ctx.ui.notify("/sdd-loop requires interactive or RPC mode.","warning"); } catch {}
        return
      }
      const mode = await pickMode(ctx)
      if (!mode) { ctx.ui.notify("Cancelled.","info"); return }
      if (mode === "single") await runSingle(pi, ctx)
      else await runMulti(pi, ctx)
    },
  })
}
```
Note: RPC supports dialogs but not `custom` (we don't use it) and slash-command
relay may behave differently over RPC — flag as Open Q #4; default to allow RPC.

### `src/index.ts`
```
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSddLoop } from "./command.ts";

export default function (pi: ExtensionAPI) {
  registerSddLoop(pi);
  // v2: session_start hook to name replacement sessions (Open Q #3)
}
```

### `package.json`
```json
{
  "name": "pi-speckit-loop",
  "version": "0.1.0",
  "type": "module",
  "pi": { "extensions": ["./src/index.ts"] }
}
```
No `dependencies` or `devDependencies` required (use stock `node:test`).

---

## 4. Build sequence (with acceptance criteria)

Each step ends with "Definition of Done"; advance only when DoD passes. Mirror
these as `todo` tasks in the tracker (see §8).

**Step 1 — Repo bootstrap.**
Files: `package.json`, `tsconfig.json`, `src/index.ts` (stub factory), `src/command.ts` (register `/sdd-loop` that just notifies).
DoD: `pi -e ./src/index.ts` then `/sdd-loop` shows the notify without errors.

**Step 2 — `util/fs.ts` + `util/prompt.ts`.**
DoD: `pickMode` returns the chosen label; `readIfExists`/`atomicWrite` round-trip a temp file. No Pi needed for fs; prompt needs a live `ctx` — smoke manually.

**Step 3 — `spec/template.ts` + parser + status.**
Files: `spec/template.ts`, `spec/parser.ts`, `spec/status.ts`.
DoD: `test/parser.test.ts` and `test/status.test.ts` green (`node --test`). Cases:
- parse the scaffold template → 2 features, both `PENDING`, empty sections.
- parse a file with an `IN_PROGRESS` block (resume scenario) and an unknown-status block.
- `setStatusByIndex` flips block 0 PENDING→IN_PROGRESS and **only** changes that one line; bytes of every other line unchanged (assert via comparison of unchanged line arrays).
- CRLF and BOM tolerance.
- No frontmatter → one feature, status PENDING.

**Step 4 — `runner.ts` + `phases.ts` + `pipeline.test.ts`.**
DoD: fake runner records `["/speckit.specify ...","/speckit.plan ...","/speckit.tasks","/speckit.implement"]` and each `send` is followed by a `waitForIdle`. Order asserted.

**Step 5 — single-feature end to end.**
Wire `modes/single.ts` into `command.ts`.
DoD: in a Spec-Kit-initialized throwaway project, run `pi -e ./src/index.ts`, `/sdd-loop` → single-feature → paste PRD + tech → observe the four `/speckit.*` phases execute in order and produce spec artifacts (`specs/`, `plan.md`, `tasks.md` per Spec Kit conventions).

**Step 6 — multi-feature orchestration.**
Files: `modes/multi.ts`; wire into `command.ts`. Scaffold-on-missing path first.
DoD:
- Missing `PROJECT_SPEC.md` → file created, notify shown, loop stops.
- Existing all-`PENDING` 3-feature file → 3 sessions created (verify via `/sessions` or session list), each runs the 4 phases, and `PROJECT_SPEC.md` ends with 3 `COMPLETED` blocks.
- Mid-run Ctrl+C leaves the active feature `IN_PROGRESS`; re-running `/sdd-loop` resumes only outstanding features (the `COMPLETED` ones are skipped).

**Step 7 — Hardening + docs.**
- Confirm slash-command expansion really fires for injected messages (Open Q #1); if not, fall back to `sendUserMessage("<command text>")` after sending the Spec Kit prompt inline — document the fallback in `phases.ts`.
- Atomic writes; status surgical-edit idempotency on re-runs.
- README install/usage finalized; bump roadmap.
- `pi install` smoke (local path) once packaging is settled.
DoD: 2 sequential multi-feature runs from a clean scaffold complete without manual intervention and leave the repo in a valid git-committable state per feature.

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `/speckit.*` not expanded for extension-injected messages (Open Q #1). | med | Verify at Step 5. Fallback: `repl.sendUserMessage` the prompt template body inline. |
| `newSession` chaining mis-threads ctx → "stale ctx" throw. | med | Never capture `ctx`/`pi` across `newSession`; pass `repl` forward; thread `startIndex`. Add Step 6 assertion that ≥2 sessions are actually created. |
| Surgical status edit targets wrong block after user edits file mid-loop. | low–med | Re-read file inside `setStatusByIndex` each call (we already do). Lock not needed (single user). Document "do not hand-edit PROJECT_SPEC.md mid-loop". |
| Context still saturates within a single feature's session for huge PRDs. | low | Out of scope v1; `/speckit.analyze` + per-phase gates in v2 (AGENTS.md §4 open Q #4). |
| Spec Kit not installed → `/speckit.*` no-ops or errors. | med | Step 5 prerequisite: require Spec Kit. Optionally Step 1 detect via `pi.getCommands()` and warn if no `/speckit.specify` present. |
| RPC/print modes reach dialog code → throw. | low | Guard at command entry (Step 5). |

---

## 6. Out of scope (v1) — explicit defer

- `/speckit.clarify` / `/speckit.checklist` / `/speckit.analyze` quality gates.
- Per-feature verification sub-agent / implement→patch loop beyond Spec Kit's own `/speckit.implement`.
- Naming replacement sessions (needs a `session_start` sidecar; Open Q #3) — v2.
- Parallel feature sessions — v1 is strictly sequential (fresh context, one at a time).
- Custom tool registration — none.

---

## 7. Open questions to resolve during build

1. Do `/speckit.*` commands expand for `sendUserMessage`-injected messages in this Pi/Spec-Kit setup? Verify Step 5; else use the inline fallback.
2. Does `ReplacedSessionContext.sendUserMessage` await full turn completion? If yes, `waitForIdle` becomes optional; keep it regardless for safety.
3. Naming replacement sessions — defer to v2 (sidecar + `session_start` hook).
4. Permit `/sdd-loop` over RPC? Default allow (dialogs work); revisit if slash-command relay misbehaves over RPC.