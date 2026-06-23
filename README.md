# pi-speckit-loop

A [Pi](https://pi.dev/docs/latest/extensions) extension that automates
[Spec-Driven Development (SDD)](https://github.com/github/spec-kit) using
[GitHub Spec Kit](https://github.com/github/spec-kit) and a custom implementation
of the **Ralph Wiggum loop**.

The extension adds a single entry point — `/sdd-loop` — that drives the whole
Spec Kit pipeline (`/speckit.specify` → `/speckit.plan` → `/speckit.tasks` →
`/speckit.implement`) for one or many features, with fresh context per feature
so the agent never runs out of room mid-project.

> **Status:** v1 implemented (spec parser, status editor, single- and
> multi-feature orchestration, tests green, typecheck clean, loads cleanly under
> `pi -e ./src/index.ts`). The remaining unverified piece is the live Spec Kit
> slash-command expansion (`/speckit.*`) end-to-end inside a real Spec –Kit-initialized project — see [Open questions](#open-questions).

---

## Why

Running `/speckit.*` by hand for each feature is tedious and context-fragile:
after a few features the agent's session fills up and quality drops. This
extension removes the toil and resets context between features, so a single
`PROJECT_SPEC.md` (or a one-off interactive prompt) can carry a project from
requirements all the way to committed implementation.

The "Ralph Wiggum loop" is a community pattern for running Spec Kit phases in an
autonomous, iterative cycle. This project ships its own custom implementation:
an orchestrator that schedules phases, opens a fresh session per feature
(multi-feature mode), relays each phase as a user message so Spec Kit's slash
commands expand and run, then advances the loop until every feature is
`COMPLETED`.

## How it works

```
/sdd-loop
   │
   ├─ prompt: select mode ─────────────────────────────────────┐
   │     • single-feature                                      │
   │     • multi-feature                                       │
   │                                                           │
   ├─ single-feature                                           │
   │     step 1: interactively gather PRD                      │
   │     step 2: interactively gather Technical view            │
   │     one shot, current session:                            │
   │        /speckit.specify  → /speckit.plan  →               │
   │        /speckit.tasks     → /speckit.implement             │
   │                                                           │
   └─ multi-feature                                            │
         read PROJECT_SPEC.md (or scaffold an empty template  │
         and ask the user to fill it)                         │
         foreach feature where status != COMPLETED:           │
            ctx.newSession()  // fresh context per feature     │
            mark feature IN_PROGRESS in PROJECT_SPEC.md       │
            /speckit.specify  → /speckit.plan  →               │
            /speckit.tasks     → /speckit.implement            │
            mark feature COMPLETED in PROJECT_SPEC.md         │
         loop until every feature is COMPLETED                │
```

Each phase is delivered to the agent as a normal user message (e.g.
``/speckit.specify <PRD>``). Pi expands slash commands before the agent runs,
so the Spec Kit commands behave exactly as if the user typed them. The
orchestrator waits for the agent to go idle between phases so they execute in
order within a session.

## Modes

### multi-feature

Driven by a `PROJECT_SPEC.md` file: a set of PRDs separated by YAML-style
frontmatter delimiters, each with its own `status`. The file lives at the
project root. If it does not exist, the extension writes a default empty
template (two placeholder features) and stops, asking the user to complete it
and re-run `/sdd-loop`.

Default template:

```markdown
---
feature: Feature 1
status: PENDING | IN_PROGRESS | COMPLETED
---

## PRD

Here goes the product requirement details

## Technical view

Here goes all details related to technical information relevant to project.

## Additional info

Here goes additional info

---
feature: Feature 2
status: PENDING | IN_PROGRESS | COMPLETED
---

## PRD

Here goes the product requirement details

## Technical view

Here goes all details related to technical information relevant to project.

## Additional info

Here goes additional info
```

Every feature with `status: PENDING` (or `IN_PROGRESS` from a previous run) is
processed in turn, each in its **own fresh Pi session**. The orchestrator
mutates `status` between phases: `PENDING` → `IN_PROGRESS` when a feature
starts, → `COMPLETED` when `/speckit.implement` finishes. The loop ends when no
feature remains non-`COMPLETED`, so resuming a half-finished `PROJECT_SPEC.md`
only re-runs outstanding work.

### single-feature

No file is used. The extension prompts the user interactively, in steps:

1. **PRD** — product requirements (what & why).
2. **Technical view** — tech stack and architecture choices.

It then runs the four Spec Kit phases as a one-shot in the **current session**:

```
/speckit.specify <PRD>
/speckit.plan    <technical view>
/speckit.tasks
/speckit.implement
```

## Prerequisites

- [Pi coding agent](https://pi.dev) installed and on PATH.
- [Spec Kit](https://github.com/github/spec-kit) installed and the project
  initialized with the Spec Kit slash commands available
  (`/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`).
  The extension does **not** ship Spec Kit; it relies on its slash commands
  being present (they are typically registered as prompt templates / skills by
  the Spec Kit setup for your coding agent).

## Install

To be implemented. Planned options:

- As a local project extension: drop the built extension into
  `.pi/extensions/` (project-local) and `/reload`.
- As a pi package: `pi install git:github.com/<owner>/pi-speckit-loop`.

See `AGENTS.md` for the implementation plan and extension layout.

## Usage

In a Spec Kit–enabled project, from the Pi prompt:

```
/sdd-loop
```

Pick a mode and answer the prompts. For multi-feature, make sure
`PROJECT_SPEC.md` exists at the project root (the extension will offer to
scaffold one).

## Install

This project builds against `@earendil-works/pi-coding-agent` (the runtime types).
Runtime deps are zero; the extension is loaded by Pi via jiti.

```bash
git clone <repo>
cd pi-speckit-loop
npm install      # dev deps: typescript, tsx, pi-coding-agent types
```

To try it directly without installing as a package:

```bash
pi -e ./src/index.ts
```

Or drop `./src/index.ts` (or this repo) into `.pi/extensions/` /
`~/.pi/agent/extensions/` and `/reload` (see [Pi docs](https://pi.dev/docs/latest/extensions)).

## Usage

From the Pi prompt in a Spec Kit–enabled project:

```
/sdd-loop
```

Pick a mode and answer the prompts. For multi-feature, keep `PROJECT_SPEC.md`
at the project root (the extension scaffolds one on first run if missing).

## Testing

```bash
npm test          # node:test via tsx (parser, status, pipeline)
npx tsc --noEmit  # strict typecheck
```

## Open questions

These are assumptions not yet confirmed against a live Spec Kit install (tracked
in [`PLAN.md`](./PLAN.md)):

1. `/speckit.*` slash commands expand for `sendUserMessage`-injected user
   messages in this Pi/Spec-Kit setup. `/sdd-loop` warns if Spec Kit commands
   are not detected via `pi.getCommands()` and lets you proceed.
2. Whether `ReplacedSessionContext.sendUserMessage` awaits the full turn
   (`waitForIdle()` is called regardless, so phases stay ordered either way).
3. Naming replacement sessions — deferred to v2.

## Roadmap

- [x] `/sdd-loop` command + mode picker.
- [x] `PROJECT_SPEC.md` parser + surgical status editor + scaffold.
- [x] Single-feature interactive one-shot pipeline.
- [x] Multi-feature orchestration: fresh `ctx.newSession` per feature, phase
      relay via `sendUserMessage`, `waitForIdle` between phases.
- [x] Status bookkeeping + resumable loop (only non-`COMPLETED` features run).
- [x] Unit tests (parser, status, pipeline) + typecheck + `pi -e` load smoke.
- [ ] Validate against a real Spec Kit project end-to-end.
- [ ] v2: `/speckit.analyze` gate, replacement-session naming, retry/verify loop.

## License

MIT (TBD).