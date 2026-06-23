import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setStatusByIndex } from "../src/spec/status.js";
import { atomicWrite } from "../src/util/fs.js";

const SAMPLE = `---
feature: Feature 1
status: PENDING
---

## PRD

one

## Technical view

t1

## Additional info

a1

---
feature: Feature 2
status: PENDING
---

## PRD

two

## Technical view

t2

## Additional info

a2
`;

async function withTempFile(content: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "sdd-"));
  const path = join(dir, "PROJECT_SPEC.md");
  await atomicWrite(path, content);
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("setStatusByIndex flips only the target block's status line", async () => {
  const { path, cleanup } = await withTempFile(SAMPLE);
  try {
    await setStatusByIndex(path, 1, "IN_PROGRESS");
    const after = await readFile(path, "utf8");
    const lines = after.split("\n");
    // Feature 1 status line must remain PENDING.
    const f1Status = lines.find((l) => l.trim() === "status: PENDING");
    assert.ok(f1Status, "Feature 1 status line still present and unchanged");
    // Feature 2 status line must now be IN_PROGRESS (exactly one occurrence).
    const inProgressCount = lines.filter((l) => l.trim() === "status: IN_PROGRESS").length;
    assert.equal(inProgressCount, 1, "exactly one IN_PROGRESS status line");
    // The PRD bodies are preserved verbatim.
    assert.match(after, /## PRD\n\none/);
    assert.match(after, /## PRD\n\ntwo/);
  } finally {
    await cleanup();
  }
});

test("setStatusByIndex can mark COMPLETED then IN_PROGRESS idempotently", async () => {
  const { path, cleanup } = await withTempFile(SAMPLE);
  try {
    await setStatusByIndex(path, 0, "IN_PROGRESS");
    await setStatusByIndex(path, 0, "COMPLETED");
    const after = await readFile(path, "utf8");
    const completed = after.split("\n").filter((l) => l.trim() === "status: COMPLETED").length;
    assert.equal(completed, 1);
    assert.doesNotMatch(after, /status: IN_PROGRESS/);
  } finally {
    await cleanup();
  }
});

test("inserts a status line when the block has none", async () => {
  const text = `---
feature: NoStatus
---

## PRD

x
`;
  const { path, cleanup } = await withTempFile(text);
  try {
    await setStatusByIndex(path, 0, "IN_PROGRESS");
    const after = await readFile(path, "utf8");
    assert.match(after, /---\nstatus: IN_PROGRESS\nfeature: NoStatus/);
  } finally {
    await cleanup();
  }
});

test("throws when the block index does not exist", async () => {
  const { path, cleanup } = await withTempFile(SAMPLE);
  try {
    await assert.rejects(() => setStatusByIndex(path, 99, "COMPLETED"), /index 99 not found/);
  } finally {
    await cleanup();
  }
});

test("throws when the file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdd-"));
  const missing = join(dir, "nope.md");
  try {
    await assert.rejects(() => setStatusByIndex(missing, 0, "PENDING"), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preserves a trailing newline", async () => {
  const text = `---
feature: Trailing
status: PENDING
---

## PRD

x
`;
  const { path, cleanup } = await withTempFile(text);
  try {
    await setStatusByIndex(path, 0, "COMPLETED");
    const after = await readFile(path, "utf8");
    assert.ok(after.endsWith("\n"), "trailing newline preserved");
  } finally {
    await cleanup();
  }
});