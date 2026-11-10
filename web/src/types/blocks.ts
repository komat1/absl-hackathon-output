/**
 * Mirror of the Pydantic models in api/app/contracts.py — that file is the
 * authority. The server validates every block before it is streamed, so by the
 * time one arrives here it already has this shape.
 */
export type BlockTone = "good" | "bad" | "warn" | "info" | "neutral";
export type ValueFormat = "number" | "money" | "percent" | "date";
export type CellValue = string | number | boolean | null;

export interface StatItem {
  label: string;
  value: number | string;
  format: ValueFormat;
  sublabel?: string | null;
  delta_percent?: number | null;
  tone: BlockTone;
}

export interface StatsBlock {
  type: "stats";
  id: string;
  title?: string | null;
  items: StatItem[];
}

export interface Column {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "percent" | "date" | "badge";
  align?: "left" | "right" | null;
}

export interface TableBlock {
  type: "table";
  id: string;
  title?: string | null;
  columns: Column[];
  rows: Record<string, CellValue>[];
  total_rows?: number | null;
  note?: string | null;
}

/** Every form the server may ask for. One component per entry, registered in
 *  components/blocks/ChartView.tsx — a kind added here without a renderer is a
 *  compile error there, which is the point. */
export type ChartKind =
  | "line"
  | "area"
  | "bar"
  | "stacked-bar"
  | "horizontal-bar"
  | "combo"
  | "pie"
  | "funnel"
  | "scatter"
  | "waterfall"
  | "heatmap";

export interface ChartSeries {
  key: string;
  name: string;
  /** combo only: bars or a line. Every series of a combo shares one y-axis. */
  draw?: "bar" | "line" | null;
  /** Pins a series to a meaning rather than to a slot in the palette. */
  tone?: BlockTone | null;
}

export interface ChartReference {
  axis: "x" | "y";
  value: number | string;
  label: string;
  tone: BlockTone;
}

export interface ChartBlock {
  type: "chart";
  id: string;
  chart: ChartKind;
  title?: string | null;
  x_key: string;
  series: ChartSeries[];
  data: Record<string, string | number | null>[];
  format: ValueFormat;
  note?: string | null;
  /** scatter: the second dimension, and what sizes a point. */
  y_key?: string | null;
  size_key?: string | null;
  /** scatter: what colours a point. heatmap: what makes a row. */
  group_key?: string | null;
  label_key?: string | null;
  /** The unit of y_key where it differs from `format`. */
  y_format?: ValueFormat | null;
  group_tones?: Record<string, BlockTone>;
  references?: ChartReference[];
  /** horizontal-bar only: stack the series into one bar per row. */
  stacked?: boolean;
  /** Share of the dashboard row: two consecutive halves sit side by side. */
  size?: "full" | "half";
}

export interface CalloutBlock {
  type: "callout";
  id: string;
  tone: BlockTone;
  title: string;
  body: string;
  evidence: string[];
}

export interface FindingsBlock {
  type: "findings";
  id: string;
  title?: string | null;
  items: {
    title: string;
    summary: string;
    tone: BlockTone;
    evidence: string[];
    next_step?: string | null;
  }[];
}

/** The researcher's vocabulary. Mirrors the research models in contracts.py;
 *  the four categories are the risk areas the brief names, plus company news. */
export type ResearchCategory =
  | "cybersecurity"
  | "service-continuity"
  | "technology-lifecycle"
  | "regulatory"
  | "business-context";

export interface ResearchSource {
  title: string;
  url: string;
  publisher: string;
  /** As published: YYYY-MM-DD, or YYYY-MM when the day is not given. */
  published: string;
}

/** One dated public claim. The three middle fields are deliberately separate:
 *  `claim` is what the source says, `implication` is what we think it might
 *  mean, `question` is what has to be asked because nobody can look it up. */
export interface ResearchFinding {
  claim: string;
  category: ResearchCategory;
  source: ResearchSource;
  implication: string;
  question: string;
  next_step: string;
  tone: BlockTone;
}

/** A company that resembles an account we already sell to — a suggestion with
 *  its sources, and deliberately no value, probability or score. */
export interface ProspectCandidate {
  company: string;
  why: string;
  opener: string;
  sources: ResearchSource[];
}

export interface ResearchReport {
  scope: string;
  summary: string;
  findings: ResearchFinding[];
  candidates: ProspectCandidate[];
  topics: string[];
  /** What no dated public source was found for. An empty answer is an answer. */
  gaps: string[];
}

/** Public research on the canvas. The one block whose content is real rather
 *  than simulated, which is why it carries its own date and says so on screen. */
export interface ResearchBlock {
  type: "research";
  id: string;
  title: string;
  report: ResearchReport;
  accessed: string;
  about?: string | null;
  searched: number;
}

export const RESEARCH_CATEGORY_LABEL: Record<ResearchCategory, string> = {
  cybersecurity: "Cybersecurity",
  "service-continuity": "Service continuity",
  "technology-lifecycle": "Technology lifecycle",
  regulatory: "Regulatory",
  "business-context": "Business context"
};

export type EditableField = "won_lost_active_status" | "close_date" | "win_probability_percent";

export interface FieldChange {
  field: EditableField;
  old_values: string[];
  new_value: string;
  /** The stored value already equals the new one — shown, not hidden. */
  unchanged: boolean;
}

/** A pending decision: one to three fields of one deal, applied together or not
 *  at all. Nothing here has been written; `pending_id` is the only way to the
 *  write, and it is handed to the person, never to the model. */
export interface AdvancePreview {
  pending_id: string;
  deal: string;
  name: string;
  changes: FieldChange[];
  affected_lines: number;
  expires_at: string;
  stored_now: Record<string, string | number | null>;
  deal_value_eur: number;
  weighted_before_eur: number;
  weighted_after_eur: number;
  leaves_active_pipeline: boolean;
  derived_note?: string | null;
}

export interface PreviewBlock {
  type: "preview";
  id: string;
  preview: AdvancePreview;
  /** The decision in the user's own terms, so the card leads with what they
   *  asked for rather than with a field diff. */
  intent?: string | null;
}

export type Block =
  | StatsBlock
  | TableBlock
  | ChartBlock
  | CalloutBlock
  | FindingsBlock
  | PreviewBlock
  | ResearchBlock;

export const FIELD_LABEL: Record<EditableField, string> = {
  won_lost_active_status: "Status",
  close_date: "Expected close date",
  win_probability_percent: "Win probability"
};
