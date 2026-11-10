import { DealsPanel } from "@/components/DealsPanel";
import { Icon } from "@/components/ui/Icon";
import "@/components/sidebar.css";

/** The three things that are places. Everything else is a question. */
export type ViewKey = "canvas" | "research" | "changes";

const PAGES: { key: ViewKey; icon: string; label: string; hint: string }[] = [
  {
    key: "canvas",
    icon: "fa-sharp fa-regular fa-chart-mixed",
    label: "Dashboard",
    hint: "Whatever the conversation has built"
  },
  {
    key: "research",
    icon: "fa-sharp fa-regular fa-binoculars",
    label: "Researcher",
    hint: "Public, dated context from the web — not from the sales database"
  },
  {
    key: "changes",
    icon: "fa-sharp fa-regular fa-pen-to-square",
    label: "My changes",
    hint: "The deal updates you have confirmed, at a glance"
  }
];

/**
 * The left sidebar — the admin panel's area panel, with the rows it has there:
 * a name, an icon and a pill that fills when you are standing on it.
 *
 * It holds PLACES, not questions. It used to be four section tabs with nothing
 * behind them, which advertised a fixed-page app — the opposite of what this
 * one is. It now carries only what the copilot cannot or should not produce:
 * the generated canvas, the researcher — which looks outside the database and
 * takes a minute doing it, so it cannot live inside a chat answer — and the
 * write log that has to be openable to be worth anything. The dashboards are tabs over the card, not rows here: each one is a
 * conversation you open, close and pin, and mixing them into the places would
 * make the panel two lists wearing one shape.
 *
 * The panel lies on the frame (`.theme-frame`, its own dark tokens), so in the
 * light theme it is a near-black card beside the white content card — the same
 * inversion the admin panel uses, where the chrome stays dark in both themes
 * and only the page under it turns over.
 *
 * Under the places sits the one list that is not an answer: the Active book
 * (components/DealsPanel.tsx). It belongs here for the same reason the audit
 * trail is a page — a sales person has to see what is open without asking —
 * and it keeps the panel's rule intact, because a deal row is not a fourth
 * place: clicking it asks the copilot about that deal, on the canvas.
 */
export function Sidebar({ view, onView }: { view: ViewKey; onView: (view: ViewKey) => void }) {
  return (
    <aside className="app-side theme-frame">
      <nav className="app-side-panel nav-panel app-side-places" aria-label="Places">
        <div className="app-side-head">Cork</div>
        {PAGES.map((page) => (
          <button
            key={page.key}
            type="button"
            className={`nav-item${view === page.key ? " active" : ""}`}
            aria-current={view === page.key ? "page" : undefined}
            title={page.hint}
            onClick={() => onView(page.key)}
          >
            <Icon icon={page.icon} className="nav-icon" />
            <span className="truncate">{page.label}</span>
          </button>
        ))}
      </nav>

      <div className="app-side-rule" aria-hidden="true" />

      {/* A deal is asked about, not navigated to, so the list sends the question
          and puts the canvas back in front of the answer. */}
      <DealsPanel onOpen={() => onView("canvas")} />
    </aside>
  );
}
