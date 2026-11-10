
/**
 * Hairline width — the ONE line the design system draws (`--line`), pinned to a
 * WHOLE number of device pixels.
 *
 * A CSS `1px` border is 1 device pixel on a 100 % Windows desktop and 2 on a
 * Retina Mac, and both are crisp because the number is an integer. Windows'
 * default display scaling is not: at 125 % one CSS pixel is 1,25 device pixels,
 * which the renderer cannot draw — it antialiases the line across two device
 * pixels at partial coverage, and `rgba(255,255,255,.07)` spread over two rows
 * of pixels reads as a fainter, thinner line than the same value drawn solidly
 * over one. Worse, the coverage depends on where the element happens to land in
 * the layout, so two lines in the same card come out at different weights.
 *
 * So the width is derived from the ratio instead of being a constant: take the
 * largest whole number of device pixels that still fits inside 1 CSS px
 * (`floor(dpr)`, at least one) and express it back in CSS pixels. Every hairline
 * in the app then lands on exact pixel boundaries with nothing to antialias —
 * one uniform thickness per screen, at the physical size the design intends
 * (1 device px on a 125 % Windows panel is about as thick as 2 device px on a
 * Retina Mac, because the pixels themselves are that much bigger).
 *
 * The value feeds `--hairline`, which styles.css hands to Tailwind as
 * `--default-border-width`, so `border`, `border-t`, `divide-y` and the
 * hand-written rules all read the same number.
 */

const VAR = "--hairline";

function hairline(ratio: number): { devicePixels: number; css: string } {
  // A ratio the browser doesn't report (0, NaN) means "assume 1:1" — never
  // divide by it.
  const dpr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  // The most whole device pixels that still fit inside the 1 CSS px the design
  // system asks for — at least one, or the line would disappear.
  const devicePixels = Math.max(1, Math.floor(dpr));
  // An integer ratio already draws 1 CSS px on exact boundaries; anything else
  // is handed to the browser as a division rather than as a rounded decimal
  // (1/3 typed out is 0.3333px, which is a THIRD of a pixel short of whole).
  const css =
    Number.isInteger(dpr) ? `${devicePixels / dpr}px` : `calc(1px * ${devicePixels} / ${dpr})`;
  return { devicePixels, css };
}

function apply(): void {
  document.documentElement.style.setProperty(VAR, hairline(window.devicePixelRatio).css);
}

/**
 * `devicePixelRatio` fires no change event of its own — the standard way to
 * watch it is a media query pinned to the CURRENT ratio, which stops matching
 * the moment the ratio moves (the user changes the display scaling, drags the
 * window to a second monitor, or zooms the browser, which shifts the DPR too).
 * Each listener is therefore single-shot and re-arms against the new ratio.
 */
function watch(): void {
  const dpr = window.devicePixelRatio || 1;
  const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
  const onChange = () => {
    apply();
    watch();
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange, { once: true });
  } else {
    // Safari < 14
    const legacy = query as MediaQueryList & { addListener?: (cb: () => void) => void; removeListener?: (cb: () => void) => void };
    const handler = () => {
      legacy.removeListener?.(handler);
      onChange();
    };
    legacy.addListener?.(handler);
  }
}

export function initHairline(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  apply();
  watch();
}

export const __testing = { hairline };
