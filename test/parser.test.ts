import test from "node:test";
import assert from "node:assert/strict";
import { parseProjectSpec } from "../src/spec/parser.js";
import { DEFAULT_TEMPLATE } from "../src/spec/template.js";

test("parses the default scaffold into two PENDING features", () => {
  const features = parseProjectSpec(DEFAULT_TEMPLATE);
  assert.equal(features.length, 2);
  assert.equal(features[0]?.name, "Feature 1");
  assert.equal(features[0]?.status, "PENDING");
  assert.equal(features[1]?.name, "Feature 2");
  assert.equal(features[1]?.status, "PENDING");
});

test("parses body sections by heading", () => {
  const text = `---
feature: Search
status: IN_PROGRESS
---

## PRD

Full-text search across albums.

## Technical view

Use SQLite FTS5.

## Additional info

i18n later.
`;
  const [f] = parseProjectSpec(text);
  assert.equal(f?.name, "Search");
  assert.equal(f?.status, "IN_PROGRESS");
  assert.match(f?.prd ?? "", /Full-text search/);
  assert.match(f?.technicalView ?? "", /FTS5/);
  assert.match(f?.additionalInfo ?? "", /i18n/);
});

test("missing status defaults to PENDING", () => {
  const text = `---
feature: NoStatus
---

## PRD

something
`;
  const [f] = parseProjectSpec(text);
  assert.equal(f?.status, "PENDING");
});

test("status legend collapses to first token", () => {
  const text = `---
feature: Legends
status: PENDING | IN_PROGRESS | COMPLETED
---

## PRD

x
`;
  const [f] = parseProjectSpec(text);
  assert.equal(f?.status, "PENDING");
});

test("unknown status falls back to PENDING", () => {
  const text = `---
feature: Weird
status: BANANA
---

## PRD

x
`;
  const [f] = parseProjectSpec(text);
  assert.equal(f?.status, "PENDING");
});

test("preserves block order via index ordinal", () => {
  const text = Array.from({ length: 3 }, (_, k) =>
    `---
feature: F${k + 1}
status: ${["PENDING", "IN_PROGRESS", "COMPLETED"][k]}
---

## PRD

p${k + 1}
`).join("\n");
  const features = parseProjectSpec(text);
  assert.deepEqual(
    features.map((f) => f.index),
    [0, 1, 2],
  );
  assert.deepEqual(
    features.map((f) => f.name),
    ["F1", "F2", "F3"],
  );
  assert.deepEqual(
    features.map((f) => f.status),
    ["PENDING", "IN_PROGRESS", "COMPLETED"],
  );
});

test("tolerates CRLF line endings", () => {
  const text = "---\r\nfeature: CRLF\r\nstatus: PENDING\r\n---\r\n\r\n## PRD\r\n\r\nx\r\n";
  const [f] = parseProjectSpec(text);
  assert.equal(f?.name, "CRLF");
  assert.equal(f?.status, "PENDING");
  assert.match(f?.prd ?? "", /x/);
});

test("tolerates a leading BOM", () => {
  const text = `\uFEFF---
feature: BOM
status: PENDING
---

## PRD

x
`;
  const [f] = parseProjectSpec(text);
  assert.equal(f?.name, "BOM");
});

test("file with no delimiters becomes one anonymous feature", () => {
  const text = `## PRD

just some markdown

## Additional info

note
`;
  const features = parseProjectSpec(text);
  assert.equal(features.length, 1);
  assert.equal(features[0]?.name, "");
  assert.equal(features[0]?.status, "PENDING");
  assert.match(features[0]?.prd ?? "", /just some markdown/);
  assert.match(features[0]?.additionalInfo ?? "", /note/);
});

test("skips stray empty blocks", () => {
  const text = `---

---

---
feature: Real
status: PENDING
---

## PRD

x
`;
  const features = parseProjectSpec(text);
  // The empty `---\n\n---` consumes two delimiters forming one empty block,
  // then the `Real` block parses. We must still see the Real feature.
  const real = features.find((f) => f.name === "Real");
  assert.ok(real, "Real feature should be parsed despite stray empties");
});

test("round-trips PRD/tech with internal newlines", () => {
  const text = `---
feature: Multi
status: PENDING
---

## PRD

line one
line two

## Technical view

- a
- b
`;
  const [f] = parseProjectSpec(text);
  assert.equal(f?.prd, "line one\nline two");
  assert.equal(f?.technicalView, "- a\n- b");
});