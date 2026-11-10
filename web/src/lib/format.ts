import type { ValueFormat } from "@/types/blocks";

const money0 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const number0 = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 });
const number1 = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 });

/** One formatter for every figure on screen, so the same number never appears
 *  in two shapes on two blocks. */
export function formatValue(value: unknown, format: ValueFormat = "number"): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber) || format === "date") return value;
    return formatValue(asNumber, format);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);

  switch (format) {
    case "money":
      return Math.abs(value) >= 1_000_000
        ? `€${number1.format(value / 1_000_000)}M`
        : money0.format(value);
    case "percent":
      return `${number1.format(value)}%`;
    default:
      return number0.format(value);
  }
}

/**
 * Axis ticks need to be short, not precise — but they still have to be
 * distinct. Below €10k a whole number of thousands collapses €1,500 and €2,000
 * onto the same "€2k" tick, so an axis can print one label twice; under that
 * threshold the tick keeps a decimal.
 */
export function compactMoney(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000) return `€${number1.format(value / 1_000_000)}M`;
  if (size >= 10_000) return `€${number0.format(value / 1_000)}k`;
  if (size >= 1_000) return `€${number1.format(value / 1_000)}k`;
  return `€${number0.format(value)}`;
}

/** The categorical slots of the design system, assigned in fixed order and
 *  never cycled past the end — the server caps a chart at eight series, so a
 *  ninth hue is never generated. */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)"
];
