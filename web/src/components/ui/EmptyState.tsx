import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Canonical empty state — replaces the ad-hoc "Žiadne…" one-liners so every
 * list/table/panel communicates emptiness the same way: a bare muted icon,
 * short bold title, optional hint and optional CTA. Flat per DESIGN.md — no
 * borders, no illustration, no filler badge, and no disc behind the icon
 * (ikona v rámčeku je v RepUpe zámerne preč — farbu a váhu nesie ikona sama).
 *
 * Use `compact` inside dense spots (dropdown results, small side panels)
 * where the large icon + paddings of the full variant would shout.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
  className
}: {
  /** Full FontAwesome class, e.g. "fa-sharp fa-regular fa-users". */
  icon?: string;
  title: string;
  hint?: string;
  /** Optional CTA rendered under the text (typically a secondary Button). */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div className={`px-4 py-5 text-center text-sm text-[color:var(--text-3)] ${className ?? ""}`}>
        {icon && <Icon icon={icon} className="mr-2 text-[color:var(--text-4)]" />}
        {title}
        {hint && <span className="block pt-0.5 text-xs text-[color:var(--text-4)]">{hint}</span>}
        {/* `action` sa tu TICHO ZAHADZOVALO, takže každý kompaktný prázdny stav
            bol slepá ulica: volajúci odovzdal cestu von, komponent ju nevykreslil
            a nikto sa to nedozvedel — prop, ktorý nič nerobí, nehlási chybu.
            Kompaktný je len TVAR (menej priestoru, žiadny disk), nie iná zmluva. */}
        {action && <div className="pt-2">{action}</div>}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${className ?? ""}`}>
      {icon && <Icon icon={icon} className="text-[24px] text-[color:var(--text-3)]" />}
      <div className="space-y-1">
        <div className="text-sm font-bold text-[color:var(--text-2)]">{title}</div>
        {hint && <div className="mx-auto max-w-sm text-[12.5px] leading-5 text-[color:var(--text-3)]">{hint}</div>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
