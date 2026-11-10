import { Metric } from "@/components/ui/Metric";
import { formatValue } from "@/lib/format";
import type { StatsBlock } from "@/types/blocks";

/** Summary cards. The first one carries the accent — one per row, per the
 *  design system, so the eye has a single entry point. */
export function StatsView({ block }: { block: StatsBlock }) {
  return (
    <section className="animate-block-in">
      {block.title && (
        <h3 className="mb-2.5 text-[13px] font-semibold text-[color:var(--text-2)]">{block.title}</h3>
      )}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {block.items.map((item, index) => (
          <Metric
            key={item.label}
            label={item.label}
            value={formatValue(item.value, item.format)}
            tone={index === 0 ? "accent" : item.tone === "good" ? "good" : item.tone === "bad" ? "bad" : "neutral"}
            note={item.sublabel ?? undefined}
            delta={
              item.delta_percent == null
                ? undefined
                : {
                    value: `${Math.abs(item.delta_percent).toFixed(1)}%`,
                    direction: item.delta_percent >= 0 ? "up" : "down"
                  }
            }
          />
        ))}
      </div>
    </section>
  );
}
