import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useDashboards } from "@/stores/dashboards";

/**
 * The head of the printed sheet — invisible on screen, shown only by print.css.
 *
 * A printout leaves the app: it ends up in a meeting, in a folder, on someone
 * else's desk. So it has to say which dashboard it is, what question built it,
 * when it was printed, and — the one line the brief insists on everywhere —
 * that the company names are real while the business data is simulated.
 *
 * The timestamp is taken when the browser announces the print, not when the
 * canvas last rendered: a dashboard can sit open for hours. `flushSync` is what
 * makes that land — the sheet is composed the moment `beforeprint` returns, so
 * a state update left to React's own scheduling would miss it.
 */
export function PrintHeader() {
  const tab = useDashboards((state) => state.tabs.find((candidate) => candidate.id === state.activeId));
  const [printedAt, setPrintedAt] = useState<Date>(() => new Date());

  useEffect(() => {
    const stamp = () => flushSync(() => setPrintedAt(new Date()));
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);

  return (
    <header className="print-head">
      <div className="print-head__title">{tab?.title ?? "Dashboard"}</div>
      {tab?.seed && <div className="print-head__question">{`“${tab.seed}”`}</div>}
      <div className="print-head__meta">
        {`Cork · sales copilot · printed ${printedAt.toLocaleString("en-IE")} · company names are real, all business data is simulated`}
      </div>
    </header>
  );
}
