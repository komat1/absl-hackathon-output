import type { ReactNode } from "react";

/**
 * The panel every chart sits in: title, plot, note.
 *
 * One frame rather than one per kind, so eleven forms share the same heading
 * size, the same note treatment and the same height — switching a chart's form
 * changes the marks inside the frame and nothing around them.
 */
export function ChartFrame({
  title,
  note,
  legend,
  height = 260,
  children
}: {
  title?: string | null;
  note?: string | null;
  legend?: ReactNode;
  /** `null` lets the content set its own height — the funnel and the heatmap
   *  grow with their rows instead of scrolling inside a fixed box. */
  height?: number | null;
  children: ReactNode;
}) {
  return (
    <section className="panel animate-block-in p-4">
      {(title || legend) && (
        <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          {title && (
            <h3 className="text-[13px] font-semibold text-[color:var(--text-2)]">{title}</h3>
          )}
          {legend && <div className="ml-auto">{legend}</div>}
        </header>
      )}
      <div className="w-full" style={height === null ? undefined : { height }}>
        {children}
      </div>
      {note && <p className="mt-2.5 text-[11.5px] leading-5 text-[color:var(--text-4)]">{note}</p>}
    </section>
  );
}

/**
 * A legend of swatches and names.
 *
 * Always drawn for two or more series — identity is never carried by colour
 * alone — and the names wear text tokens rather than their series colour, so
 * the swatch beside them is what does the identifying.
 */
export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-3)]">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}
