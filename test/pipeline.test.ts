import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline, type Phase } from "../src/phases.js";
import type { SessionRunner } from "../src/runner.js";

interface FakeRunner extends SessionRunner {
  log: string[];
  idles: number;
}

function fakeRunner(): FakeRunner {
  const r: FakeRunner = {
    log: [],
    idles: 0,
    cwd: "/tmp",
    async send(message) {
      r.log.push(`send:${message}`);
    },
    async waitForIdle() {
      r.idles++;
    },
    notify() {},
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