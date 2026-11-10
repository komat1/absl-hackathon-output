import { formatValue } from "@/lib/format";
import type { ValueFormat } from "@/types/blocks";

export interface TipRow {
  name: string;
  value: number | string | null | undefined;
  color?: string;
  format?: ValueFormat;
  /** Printed as given — a share, a date, a count already worded. */
  raw?: string;
}

/**
 * One tooltip for every chart.
 *
 * Hover is not a nicety here: the axis is compacted to "€1.2M" so it stays
 * legible, which means the exact figure has to live somewhere, and this is
 * where. Rows come pre-shaped by each chart so the tooltip never has to know
 * what kind of chart asked for it.
 */
export function ChartTip({ heading, rows }: { heading?: string; rows: TipRow[] }) {
  return (
    <div className="menu-pop min-w-[11rem] rounded-[var(--r-sm)] px-3 py-2 text-[12px]">
      {heading && <div className="mb-1 font-semibold text-[color:var(--text)]">{heading}</div>}
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2 text-[color:var(--text-2)]">
          {row.color && <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />}
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="font-semibold tabular-nums text-[color:var(--text)]">
            {row.raw ?? formatValue(row.value, row.format ?? "number")}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Recharts hands a tooltip its own props; this adapts them to TipRow. */
export interface RechartsTipProps {
  active?: boolean;
  label?: string | number;
  payload?: {
    name?: string;
    value?: number | string;
    color?: string;
    dataKey?: string | number;
    /** The whole data row behind the mark — what a scatter or a waterfall step
     *  reads, since one point carries more than the value on the axis. */
    payload?: Record<string, string | number | null>;
  }[];
}
