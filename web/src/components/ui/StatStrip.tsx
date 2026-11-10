import type { ReactNode } from "react";

export type StatItem = {
  label: string;
  value: ReactNode;
  /** Tichý druhý riadok pod číslom („Spinning · o 25 min", „z 8 · 3 ešte"). */
  sub?: ReactNode;
  /** CSS colour for the value (e.g. "var(--green)"). Defaults to var(--text). */
  tone?: string;
  /**
   * Toto je HODNOTA, ktorá sa meria — jediná dlaždica v pruhu, ktorá nesie
   * akcent (DESIGN.md §8: „at most one accent KPI tile in a row").
   *
   * Explicitný `tone` ju prebije: stavová farba (zelený zisk, červený rozdiel
   * v pokladni) hovorí o hodnote niečo, čo akcent povedať nevie.
   */
  accent?: boolean;
};

/**
 * Thin metric band shown at the top of list / board pages. Responsive: 2-up on
 * mobile, N-up (3 or 4) on desktop. Shared hairlines separate the columns
 * without leaving a stray divider where a mobile row wraps.
 *
 * `footer` is for the one thing that belongs to the same figures — typically a
 * `ProportionBar` splitting the band's own numbers. It lives INSIDE the card:
 * a bar floating under the surface reads as a separate element and, at full
 * page width, as a stray rule across the screen.
 */
export function StatStrip({ items, footer }: { items: StatItem[]; footer?: ReactNode }) {
  const cols = items.length >= 4 ? "md:grid-cols-4" : items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  const desktopColumns = Math.min(Math.max(items.length, 2), 4);
  // „Najviac jeden akcent v rade" vynucuje KOMPONENT, nie disciplína volajúceho:
  // štyri červené čísla vedľa seba nie sú štyri dôležité údaje, sú to nula
  // dôležitých údajov. Vyhráva prvá označená dlaždica.
  const accentIndex = items.findIndex((s) => s.accent && !s.tone);

  return (
    <div className="rounded-[var(--r-tile)] bg-[color:var(--raise)] p-4">
      <div className={`grid grid-cols-2 gap-4 ${cols}`}>
        {items.map((s, i) => (
          <div key={i} className="relative px-2 py-1">
            <span
              aria-hidden="true"
              className={`absolute inset-y-1 -left-2 w-px bg-[color:var(--line)] ${
                i % 2 !== 0 ? "block" : "hidden"
              } ${i % desktopColumns !== 0 ? "md:block" : "md:hidden"}`}
            />
            {/* v2: quiet sentence-case label + calm bold number */}
            <div className="text-[12.5px] font-medium text-[color:var(--text-3)]">{s.label}</div>
            <div
              className="mt-1 text-[26px] font-bold leading-none tabular-nums"
              style={{ color: s.tone ?? (i === accentIndex ? "var(--brand-500)" : "var(--text)"), letterSpacing: "-0.02em" }}
            >
              {s.value}
            </div>
            {s.sub ? (
              <div className="mt-1.5 text-[12px] font-medium leading-snug text-[color:var(--text-3)]">{s.sub}</div>
            ) : null}
          </div>
        ))}
      </div>
      {footer ? <div className="mt-4 px-2">{footer}</div> : null}
    </div>
  );
}
