import type {
  Block,
  BlockTone,
  CellValue,
  ChartBlock,
  Column,
  FindingsBlock,
  StatsBlock,
  TableBlock,
  ValueFormat
} from "@/types/blocks";

/**
 * A DASHBOARD AS A FILE
 *
 * Export writes the blocks on screen to one small JSON file; import reads such
 * a file back into a new tab. That is the whole feature: a view you built with
 * the copilot can be handed to a colleague, attached to a mail or kept beside
 * the deal, and opened again without the conversation that produced it.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It is a snapshot, not a live view. The figures in the file are the ones the
 *    queries returned at export time, so the file carries `exported_at` and the
 *    question that built it; a question asked in the imported tab goes to the
 *    live database, in a fresh conversation.
 *  - It never carries a pending decision. A `preview` block holds a
 *    `pending_id`, the one route to a write, and that belongs to one session and
 *    one person in front of the screen — not in a file that can be passed on.
 *    Preview blocks are dropped on export (see `strip`).
 *
 * An imported file is untrusted input, so every block is validated here to the
 * same shape the server would have produced, field by field. Anything that does
 * not match is dropped rather than rendered: the registry in
 * components/blocks/BlockView.tsx is handed nothing it cannot draw.
 */

export const FILE_KIND = "sales-copilot-dashboard";
export const FILE_VERSION = 1;

export interface DashboardFile {
  kind: typeof FILE_KIND;
  version: number;
  /** ISO timestamp — the moment these figures were true. */
  exported_at: string;
  title: string;
  icon: string;
  /** What built the dashboard, so the imported tab can be rebuilt from it. */
  question?: string;
  blocks: Block[];
  disclaimer: string;
}

const DISCLAIMER = "Company names are real; all business data is simulated.";
const FALLBACK_ICON = "fa-sharp fa-regular fa-chart-mixed";

/** Rendering is capped the same way the server caps a result set. */
const MAX_BLOCKS = 40;
const MAX_ROWS = 2000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const FORMATS = ["number", "money", "percent", "date"] as const;
const TONES = ["good", "bad", "warn", "info", "neutral"] as const;
const COLUMN_TYPES = ["text", "number", "money", "percent", "date", "badge"] as const;
const CHART_KINDS = [
  "line",
  "area",
  "bar",
  "stacked-bar",
  "horizontal-bar",
  "combo",
  "pie",
  "funnel",
  "scatter",
  "waterfall",
  "heatmap"
] as const;

/* ── Writing ──────────────────────────────────────────────────────────────── */

/** A pending decision is not part of a saved view — see the note above. */
function strip(blocks: Block[]): Block[] {
  return blocks.filter((block) => block.type !== "preview").slice(0, MAX_BLOCKS);
}

export function dashboardToFile(input: {
  title: string;
  icon: string;
  question?: string;
  blocks: Block[];
}): DashboardFile {
  return {
    kind: FILE_KIND,
    version: FILE_VERSION,
    exported_at: new Date().toISOString(),
    title: input.title,
    icon: input.icon,
    question: input.question,
    blocks: strip(input.blocks),
    disclaimer: DISCLAIMER
  };
}

/** "Top customers" → "top-customers-2026-11-10.dashboard.json" */
export function fileName(title: string, stamp: Date = new Date()): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "dashboard";
  return `${slug}-${stamp.toISOString().slice(0, 10)}.dashboard.json`;
}

/**
 * Save the dashboard to the reader's downloads. Returns the file name, or null
 * when there is nothing on the dashboard worth writing.
 */
export function exportDashboard(input: {
  title: string;
  icon: string;
  question?: string;
  blocks: Block[];
}): string | null {
  const file = dashboardToFile(input);
  if (file.blocks.length === 0) return null;

  const name = fileName(file.title);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser the frame it needs to start the download before the blob
  // is handed back.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function one<T extends string>(value: unknown, set: readonly T[]): T | null {
  return typeof value === "string" && (set as readonly string[]).includes(value) ? (value as T) : null;
}

function rawList(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRaw) : [];
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function tone(value: unknown): BlockTone {
  return one(value, TONES) ?? "neutral";
}

function format(value: unknown): ValueFormat {
  return one(value, FORMATS) ?? "number";
}

/** A table row: keys with a primitive value. Anything else is left out, which
 *  the renderers already handle — a missing cell draws as "—". */
function cells(value: unknown): Record<string, CellValue> | null {
  if (!isRaw(value)) return null;
  const row: Record<string, CellValue> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (cell === null || typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
      row[key] = cell;
    }
  }
  return row;
}

/** A chart point: numbers, labels and gaps, no booleans. */
function point(value: unknown): Record<string, string | number | null> | null {
  if (!isRaw(value)) return null;
  const row: Record<string, string | number | null> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (cell === null || typeof cell === "string" || (typeof cell === "number" && Number.isFinite(cell))) {
      row[key] = cell;
    }
  }
  return row;
}

function id(raw: Raw, index: number): string {
  return str(raw.id) ?? `imported-${index}`;
}

function stats(raw: Raw, index: number): StatsBlock | null {
  const items = rawList(raw.items)
    .map((item): StatsBlock["items"][number] | null => {
      const label = str(item.label);
      const value = typeof item.value === "number" || typeof item.value === "string" ? item.value : null;
      if (label === null || value === null) return null;
      return {
        label,
        value,
        format: format(item.format),
        sublabel: str(item.sublabel),
        delta_percent: num(item.delta_percent),
        tone: tone(item.tone)
      };
    })
    .filter((item): item is StatsBlock["items"][number] => item !== null);
  if (items.length === 0) return null;
  return { type: "stats", id: id(raw, index), title: str(raw.title), items };
}

function table(raw: Raw, index: number): TableBlock | null {
  const columns = rawList(raw.columns)
    .map((column): Column | null => {
      const key = str(column.key);
      const label = str(column.label);
      if (key === null || label === null) return null;
      return {
        key,
        label,
        type: one(column.type, COLUMN_TYPES) ?? "text",
        align: column.align === "left" || column.align === "right" ? column.align : null
      };
    })
    .filter((column): column is Column => column !== null);
  if (columns.length === 0) return null;

  const rows = rawList(raw.rows)
    .slice(0, MAX_ROWS)
    .map(cells)
    .filter((row): row is Record<string, CellValue> => row !== null);

  return {
    type: "table",
    id: id(raw, index),
    title: str(raw.title),
    columns,
    rows,
    total_rows: num(raw.total_rows),
    note: str(raw.note)
  };
}

function chart(raw: Raw, index: number): ChartBlock | null {
  const kind = one(raw.chart, CHART_KINDS);
  const xKey = str(raw.x_key);
  if (kind === null || xKey === null) return null;

  const series = rawList(raw.series)
    .map((item): ChartBlock["series"][number] | null => {
      const key = str(item.key);
      if (key === null) return null;
      return {
        key,
        name: str(item.name) ?? key,
        draw: item.draw === "bar" || item.draw === "line" ? item.draw : null,
        tone: one(item.tone, TONES)
      };
    })
    .filter((item): item is ChartBlock["series"][number] => item !== null);
  if (series.length === 0) return null;

  const data = rawList(raw.data)
    .slice(0, MAX_ROWS)
    .map(point)
    .filter((row): row is Record<string, string | number | null> => row !== null);
  if (data.length === 0) return null;

  const groupTones: Record<string, BlockTone> = {};
  if (isRaw(raw.group_tones)) {
    for (const [group, value] of Object.entries(raw.group_tones)) {
      const matched = one(value, TONES);
      if (matched) groupTones[group] = matched;
    }
  }

  const references = rawList(raw.references)
    .map((item): NonNullable<ChartBlock["references"]>[number] | null => {
      const axis = item.axis === "x" || item.axis === "y" ? item.axis : null;
      const value =
        typeof item.value === "string" || typeof item.value === "number" ? item.value : null;
      const label = str(item.label);
      if (axis === null || value === null || label === null) return null;
      return { axis, value, label, tone: tone(item.tone) };
    })
    .filter((item): item is NonNullable<ChartBlock["references"]>[number] => item !== null);

  return {
    type: "chart",
    id: id(raw, index),
    chart: kind,
    title: str(raw.title),
    x_key: xKey,
    series,
    data,
    format: format(raw.format),
    note: str(raw.note),
    y_key: str(raw.y_key),
    size_key: str(raw.size_key),
    group_key: str(raw.group_key),
    label_key: str(raw.label_key),
    y_format: one(raw.y_format, FORMATS),
    group_tones: groupTones,
    references,
    stacked: kind === "horizontal-bar" && raw.stacked === true,
    size: raw.size === "half" ? "half" : "full"
  };
}

function findings(raw: Raw, index: number): FindingsBlock | null {
  const items = rawList(raw.items)
    .map((item): FindingsBlock["items"][number] | null => {
      const title = str(item.title);
      const summary = str(item.summary);
      if (title === null || summary === null) return null;
      return {
        title,
        summary,
        tone: tone(item.tone),
        evidence: strList(item.evidence),
        next_step: str(item.next_step)
      };
    })
    .filter((item): item is FindingsBlock["items"][number] => item !== null);
  if (items.length === 0) return null;
  return { type: "findings", id: id(raw, index), title: str(raw.title), items };
}

/** One raw object → a block the registry can draw, or null to drop it. */
function block(value: unknown, index: number): Block | null {
  if (!isRaw(value)) return null;
  switch (value.type) {
    case "stats":
      return stats(value, index);
    case "table":
      return table(value, index);
    case "chart":
      return chart(value, index);
    case "findings":
      return findings(value, index);
    case "callout": {
      const title = str(value.title);
      const body = str(value.body);
      if (title === null || body === null) return null;
      return {
        type: "callout",
        id: id(value, index),
        tone: tone(value.tone),
        title,
        body,
        evidence: strList(value.evidence)
      };
    }
    // `preview` on purpose: a pending write never travels in a file.
    default:
      return null;
  }
}

export class DashboardFileError extends Error {}

/** Read a file the reader picked. Throws `DashboardFileError` with a sentence
 *  that can go straight on screen. */
export async function readDashboardFile(picked: File): Promise<DashboardFile> {
  if (picked.size > MAX_FILE_BYTES) {
    throw new DashboardFileError("That file is too large to be a dashboard.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await picked.text());
  } catch {
    throw new DashboardFileError("That file is not readable JSON.");
  }

  if (!isRaw(parsed) || parsed.kind !== FILE_KIND) {
    throw new DashboardFileError("That is not a dashboard exported from this app.");
  }
  const version = num(parsed.version) ?? 0;
  if (version > FILE_VERSION) {
    throw new DashboardFileError(
      `That dashboard was exported by a newer version of the app (file ${version}, this app reads ${FILE_VERSION}).`
    );
  }

  const blocks = rawList(parsed.blocks)
    .slice(0, MAX_BLOCKS)
    .map(block)
    .filter((candidate): candidate is Block => candidate !== null);
  if (blocks.length === 0) {
    throw new DashboardFileError("That dashboard file holds no components this app can draw.");
  }

  return {
    kind: FILE_KIND,
    version,
    exported_at: str(parsed.exported_at) ?? "",
    title: (str(parsed.title) ?? "Imported dashboard").slice(0, 40),
    icon: str(parsed.icon) ?? FALLBACK_ICON,
    question: str(parsed.question) ?? undefined,
    blocks,
    disclaimer: str(parsed.disclaimer) ?? DISCLAIMER
  };
}
