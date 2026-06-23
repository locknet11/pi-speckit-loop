import { atomicWrite } from "../util/fs.js";

// Default scaffold written when PROJECT_SPEC.md is missing.
//
// NOTE: this differs slightly from the template documented in README.md.
// README keeps the `status: PENDING | IN_PROGRESS | COMPLETED` legend verbatim
// as *documentation* of the allowed values. Here we write a concrete, runnable
// value (`status: PENDING`) so the scaffold is immediately parseable and the
// loop can start on the first run without an edit.
export const DEFAULT_TEMPLATE = `---
feature: Feature 1
status: PENDING
---

## PRD

Here goes the product requirement details

## Technical view

Here goes all details related to technical information relevant to project.

## Additional info

Here goes additional info

---
feature: Feature 2
status: PENDING
---

## PRD

Here goes the product requirement details

## Technical view

Here goes all details related to technical information relevant to project.

## Additional info

Here goes additional info
`;

export async function scaffoldProjectSpec(path: string): Promise<void> {
  await atomicWrite(path, DEFAULT_TEMPLATE);
}