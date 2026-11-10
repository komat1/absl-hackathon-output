import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useDashboards } from "@/stores/dashboards";
import "./dashboardHistory.css";

/**
 * Closed dashboards, newest first — the clock beside the copilot's "new"
 * button. The tab strip is what is open; this is what was.
 *
 * Reopening one inside the same page brings its conversation back whole, server
 * session included, so a follow-up question continues it. After a reload only
 * the question is left and the dashboard builds itself again; each row says
 * which of the two it will be.
 */
export function DashboardHistory() {
  const entries = useDashboards((state) => state.history);
  const reopen = useDashboards((state) => state.reopen);
  const forget = useDashboards((state) => state.forget);
  const clearHistory = useDashboards((state) => state.clearHistory);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else and on Escape — the panel's own clicks stop
  // at the wrapper, so reopening from a row does not have to fight it.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={wrap} className="dh-wrap">
      <button
        type="button"
        className="ai-bubble-ghost"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((was) => !was)}
        title={entries.length ? `Closed dashboards (${entries.length})` : "Closed dashboards"}
        aria-label="Closed dashboards"
      >
        <Icon icon="fa-sharp fa-regular fa-clock-rotate-left" />
      </button>

      {open && (
        <div className="dh-pop menu-pop" role="menu">
          <div className="dh-head">
            <span>Recently closed</span>
            {entries.length > 0 && (
              <button type="button" className="dh-clear" onClick={() => clearHistory()}>
                Clear
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="dh-empty">
              Nothing closed yet. A dashboard you close keeps its question here, so you can pick it up again.
            </p>
          ) : (
            <ul className="dh-list">
              {entries.map((entry) => (
                <li key={entry.entryId}>
                  <button
                    type="button"
                    role="menuitem"
                    className="dh-row"
                    onClick={() => {
                      setOpen(false);
                      reopen(entry.entryId);
                    }}
                    title={entry.question}
                  >
                    <Icon icon={entry.icon} className="dh-icon" />
                    <span className="min-w-0 flex-1">
                      <span className="dh-title">
                        {entry.title}
                        <span className="dh-when">{since(entry.closedAt)}</span>
                      </span>
                      <span className="dh-question">
                        {entry.restorable ? "Comes back as it was" : (entry.question ?? "No question saved")}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dh-forget"
                    title="Forget this one"
                    aria-label={`Forget ${entry.title}`}
                    onClick={() => forget(entry.entryId)}
                  >
                    <Icon icon="fa-sharp fa-regular fa-xmark" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** "4 min ago" — close enough to place a dashboard in the day. */
function since(stamp: number): string {
  if (!stamp) return "";
  const minutes = Math.round((Date.now() - stamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(stamp).toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
}
