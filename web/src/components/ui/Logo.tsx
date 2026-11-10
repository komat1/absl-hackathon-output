/**
 * The product mark: three rounded bars climbing, with a dot released off the
 * tallest one — signal strength and a deal moving forward in the same shape.
 *
 * Inline SVG rather than an icon from the kit, because this one is the brand:
 * it has to hold its own geometry at 16px and at 64px. It paints in
 * `currentColor`, so the tile sets the colour.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        <rect x="3" y="14" width="3.6" height="7" rx="1.8" opacity="0.55" />
        <rect x="9.2" y="10" width="3.6" height="11" rx="1.8" opacity="0.78" />
        <rect x="15.4" y="6" width="3.6" height="15" rx="1.8" />
      </g>
      <circle cx="17.2" cy="2.6" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The mark on its tile, as it sits in the topbar. `size` is the tile's edge in
 * pixels; the glyph keeps its proportion inside it.
 */
export function LogoTile({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center text-white${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3125),
        background:
          "linear-gradient(145deg, color-mix(in oklab, var(--brand) 82%, white) 0%, var(--brand) 55%, color-mix(in oklab, var(--brand) 80%, black) 100%)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.22)"
      }}
    >
      <LogoMark className="w-[62%]" />
    </span>
  );
}
