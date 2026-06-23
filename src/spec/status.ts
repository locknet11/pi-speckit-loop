import { readIfExists, atomicWrite } from "../util/fs.js";
import type { FeatureStatus } from "./parser.js";

/**
 * Surgically update the `status:` line of the n-th feature block in
 * PROJECT_SPEC.md, preserving every other byte of the file. Re-reads the file
 * on every call so concurrent edits between turns do not corrupt it.
 *
 * Block-counting mirrors splitBlocks() in parser.ts: a block is opened by a
 * `---` line, and its frontmatter ends at the next `---`.
 */
export async function setStatusByIndex(
  path: string,
  index: number,
  newStatus: FeatureStatus,
): Promise<void> {
  const text = await readIfExists(path);
  if (text === undefined) {
    throw new Error(`PROJECT_SPEC.md not found at ${path}`);
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  let block = -1;
  let i = 0;
  let statusLineIndex = -1;
  let blockStart = -1;

  outer: while (i < lines.length) {
    while (i < lines.length && !lines[i]!.trim().startsWith("---")) i++;
    if (i >= lines.length) break;
    const openIndex = i;
    i++; // consume opening delimiter
    const fmStart = i;
    while (i < lines.length && !lines[i]!.trim().startsWith("---")) i++;
    const fmEnd = i; // exclusive; lines[fmEnd] is closing `---` or EOF
    // Look up `status:` within this frontmatter span [fmStart, fmEnd).
    let foundStatus = -1;
    for (let j = fmStart; j < fmEnd; j++) {
      if (/^\s*status\s*:\s*/i.test(lines[j]!)) {
        foundStatus = j;
        break;
      }
    }
    block++;
    if (block === index) {
      statusLineIndex = foundStatus;
      blockStart = openIndex;
      break outer;
    }
    i = fmEnd + 1; // consume closing delimiter, continue scanning
  }

  if (block !== index) {
    throw new Error(`Feature block index ${index} not found in ${path}`);
  }

  const nextLines = [...lines];
  if (statusLineIndex >= 0) {
    nextLines[statusLineIndex] = `status: ${newStatus}`;
  } else {
    // No status line in this block -> insert one right after the opening `---`.
    nextLines.splice(blockStart + 1, 0, `status: ${newStatus}`);
  }

  let out = nextLines.join("\n");
  // Preserve trailing newline presence of the original.
  if (text.endsWith("\n") && !out.endsWith("\n")) out += "\n";
  await atomicWrite(path, out);
}