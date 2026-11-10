import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatValue } from "@/lib/format";
import type { TableBlock } from "@/types/blocks";

const STATUS_TONE: Record<string, BadgeTone> = {
  Active: "blue",
  Won: "green",
  Lost: "red"
};

/** The drill-down table. Rows arrive already filtered, sorted and paginated by
 *  PostgreSQL — this component never sorts or filters client-side, because that
 *  would only ever reorder the page it happens to hold. */
export function TableView({ block }: { block: TableBlock }) {
  const shown = block.rows.length;
  const total = block.total_rows ?? shown;

  return (
    <section className="panel animate-block-in overflow-hidden">
      {(block.title || total > shown) && (
        <header className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4">
          <h3 className="text-[13px] font-semibold text-[color:var(--text-2)]">{block.title}</h3>
          <span className="shrink-0 text-[11.5px] tabular-nums text-[color:var(--text-4)]">
            {total > shown ? `${shown} of ${total.toLocaleString("en-IE")}` : `${shown} rows`}
          </span>
        </header>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-[color:var(--line)] text-left">
              {block.columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-4)] ${
                    column.align === "right" ? "text-right" : ""
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index} className="border-b border-[color:var(--line)] last:border-0 hover:bg-[color:var(--row-hover)]">
                {block.columns.map((column) => {
                  const value = row[column.key];
                  return (
                    <td
                      key={column.key}
                      className={`px-4 py-2.5 ${
                        column.align === "right" ? "text-right tabular-nums" : ""
                      } ${column.type === "money" || column.type === "number" ? "tabular-nums" : ""} text-[color:var(--text-2)]`}
                    >
                      {column.type === "badge" && typeof value === "string" ? (
                        <Badge tone={STATUS_TONE[value] ?? "gray"}>{value}</Badge>
                      ) : column.type === "text" || column.type === "date" ? (
                        <span className={String(value).includes("overdue") ? "text-[color:var(--red)]" : undefined}>
                          {value === null || value === "" ? "—" : String(value)}
                        </span>
                      ) : (
                        formatValue(value, column.type === "percent" ? "percent" : column.type === "money" ? "money" : "number")
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && (
        <p className="border-t border-[color:var(--line)] px-4 py-2.5 text-[11.5px] leading-5 text-[color:var(--text-4)]">
          {block.note}
        </p>
      )}
    </section>
  );
}
