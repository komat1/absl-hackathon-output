import { formatValue } from "@/lib/format";
import { rampFill } from "@/lib/chartColors";
import { ChartFrame } from "./ChartFrame";
import type { ChartBlock } from "@/types/blocks";

/**
 * Phase-by-phase drop-off, as rows rather than a tapering cone.
 *
 * A cone makes the reader compare trapezoid areas, which nobody does well. Rows
 * on one baseline compare exactly, keep the stage names horizontal and readable
 * at any width, and leave room for both of the numbers a sales person wants:
 * what survived this step, and what is left of the top of the funnel.
 */
export function FunnelView({ block }: { block: ChartBlock }) {
  const key = block.series[0]?.key ?? "value";
  const values = block.data.map((row) => Number(row[key] ?? 0));
  const max = Math.max(...values, 0);

  return (
    <ChartFrame title={block.title} note={block.note} height={null}>
      <ol className="flex flex-col gap-1.5">
        {block.data.map((row, index) => {
          const value = Number(row[key] ?? 0);
          const share = max > 0 ? value / max : 0;
          const retention = row.step_retention;
          const ofFirst = row.share_of_first;
          return (
            <li key={String(row[block.x_key] ?? index)}>
              {index > 0 && (
                <div className="flex items-center gap-1.5 py-1 pl-1 text-[10.5px] text-[color:var(--text-4)]">
                  <span aria-hidden>↓</span>
                  {retention === null || retention === undefined
                    ? "—"
                    : `${formatValue(retention, "percent")} of the step before`}
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-[color:var(--text-2)]">
                  {String(row[block.x_key] ?? "")}
                </span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-[color:var(--text-4)]">
                  {ofFirst === null || ofFirst === undefined
                    ? null
                    : `${formatValue(ofFirst, "percent")} of the first phase`}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2.5">
                <div
                  className="h-7 min-w-[3px] rounded-[4px] transition-[width] duration-500"
                  style={{ width: `${Math.max(share * 100, 1.5)}%`, background: rampFill(share) }}
                />
                {/* Direct labels, not a legend: one hue carries magnitude, and
                    the figure beside the bar is what names it. */}
                <span className="text-[12.5px] font-semibold tabular-nums text-[color:var(--text)]">
                  {formatValue(value, block.format)}
                </span>
                <span className="text-[11px] tabular-nums text-[color:var(--text-4)]">
                  {block.format === "money"
                    ? `${formatValue(row.deals, "number")} deals`
                    : `${formatValue(row.deal_value, "money")}`}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}
