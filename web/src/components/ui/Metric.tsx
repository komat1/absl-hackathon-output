import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type MetricTone = "neutral" | "good" | "bad" | "accent";

/**
 * Calm v2 stat tile: quiet label, loud tabular value, and one optional note.
 * Pass `tone="accent"` for the brand-red highlighted tile (one per row).
 */
export function Metric({
  label,
  value,
  tone = "neutral",
  delta,
  note,
  onAction
}: {
  label: string;
  value: string;
  tone?: MetricTone;
  delta?: { value: string; direction: "up" | "down" };
  note?: ReactNode;
  /** If provided, renders the top-right circular arrow button. */
  onAction?: () => void;
}) {
  const accent = tone === "accent";
  const valueColor = accent
    ? "text-white"
    : tone === "good" ? "text-[color:var(--green)]"
    : tone === "bad" ? "text-[color:var(--red)]"
    : "text-[color:var(--text)]";
  const labelColor = accent ? "text-white/85" : "text-[color:var(--text-2)]";
  // On the accent tile the surface is brand red in BOTH themes, so the button must
  // be genuinely white — `bg-white` would go through styles.css's dark-mode bridge
  // (`.dark .bg-white` → --raise) and render near-black on the red card.
  const arrowBtnClass = accent
    ? "bg-[#ffffff] text-[color:var(--brand)]"
    : "bg-[color:var(--chip)] text-[color:var(--text)] hover:bg-[color:var(--chip-2)]";

  return (
    <div className={`metric-card min-w-0 ${accent ? "accent" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`min-w-0 truncate text-[12.5px] font-medium leading-tight ${labelColor}`}>{label}</div>
        {onAction && (
          <button
            type="button"
            onClick={onAction}
            className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[var(--r-sm)] transition-colors ${arrowBtnClass}`}
            aria-label={label}
          >
            <Icon icon="fa-sharp fa-regular fa-arrow-up-right" className="text-[13px]" />
          </button>
        )}
      </div>
      <div
        className={`mt-3 break-words text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums ${valueColor}`}
      >
        {value}
      </div>
      {(delta || note) && (
        <div className="mt-3 flex min-w-0 items-center gap-2.5">
          {delta && (
            <span
              className={`delta ${delta.direction}`}
              style={accent ? { background: "rgba(255,255,255,0.18)", color: "#fff" } : undefined}
            >
              <Icon icon={delta.direction === "up" ? "fa-sharp fa-regular fa-arrow-up" : "fa-sharp fa-regular fa-arrow-down"} className="text-[10px]" />
              {delta.value}
            </span>
          )}
          {note && (
            <span className={`min-w-0 truncate text-xs font-medium ${accent ? "text-white/75" : "text-[color:var(--text-3)]"}`}>
              {note}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
