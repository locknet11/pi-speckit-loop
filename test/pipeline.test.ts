import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline, type Phase } from "../src/phases.js";
import type { SessionRunner } from "../src/runner.js";

interface FakeRunner extends SessionRunner {
  log: string[];
  idles: number;
  statusLog: (string | undefined)[];
}

function fakeRunner(): FakeRunner {
  const r: FakeRunner = {
    log: [],
    idles: 0,
    statusLog: [],
    cwd: "/tmp",
    async send(message) {
      r.log.push(`send:${message}`);
    },
    async waitForIdle() {
      r.idles++;
    },
    notify() {},
    setStatus(text) {
      r.statusLog.push(text);
    },
  };
  return r;
}

test("runPipeline sends four phases in order and awaits idle after each", async () => {
  const r = fakeRunner();
  const phases: Phase[] = [];
  await runPipeline(r, { prd: "Build X", technicalView: "TS" }, { onPhase: (p) => phases.push(p) });
  assert.deepEqual(phases, ["specify", "plan", "tasks", "implement"]);
  assert.deepEqual(r.log, [
    "send:/speckit.specify Build X",
    "send:/speckit.plan TS",
    "send:/speckit.tasks",
    "send:/speckit.implement",
  ]);
  assert.equal(r.idles, 4, "waitForIdle called once per phase");
});

test("runPipeline sets footer status per phase and clears it at the end", async () => {
  const r = fakeRunner();
  await runPipeline(r, { prd: "X", technicalView: "T", label: "Feat" });
  // One setStatus per phase (4), plus a final undefined to clear.
  assert.equal(r.statusLog.length, 5);
  r.statusLog[0] && assert.match(r.statusLog[0], /\[SDD Feat\] phase 1\/4 \/speckit\.specify/);
  r.statusLog[2] && assert.match(r.statusLog[2], /\[SDD Feat\] phase 3\/4 \/speckit\.tasks/);
  assert.equal(r.statusLog[4], undefined, "status cleared after pipeline");
});

test("runPipeline clears footer status even when a phase command is missing", async () => {
  const r = fakeRunner();
  await assert.rejects(
    () =>
      runPipeline(
        r,
        { prd: "X", technicalView: "T" },
        // Only specify is "registered"; tasks will trip the missing-command check.
        { availableCommands: ["speckit.specify", "speckit.plan"] },
      ),
    /not registered/,
  );
  // After the throw, the final status entry must still be the clear (undefined).
  assert.equal(r.statusLog.at(-1), undefined, "status cleared on failure");
  // specify and plan dispatch before tasks throws.
  assert.deepEqual(r.log, ["send:/speckit.specify X", "send:/speckit.plan T"]);
});

test("runPipeline omits args when prd/tech are empty/whitespace", async () => {
  const r = fakeRunner();
  await runPipeline(r, { prd: "   \n  ", technicalView: "" });
  assert.deepEqual(r.log, [
    "send:/speckit.specify",
    "send:/speckit.plan",
    "send:/speckit.tasks",
    "send:/speckit.implement",
  ]);
});

test("runPipeline preserves multi-line prd text in the message", async () => {
  const r = fakeRunner();
  const prd = "Line 1\nLine 2\nLine 3";
  await runPipeline(r, { prd, technicalView: "tech" });
  assert.ok(r.log[0]?.includes("Line 1\nLine 2\nLine 3"), "multi-line prd is embedded verbatim");
});