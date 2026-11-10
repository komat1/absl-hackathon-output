import { Icon } from "./Icon";

/**
 * The change-vs-previous-period indicator, backing the `.delta` recipe that
 * DESIGN.md §5 documents and that had no users — every dashboard drew its own
 * instead (a filled pill on the analyst, bare text + an FA arrow on Štatistiky,
 * bare text in a Tailwind emerald on Reťazec). An owner reads those screens back
 * to back, so the same fact was three shapes and two greens.
 *
 * No chip background: the doc is explicit that a delta is coloured text plus an
 * inline arrow, so it sits beside a number without competing with it.
 */
export function Delta({
  value,
  /** Suffix after the number. Percentage points are the common case. */
  unit = "%",
  /** Flip the colouring where DOWN is the good direction (costs, no-shows). */
  invert = false,
  className
}: {
  value: number | null | undefined;
  unit?: string;
  invert?: boolean;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) {
    return (
      <span className={`delta ${className ?? ""}`} style={{ color: "var(--text-3)" }}>
        0{unit}
      </span>
    );
  }
  const up = rounded > 0;
  const good = invert ? !up : up;
  return (
    <span className={`delta ${good ? "up" : "down"} ${className ?? ""}`}>
      <Icon icon={up ? "fa-sharp fa-regular fa-arrow-trend-up" : "fa-sharp fa-regular fa-arrow-trend-down"} />
      {up ? "+" : "−"}
      {Math.abs(rounded)}
      {unit}
    </span>
  );
}
