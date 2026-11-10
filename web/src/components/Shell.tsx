import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Sidebar, type ViewKey } from "@/components/Sidebar";
import { DashboardTabs } from "@/components/tabs/DashboardTabs";
import { health, type Health } from "@/lib/api";

/**
 * The frame: the places panel on the left, a topbar across the top, the
 * content card in the middle and the copilot in the right column.
 *
 * Same shape as the admin panel this is lifted from — the content card narrows
 * when the copilot is open rather than being covered by it, so a sales person
 * can read the figures and the conversation at the same time.
 */
export function Shell({
  children,
  dock,
  view,
  onView
}: {
  children: ReactNode;
  dock: ReactNode;
  view: ViewKey;
  onView: (view: ViewKey) => void;
}) {
  const [status, setStatus] = useState<Health | null>(null);

  useEffect(() => {
    void health().then(setStatus);
  }, []);

  return (
    <div
      className="grid h-dvh min-h-0 grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr] overflow-hidden"
      style={{ background: "var(--rail, var(--bg))" }}
    >
      <header className="app-topbar theme-frame col-span-full flex h-16 shrink-0 items-center gap-3 px-4">
        <img src="/cork-logo.png" alt="Cork" className="block h-10 w-auto" />

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {status && !status.ok && (
            <span className="badge badge-red" title={status.error}>
              {status.hint ?? "No database"}
            </span>
          )}
          {status?.ok && !status.agent_ready && (
            <span className="badge badge-amber" title="Set ANTHROPIC_API_KEY in .env">
              no API key
            </span>
          )}
        </div>
      </header>

      <Sidebar view={view} onView={onView} />

      {/* The middle column. The dashboard tabs lie on the frame and the content
          card hangs right under them, so the selected tab runs into the card
          (dashboardTabs.css) instead of floating above it. The audit trail is
          not a dashboard — it is one fixed page, so it gets no strip. */}
      <div className="app-main-col flex min-h-0 min-w-0 flex-col">
        {view === "canvas" && <DashboardTabs />}
        <main
          id="main"
          className="app-main-card min-h-0 flex-1 overflow-y-auto rounded-[14px] bg-background p-5"
          style={{ margin: "0 .5rem .5rem 0" }}
        >
          {children}
        </main>
      </div>

      <div className="ai-dock">{dock}</div>
    </div>
  );
}
