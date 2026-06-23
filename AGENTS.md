# AGENTS.md — pi-speckit-loop

Operating guide and implementation plan for any agent (human or LLM) working in
this repo. Read this **before** writing code.

---

## 1. Project goal

Build a [Pi](https://pi.dev/docs/latest/extensions) extension that automates
[GitHub Spec Kit](https://github.com/github/spec-kit) Spec-Driven Development
plus a custom **Ralph Wiggum loop**, triggered by a single slash command:
`/sdd-loop`.

`/sdd-loop` prompts the user to select a mode, then runs the Spec Kit pipeline —
`/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement` —
until all tasks are completed.

Pi extension docs (root of all authority for this project):
`<pi pkg>/docs/extensions.md`. Run `read` on it when you need an API reference.
Key examples: `handoff.ts` (session replacement + new context), `send-user-message.ts`
(injecting user messages / slash commands), `pirate.ts` and `plan-mode/`
(commands + system prompt), `commands.ts` (command registration).

## 2. Behaviour spec

### 2.1 Entry point: `/sdd-loop`

- Registered via `pi.registerCommand("sdd-loop", { ... })`.
- On invoke, show a mode picker using `ctx.ui.select`:
  - `single-feature`
  - `multi-feature`
- `ctx.mode !== "tui"`: notify `"sdd-loop requires interactive mode"` and return.

### 2.2 single-feature mode

Interactive, step by step, in the **current session** (one shot):

1. Prompt PRD via `ctx.ui.input` or `ctx.ui.editor` (multiline preferred).
2. Prompt Technical view the same way.
3. Relay the four Spec Kit phases as user messages, awaiting idle between each:

```ts
pi.sendUserMessage(`/speckit.specify ${prd}`);
await ctx.waitForIdle();
pi.sendUserMessage(`/speckit.plan ${technicalView}`);
await ctx.waitForIdle();
pi.sendUserMessage("/speckit.tasks");
await ctx.waitForIdle();
pi.sendUserMessage("/speckit.implement");
await ctx.waitForIdle();
```

> Phase content (PRD / Technical view) is passed as the message text after the
> command. Pi expands slash commands before the agent loop, so `/speckit.*`
> runs exactly as if the user typed it.

### 2.3 multi-feature mode

Driven by `PROJECT_SPEC.md` at the project root. Structure: repeated blocks
delimited by YAML-style frontmatter (`---`), each with `feature` and `status`:

```markdown
---
feature: Feature 1
status: PENDING | IN_PROGRESS | COMPLETED
---

## PRD
...

## Technical view
...

## Additional info
...
```

Flow:

1. If `PROJECT_SPEC.md` does **not** exist:
   - Write the default empty template (see README) to the project root.
   - `ctx.ui.notify` instructing the user to complete it and re-run.
   - `open PROJECT_SPEC.md` is only available in TUI; otherwise just notify the
     path. Do not proceed.
2. If it exists: parse into `Feature[] = { id, name, status, prd, tech, extra }`.
   Ignore delimiter headings that lack a `status` line and treat them as
   `PENDING`.
3. Select features where `status !== "COMPLETED"`, preserving file order.
   - `IN_PROGRESS` features resume from the start of their pipeline (simpler
     and safe: Spec Kit is idempotent-ish; revisit if it causes churn).
4. For each selected feature:
   - Update its `status` to `IN_PROGRESS` and persist `PROJECT_SPEC.md`.
   - Run a **fresh session** for the feature (see §4) through the four phases.
   - On completion, update its `status` to `COMPLETED` and persist.
5. Loop ends when no feature remains non-`COMPLETED`.
   - Use `setSessionName` so each feature session is identifiable in the session list.

> Persist `PROJECT_SPEC.md` via direct `fs` writes (this is a config file, not a
> project artifact the agent edits). Strip the `status` enum options from the
> echoed template when rescaffolding? **No** — keep the literal template verbatim
> in the default scaffold only; on status updates, write the concrete resolved
> value (`PENDING` | `IN_PROGRESS` | `COMPLETED`).

### 2.4 The Ralph Wiggum loop (custom)

"Ralph" = the autonomous iteration driver. In this implementation it is the
`/sdd-loop` orchestrator that:

- schedules each feature sequentially,
- opens fresh context per feature (multi-feature) to avoid context saturation,
- relays each Spec Kit phase as a user message and waits for it to finish,
- tracks completion in `PROJECT_SPEC.md` and resumes outstanding features.

There is **no** retry/verify sub-agent in v1; correctness of implementation
relies on Spec Kit's `/speckit.implement`. A future iteration may add
`/speckit.analyze` as a gate and a feedback loop (implement → verify → patch).
Keep the orchestrator structured so adding gates/loops is a local change.

### 2.5 Mode behavior

| Mode        | supported | notes |
|-------------|-----------|-------|
| tui         | yes       | full interactive flow |
| rpc         | partial   | `ctx.ui.select/input/editor/notify` work over RPC; `ctx.ui.custom` returns `undefined` — we do not use `custom` |
| print (-p)  | no        | guard with `ctx.mode !== "tui" && ctx.mode !== "rpc"`; notify and return |
| json        | no        | same guard |

Use `ctx.hasUI` before any dialog. Use `ctx.ui` themes only via `ctx.ui.theme`.

## 3. Extension layout (planned)

```
pi-speckit-loop/
├── README.md
├── AGENTS.md
├── package.json                 # pi package descriptor (deps + pi key)
├── tsconfig.json
├── src/
│   ├── index.ts                  # default factory: registers /sdd-loop
│   ├── command.ts                # /sdd-loop handler + mode dispatch
│   ├── modes/
│   │   ├── single.ts             # interactive flow + one-shot pipeline
│   │   └── multi.ts              # PROJECT_SPEC.md parse/serialize + per-feature loop
│   ├── spec/
│   │   ├── parser.ts             # parse PROJECT_SPEC.md -> Feature[]
│   │   ├── serializer.ts         # Feature[] -> PROJECT_SPEC.md (preserve order)
│   │   └── template.ts           # default scaffold + PRD/tech section helpers
│   ├── loop.ts                   # runPipelineForFeature (the ralph driver)
│   └── util/
│       ├── fs.ts                 # atomic read/write of PROJECT_SPEC.md
│       └── prompt.ts             # safe wrappers over ctx.ui.* dialogs
└── test/                         # parser/serializer unit tests (node:test)
```

Single-file extension is acceptable for v1, but split modules keep Ralph logic
testable independently of Pi. Prefer the split layout.

### package.json (pi key)

```json
{
  "name": "pi-speckit-loop",
  "type": "module",
  "pi": { "extensions": ["./src/index.ts"] },
  "dependencies": {}
}
```

No runtime npm deps expected. Use `node:fs/promises`, `node:path`, `typebox`
(schema) — all provided by Pi's runtime.

## 4. Session orchestration — the hard part

This is the trickiest area; re-read Pi's
[Session replacement lifecycle and footguns](https://pi.dev/docs/latest/extensions#session-replacement-lifecycle-and-footguns) before touching it.

### 4.1 single-feature

Everything runs in the current session; `ctx` is the command's
`ExtensionCommandContext`. Use `pi.sendUserMessage(...)` + `ctx.waitForIdle()`.

### 4.2 multi-feature — fresh session per feature

Use `ExtensionCommandContext.newSession`. Critical rules from the Pi docs:

- After `newSession`, the original command `ctx` is **stale**. Only use the
  `ctx` passed to `withSession`.
- Captured `pi` bindings are stale for session-bound work; use the replacement
  ctx's `sendUserMessage`/`sendMessage`.
- `withSession` runs after the old session emits `session_shutdown`, the
  replacement runtime rebinds, and the new extension instance receives
  `session_start`. So any session-bound in-memory state captured before
  `newSession` must be re-derived from plain data (the `Feature[]` array is
  fine — it's serializable).

Chaining multiple `newSession` calls for consecutive features: because
control returns to the handler closure after `withSession` resolves and we are
now logically in the last created session, **nest** the next feature's
`newSession` inside the previous feature's `withSession` using the replacement
ctx it provides. Sketch:

```ts
async function runFeatures(
  features: Feature[],
  index: number,
  ctx: ExtensionCommandContext,
) {
  if (index >= features.length) return;
  const feature = features[index];
  await setStatus(feature.id, "IN_PROGRESS");

  await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    withSession: async (repl) => {
      pi_.setSessionName?.(`sdd: ${feature.name}`); // see note
      await runPipeline(repl, feature);             // specify→implement, waitForIdle
      await setStatus(feature.id, "COMPLETED");
      // chase the next feature from inside the now-current session
      await runFeatures(features, index + 1, repl);
    },
  });
}
```

Notes:

- **Do not** capture the module-scope `pi`. Inside `withSession`, send messages
  via `repl.sendUserMessage(...)` (the `ReplacedSessionContext` helper awaits
  delivery). `waitForIdle` is available on `repl`.
- `setSessionName` is on the `ExtensionAPI`. To name a replacement session you
  need the new extension instance's API. Simplest correct approach: name the
  session just after switch by reading the current session via
  `repl.sessionManager.getSessionFile()` and relying on a `session_start` hook
  in this extension that, when it detects a pending feature (encoded in
  `appendEntry` state carried into the new session), calls
  `pi.setSessionName`. If that proves fiddly in v1, skip naming and revisit.
- `runPipeline` must catch errors: on a phase failure, leave `status` as
  `IN_PROGRESS`, notify, and stop the chain (do not mark `COMPLETED`).

### 4.3 Relaying slash commands

Slash commands typed as user messages are expanded by Pi's `input` pipeline
(extension commands are checked, then skills/templates). Since Spec Kit
registers `/speckit.*` commands (as prompt templates or skills depending on
setup), sending `/speckit.specify <text>` as a user message expands and runs.
Confirmed by `send-user-message.ts` example semantics. If a given Spec Kit
install registers them as something not user-injectable, fall back to:
`repl.sendUserMessage("<text>")` after the relevant Spec Kit phase command —
but plan for the slash-command relay as the primary path.

### 4.4 `waitForIdle` ordering

`waitForIdle()` resolves when the agent stops streaming. Send the next phase
only after `waitForIdle()` resolves for the previous. Guard against the agent
aborting mid-phase: after `waitForIdle()`, optionally inspect the last messages
via `repl.sessionManager.getBranch()` for an obvious failure. v1: keep it simple
and trust `/speckit.implement`.

## 5. PROJECT_SPEC.md parser/serializer

Stable enough to unit-test without Pi. Requirements:

- A **block** starts at a `---` line (assumed top-of-block delimiter) followed
  by YAML-like lines `key: value` until the closing `---`. The template uses
  exactly `feature:` and `status:`.
- Tolerate missing `status` (default `PENDING`). Tolerate `feature` with extra
  spacing/casing.
- Body sections (`## PRD`, `## Technical view`, `## Additional info`) are parsed
  by heading; any section is optional and treated as `""`.
- Round-trip: serialize must preserve overall structure but is allowed to
  **normalize** formatting (heading levels, trailing whitespace). Document this;
  do not promise byte-identical round-trip beyond the scaffold.
- Only update the `status` field on a status change; never reorder features.

Pure regex/state machine is fine; no YAML dependency.

## 6. Testing

- Unit tests for parser/serializer (round-trip, status updates, missing
  sections, rescaffold content match).
- Loop/pipeline logic extracted so it can be exercised with a fake `ctx`
  recording `sendUserMessage`/`waitForIdle`/`newSession` calls.
- Smoke test: `pi -e ./src/index.ts` then run `/sdd-loop` in a throwaway
  Spec-Kit-initialized project.

`node:test` (built-in) is the default runner; no new devDeps beyond it and
`typescript`.

## 7. Conventions

- TypeScript, ESM, strict.
- No runtime npm dependencies.
- Never block/override built-in tools; this extension is orchestration-only.
  It must not register tools at all in v1.
- User-facing copy is clear and brief; use `ctx.ui.notify(level)` levels
  correctly (`info | warning | error`).
- File writes to `PROJECT_SPEC.md` go through a helper that writes atomically
  (write temp + rename) to avoid corrupting the file if the agent quits mid-loop.
- Keep `IN_PROGRESS` features recoverable: re-running `/sdd-loop` must process
  them again without duplicating prior completed features.

## 8. Open questions (resolve before v1)

1. Does the user's Spec Kit install register `/speckit.*` as user-injectable
   commands in Pi? Verify with a real Spec-Kit-initialized project; if not,
   adjust §4.3 fallback.
2. Confirm `ReplacedSessionContext.sendUserMessage` awaits the full turn before
   resolving (if yes, `waitForIdle` may be redundant). If it does not await,
   keep explicit `waitForIdle()`.
3. Whether to clear the agent editor / prefill anything during single-feature
   steps (probably no; rely on `ctx.ui.editor`).
4. Whether to gate with `/speckit.analyze` before `/speckit.implement` in v2.

## 9. Build order

1. `src/spec/template.ts` + scaffold-on-missing-file path. Flag: scaffold only.
2. `src/spec/parser.ts` & `serializer.ts` + unit tests.
3. `src/command.ts` + `single.ts` (interactive prompt + one-shot pipeline).
4. Smoke test single-feature in a real Spec Kit project.
5. `src/loop.ts` + `multi.ts` (newSession chaining, status bookkeeping).
6. Smoke test multi-feature across 2-3 features end to end.
7. Package descriptor + install docs in README.

Always run `pi -e ./src/index.ts` after structural changes to confirm the
extension loads without errors.