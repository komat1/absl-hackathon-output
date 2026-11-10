import type { CSSProperties } from "react";

/**
 * The one thing on this screen that shows the AI is alive.
 *
 * A 3×3 lattice of dots where a bright head runs the perimeter clockwise and
 * leaves a decaying tail behind it — the same orb the admin panel this UI comes
 * from uses, on the same tokens. It carries "I'm working" on its own, at every
 * size, so the panel does not need a spinner, a pulsing icon and a blinking
 * caret all saying the same thing in three visual languages.
 *
 * The geometry is authored on a 28px stage and scaled by `--orb-k`, so the
 * hand-tuned dot size and 6px pitch hold at 16px and at 44px alike. The
 * animation is `animation-delay` only: eight identical loops seeded at eight
 * points in their cycle read as one object travelling, and cost one keyframe.
 *
 * RESTING IS STATIC — deliberately. An avatar that pulses while nothing happens
 * spends attention on nothing, and leaves the working state nowhere louder to
 * go. The CSS lives in styles.css (`.orb`) and freezes the lattice under
 * prefers-reduced-motion.
 */

/** The stage the geometry is tuned on; --orb-k scales it to `size`. */
const STAGE = 28;
const N = 3; // lattice is N×N
const PITCH = 6; // centre-to-centre spacing in stage px; the dot size is CSS

/** Clockwise walk of the lattice perimeter — the track the head runs on. */
const RING: [number, number][] = (() => {
  const ring: [number, number][] = [];
  for (let x = 0; x < N; x++) ring.push([x, 0]);
  for (let y = 1; y < N; y++) ring.push([N - 1, y]);
  for (let x = N - 2; x >= 0; x--) ring.push([x, N - 1]);
  for (let y = N - 2; y >= 1; y--) ring.push([0, y]);
  return ring;
})();

const RING_INDEX = new Map(RING.map(([x, y], index) => [`${x},${y}`, index]));

/** One turn of the head around the ring. Mirrored by `--orb-dur` in CSS. */
const DURATION = 1700;

interface Cell {
  key: string;
  left: number;
  top: number;
  /** Negative: seeds the cell partway into its cycle. That is the comet. */
  delay: number;
  /** Interior cells sit the run out, so the ring reads AS a ring. */
  still: boolean;
}

const CELLS: Cell[] = (() => {
  const cells: Cell[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const index = RING_INDEX.get(`${x},${y}`);
      cells.push({
        key: `${x},${y}`,
        left: x * PITCH,
        top: y * PITCH,
        delay:
          index === undefined ? 0 : -(((RING.length - index) % RING.length) / RING.length) * DURATION,
        still: index === undefined
      });
    }
  }
  return cells;
})();

export type OrbState = "idle" | "working" | "offline";

export function Orb({
  size = 20,
  state = "idle",
  label,
  className,
  style
}: {
  /** Rendered edge length in px. The 28px geometry scales to fit. */
  size?: number;
  state?: OrbState;
  /** Read out when the orb stands alone; omit when a visible label says it. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`orb${className ? ` ${className}` : ""}`}
      data-state={state}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, "--orb-k": size / STAGE, ...style } as CSSProperties}
    >
      <span className="orb-lattice">
        {CELLS.map((cell) => (
          <span
            key={cell.key}
            className="orb-cell"
            data-still={cell.still ? "" : undefined}
            style={{ left: cell.left, top: cell.top, animationDelay: `${cell.delay}ms` }}
          />
        ))}
      </span>
    </span>
  );
}
