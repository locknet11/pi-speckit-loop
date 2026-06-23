import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SddMode = "single" | "multi";

export async function pickMode(ctx: ExtensionContext): Promise<SddMode | undefined> {
  const choice = await ctx.ui.select("SDD mode:", [
    "single-feature",
    "multi-feature",
  ]);
  if (choice === undefined) return undefined;
  // Strip everything after ( ... ) if we ever annotate labels; safe no-op otherwise.
  const [label] = choice.split(/\s*\(/);
  if (label === "single-feature") return "single";
  if (label === "multi-feature") return "multi";
  return undefined;
}

export async function askMultiline(
  ctx: ExtensionContext,
  label: string,
  placeholder: string,
): Promise<string | undefined> {
  const text = await ctx.ui.editor(label, placeholder);
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : text;
}