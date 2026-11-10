import { rampFill, rampInk } from "@/lib/chartColors";
import { compactMoney, formatValue } from "@/lib/format";
import { ChartFrame } from "./ChartFrame";
import type { ChartBlock } from "@/types/blocks";

/**
 * A category-by-month grid.
 *
 * Forty cells is past the point where colour can carry identity, so here it
 * carries magnitude instead: one hue, deeper means more, which is the encoding
 * that survives being read as a grid. Every cell keeps its figure on hover and
 * the scale underneath says what the depth is worth.
 */
export function HeatmapView({ block }: { block: ChartBlock }) {
  const key = block.series[0]?.key ?? "value";
  const groupKey = block.group_key ?? "group";

  // Column order is the server's row order — months arrive sorted by the
  // database, and re-sorting them here as strings would scramble them.
  const columns: string[] = [];
  const rows: string[] = [];
  const cells = new Map<string, number>();
  let max = 0;
  for (const row of block.data) {
    const column = String(row[block.x_key] ?? "");
    const group = String(row[groupKey] ?? "");
    if (!columns.includes(column)) columns.push(column);
    if (!rows.includes(group)) rows.push(group);
    const value = Number(row[key] ?? 0);
    cells.set(`${group}\u0000${column}`, value);
    if (value > max) max = value;
  }
  rows.sort((a, b) => a.localeCompare(b));

  const grid = {
    display: "grid",
    gridTemplateColumns: `minmax(7rem, max-content) repeat(${columns.length}, minmax(2.25rem, 1fr))`,
    gap: "2px"
  } as const;

  return (
    <ChartFrame title={block.title} note={block.note} height={null}>
      <div className="overflow-x-auto">
        <div style={grid} className="min-w-[32rem]">
          <div />
          {columns.map((column) => (
            <div
              key={column}
              className="pb-1 text-center text-[10.5px] text-[color:var(--text-4)]"
              title={column}
            >
              {column}
            </div>
          ))}

          {rows.map((group) => (
            <Row
              key={group}
              group={group}
              columns={columns}
              cells={cells}
              max={max}
              block={block}
              /* A figure only goes in the cell when the cell is wide enough to
                 hold it. Ten months across a dashboard column leaves about
                 36px each — "€857,277" in that space overlaps its neighbour
                 and the grid stops being readable, so past six columns the
                 pattern carries the chart and the figures come from hover. */
              labelled={columns.length <= 6}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10.5px] text-[color:var(--text-4)]">
        <span>{formatValue(0, block.format)}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-[2px]">
          {Array.from({ length: 12 }, (_, step) => (
            <span key={step} className="flex-1" style={{ background: rampFill((step + 1) / 12) }} />
          ))}
        </div>
        <span>{formatValue(max, block.format)}</span>
      </div>
    </ChartFrame>
  );
}

function Row({
  group,
  columns,
  cells,
  max,
  block,
  labelled
}: {
  group: string;
  columns: string[];
  cells: Map<string, number>;
  max: number;
  block: ChartBlock;
  labelled: boolean;
}) {
  return (
    <>
      <div className="flex items-center pr-2 text-[11.5px] text-[color:var(--text-3)]">{group}</div>
      {columns.map((column) => {
        const value = cells.get(`${group}\u0000${column}`) ?? 0;
        const share = max > 0 ? value / max : 0;
        return (
          <div
            key={column}
            className="flex h-8 items-center justify-center overflow-hidden rounded-[4px] text-[10px] tabular-nums"
            style={{
              background: rampFill(share),
              color: rampInk(share),
              // A hairline keeps an empty cell part of the grid rather than a
              // hole in it.
              boxShadow: share === 0 ? "inset 0 0 0 1px var(--line)" : undefined
            }}
            title={`${group} · ${column} — ${formatValue(value, block.format)}`}
          >
            {labelled && share > 0.55 && block.format === "money"
              ? compactMoney(value)
              : labelled && share > 0.55
                ? formatValue(value, block.format)
                : ""}
          </div>
        );
      })}
    </>
  );
}
