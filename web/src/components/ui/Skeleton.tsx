import type { CSSProperties } from "react";

/**
 * Flat loading placeholders for the brief window before Dexie-backed data pops
 * in. Design-system compliant: a single `--raise` surface with a gentle opacity
 * pulse (no gradients, no shimmer sweep). The pulse is disabled under
 * `prefers-reduced-motion` via Tailwind's `motion-reduce:animate-none`.
 *
 * @example
 *   // A single custom block
 *   <Skeleton className="h-4 w-32" />
 *
 * @example
 *   // n list-rows sized to the app's row rhythm, used as a ListPanel emptyState
 *   // while data is still loading:
 *   <ListPanel
 *     rows={ready ? rows : []}
 *     emptyState={ready ? undefined : <SkeletonRows rows={6} avatar />}
 *     …
 *   />
 */
export function Skeleton({
  className = "",
  style
}: {
  className?: string;
  /** Inline overrides (e.g. an exact width) when a utility class won't do. */
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse motion-reduce:animate-none rounded-[var(--r-xs)] bg-[color:var(--raise)] ${className}`}
      style={style}
    />
  );
}

/**
 * `rows` placeholder list-rows matching the app's row rhythm (a leading avatar
 * dot when `avatar`, a wide primary bar, and a short trailing bar). Widths are
 * lightly varied per row so the block doesn't read as a rigid grid. Intended as
 * a drop-in `emptyState` for `ListPanel` (or any list) while its data loads —
 * shows structure instead of a bare spinner or an empty flash.
 *
 * @param rows   how many placeholder rows to render
 * @param height bar height in px (default 14, matching the 14px row text)
 * @param avatar render a leading circular avatar placeholder per row
 */
export function SkeletonRows({
  rows,
  height = 14,
  avatar = false
}: {
  rows: number;
  height?: number;
  avatar?: boolean;
}) {
  // Deterministic width variation so rows look organic without re-randomising
  // on every render (which would itself look like motion).
  const widths = ["72%", "58%", "66%", "48%", "62%", "54%"];
  return (
    <div aria-hidden="true" className="w-full">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-2 py-3.5"
          style={{ borderTop: i === 0 ? undefined : "var(--hairline) solid var(--line)" }}
        >
          {avatar && <Skeleton className="size-9 shrink-0 rounded-full" />}
          <Skeleton style={{ height, width: widths[i % widths.length], maxWidth: "100%" }} />
          <div className="ml-auto">
            <Skeleton style={{ height, width: 56 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
