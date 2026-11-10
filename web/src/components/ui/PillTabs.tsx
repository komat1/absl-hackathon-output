import { useRef } from "react";
import { Icon } from "./Icon";

export interface PillTab<K extends string = string> {
  key: K;
  label: string;
  icon?: string;
  /** Amber dot — "something here needs attention" (missing docs, flagged device…). */
  alert?: boolean;
  /** Numeric badge after the label; renders even when 0 so the user sees the tab is empty. */
  count?: number;
  /**
   * Stavová farba počtu na NEVYBRATEJ záložke — „Po termíne 2" červeno, „Dnes 1"
   * jantárovo. Volajúci ju dáva len pri čísle väčšom ako 0: nula nehorí. Na
   * vybratej záložke sa nekreslí, tam počet preberá atrament záložky.
   */
  countTone?: "red" | "amber";
  /** Padlock after the label — the view is behind a paywall/permission gate. */
  lock?: boolean;
}

/**
 * Segmented pill switcher — the canonical intra-page view picker (Prehľad /
 * História… on the customer detail). Near-white active pill on a raised track;
 * see .tabs-pill-list / .tabs-pill-trigger in styles.css.
 *
 * The track is fit-content and scrolls horizontally inside its own wrapper, so
 * it never forces the page to overflow on narrow screens.
 *
 * Sémanticky je to `tablist`, nie rad tlačidiel, a to má dva dôsledky, ktoré
 * bez neho chýbali. Čítačka ohlási „záložka 2 z 5, vybraná" namiesto piatich
 * nesúvisiacich tlačidiel, z ktorých ani jedno nepovie, ktoré platí — vybranosť
 * niesla dovtedy VÝHRADNE farba. A klávesnica dostane to, čo od záložiek
 * očakáva: šípky prepínajú, Home/End skočia na kraj, a Tab z lišty odíde
 * rovno na obsah namiesto toho, aby preklikal každú záložku (`tabIndex` −1 na
 * nevybraných je „roving tabindex", štandardný vzor pre tablist).
 *
 * `aria-controls` sa zámerne NENASTAVUJE: obsah záložky si kreslí každá
 * volajúca plocha sama a polovica ich vôbec nemá `id`. Odkaz na neexistujúci
 * prvok je horší než žiadny — čítačka ho ohlási ako pokazený vzťah.
 */
export function PillTabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
  tourId,
  fill
}: {
  tabs: ReadonlyArray<PillTab<K>>;
  value: K;
  onChange: (key: K) => void;
  className?: string;
  /** `data-tour` kotva pre sprievodcov (lib/tours.ts) — záložky stránky ako celok. */
  tourId?: string;
  /** Dráha cez celú šírku rodiča, záložky si ju delia rovnakým dielom — prepínač
   *  v úzkom stĺpci (rail reťazca), kde by pilulka podľa obsahu visela pri kraji. */
  fill?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const jump = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (!step && jump < 0) return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.key === value);
    const next = step ? (at + step + tabs.length) % tabs.length : jump;
    const target = tabs[next];
    if (!target) return;
    onChange(target.key);
    // Fokus musí ísť ZA výberom, inak šípka prepne záložku a klávesnica ostane
    // stáť na predošlej — ďalšia šípka by potom skočila o dve.
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className={`${fill ? "flex w-full" : "inline-flex max-w-full"} overflow-x-auto ${className ?? ""}`} data-tour={tourId}>
      <div ref={listRef} role="tablist" className={fill ? "tabs-pill-list tabs-pill-fill" : "tabs-pill-list"} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={value === t.key}
            tabIndex={value === t.key ? 0 : -1}
            className="tabs-pill-trigger"
            data-state={value === t.key ? "active" : "inactive"}
            onClick={() => onChange(t.key)}
          >
            {t.icon && <Icon icon={t.icon} />}
            <span>{t.label}</span>
            {t.count != null && <span className="pill-count" data-tone={t.countTone}>{t.count}</span>}
            {t.lock && <Icon icon="fa-sharp fa-regular fa-lock" className="text-[11px]" />}
            {t.alert && <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--amber)" }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
