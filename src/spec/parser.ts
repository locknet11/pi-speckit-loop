export type FeatureStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export interface Feature {
  /** 0-based block position among parsed blocks; the only stable key. */
  index: number;
  /** frontmatter `feature:` value ("" if absent). */
  name: string;
  /** frontmatter `status:` value (PENDING if absent or unrecognized). */
  status: FeatureStatus;
  /** body of `## PRD`. */
  prd: string;
  /** body of `## Technical view`. */
  technicalView: string;
  /** body of `## Additional info`. */
  additionalInfo: string;
}

const STATUS_VALUES = new Set<FeatureStatus>(["PENDING", "IN_PROGRESS", "COMPLETED"]);

function parseStatus(raw: string | undefined): FeatureStatus {
  if (raw === undefined) return "PENDING";
  const upper = raw.trim().toUpperCase();
  // Tolerate "PENDING | IN_PROGRESS | COMPLETED" legend -> first token wins.
  const first = upper.split("|")[0]?.trim() ?? "";
  return STATUS_VALUES.has(first as FeatureStatus) ? (first as FeatureStatus) : "PENDING";
}

interface RawBlock {
  frontmatter: string[];
  body: string[];
}

function splitBlocks(lines: string[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i]!.trim().startsWith("---")) i++;
    if (i >= lines.length) break;
    i++; // consume opening delimiter
    const frontmatter: string[] = [];
    while (i < lines.length && !lines[i]!.trim().startsWith("---")) {
      frontmatter.push(lines[i]!);
      i++;
    }
    i++; // consume closing delimiter (if present)
    const body: string[] = [];
    while (i < lines.length && !lines[i]!.trim().startsWith("---")) {
      body.push(lines[i]!);
      i++;
    }
    const hasFrontmatter = frontmatter.some((l) => l.trim().length > 0);
    const hasBody = body.some((l) => l.trim().length > 0);
    if (!hasFrontmatter && !hasBody) continue;
    blocks.push({ frontmatter, body });
  }
  return blocks;
}

function parseFrontmatter(lines: string[]): { name?: string; status?: string } {
  let name: string | undefined;
  let status: string | undefined;
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "feature") name = value;
    else if (key === "status") status = value;
  }
  return { name, status };
}

interface BodySection {
  title: string;
  lines: string[];
}

function splitSections(body: string[]): Record<string, string> {
  const sections: BodySection[] = [];
  let cur: BodySection | null = null;
  for (const line of body) {
    const heading = line.match(/^\s*##\s+(.+?)\s*$/);
    if (heading) {
      cur = { title: heading[1]!.trim(), lines: [] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  const result: Record<string, string> = Object.create(null);
  for (const s of sections) {
    const joined = s.lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    result[s.title] = joined;
  }
  return result;
}

export function parseProjectSpec(text: string): Feature[] {
  let normalized = text.replace(/^\uFEFF/, "");
  normalized = normalized.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  const hasDelimiter = lines.some((l) => l.trim().startsWith("---"));
  if (!hasDelimiter) {
    const sections = splitSections(lines);
    return [
      {
        index: 0,
        name: "",
        status: "PENDING",
        prd: sections["PRD"] ?? "",
        technicalView: sections["Technical view"] ?? "",
        additionalInfo: sections["Additional info"] ?? "",
      },
    ];
  }

  const rawBlocks = splitBlocks(lines);
  const features: Feature[] = [];
  for (const block of rawBlocks) {
    const fm = parseFrontmatter(block.frontmatter);
    const sections = splitSections(block.body);
    features.push({
      index: features.length,
      name: fm.name ?? "",
      status: parseStatus(fm.status),
      prd: sections["PRD"] ?? "",
      technicalView: sections["Technical view"] ?? "",
      additionalInfo: sections["Additional info"] ?? "",
    });
  }
  return features;
}