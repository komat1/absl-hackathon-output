import { CHART_COLORS } from "@/lib/format";
import type { BlockTone, ChartBlock, ChartSeries } from "@/types/blocks";

/**
 * Which colour a mark wears, and why.
 *
 * Three jobs, three rules. A series is told apart from its neighbours
 * (categorical, fixed order). A cell says how big it is (sequential, one hue).
 * A state says what it is (status, reserved) — and a status colour is never
 * borrowed to mean "the fourth series", which is why it lives in its own table
 * and arrives through `tone` rather than through a slot index.
 */
export const TONE_COLOR: Record<BlockTone, string> = {
  good: "var(--green)",
  bad: "var(--red)",
  warn: "var(--amber)",
  info: "var(--blue)",
  neutral: "var(--text-4)"
};

/** A series keeps its colour even when a filter drops the series beside it:
 *  `tone` pins it to a meaning, and the index is only the fallback. */
export function seriesColor(series: ChartSeries, index: number): string {
  return series.tone ? TONE_COLOR[series.tone] : CHART_COLORS[index % CHART_COLORS.length];
}

/** A scatter's classes are states — overdue, closing soon, on track — so they
 *  come from the status table when the server named one. */
export function groupColor(block: ChartBlock, group: string, index: number): string {
  const tone = block.group_tones?.[group];
  return tone ? TONE_COLOR[tone] : CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * The sequential ramp: one hue, light → dark, for a heatmap cell.
 *
 * The design system defines categorical slots only, so the ramp is mixed
 * against the panel surface rather than listed as a second table of hex values
 * — which keeps it monotonic and correct in both themes from one definition.
 */
export function rampFill(share: number): string {
  const step = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  if (step <= 0) return "transparent";
  // A floor so the smallest non-zero cell is still visible, and a ceiling short
  // of the full hue so the darkest cell keeps its label readable.
  const mix = 10 + step * 80;
  return `color-mix(in oklab, var(--chart-2) ${mix.toFixed(1)}%, var(--raise))`;
}

/** Text that has to sit on top of a ramp cell. */
export function rampInk(share: number): string {
  return share > 0.55 ? "var(--text)" : "var(--text-3)";
}
