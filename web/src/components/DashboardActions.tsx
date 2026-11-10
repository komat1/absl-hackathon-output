import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { DashboardFileError, readDashboardFile } from "@/lib/dashboardFile";
import { printDashboard } from "@/lib/print";
import { useChat } from "@/stores/chat";
import { useDashboards } from "@/stores/dashboards";

/**
 * Print · export · import — the row over the dashboard on the canvas.
 *
 * It sits on the canvas rather than in the frame on purpose: these three act on
 * the dashboard that is on screen, so they belong to it, and printing then
 * needs no second report to keep in step with the first (lib/print.ts).
 *
 * Printing and exporting are off while the dashboard is empty or still being
 * built; importing opens a tab of its own, so it is always there.
 */
export function DashboardActions() {
  const blocks = useChat((state) => state.blocks);
  const streaming = useChat((state) => state.streaming);
  const exportActive = useDashboards((state) => state.exportActive);
  const importFile = useDashboards((state) => state.importFile);
  const picker = useRef<HTMLInputElement>(null);
  /** What went wrong with the last file, said once beside the buttons. */
  const [problem, setProblem] = useState<string | null>(null);
  /** The file just written, so the click has an answer on screen. */
  const [saved, setSaved] = useState<string | null>(null);

  const empty = blocks.length === 0 || streaming;

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setSaved(null);
    try {
      importFile(await readDashboardFile(file));
    } catch (error) {
      setProblem(error instanceof DashboardFileError ? error.message : "That file could not be read.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5" data-print-hide>
      {(problem ?? saved) && (
        <span
          className="mr-auto min-w-0 truncate text-[11.5px]"
          style={{ color: problem ? "var(--red)" : "var(--text-4)" }}
          role="status"
        >
          {problem ?? `Saved as ${saved}`}
        </span>
      )}

      <button
        type="button"
        className="icon-button disabled:pointer-events-none disabled:opacity-40"
        disabled={empty}
        onClick={() => printDashboard()}
        title="Print this dashboard"
        aria-label="Print this dashboard"
      >
        <Icon icon="fa-sharp fa-regular fa-print" />
      </button>

      <button
        type="button"
        className="icon-button disabled:pointer-events-none disabled:opacity-40"
        disabled={empty}
        onClick={() => {
          setProblem(null);
          const name = exportActive();
          setSaved(name);
          if (!name) setProblem("This dashboard has nothing to export yet.");
        }}
        title="Export this dashboard to a file"
        aria-label="Export this dashboard to a file"
      >
        <Icon icon="fa-sharp fa-regular fa-file-export" />
      </button>

      <button
        type="button"
        className="icon-button"
        onClick={() => picker.current?.click()}
        title="Import a dashboard from a file"
        aria-label="Import a dashboard from a file"
      >
        <Icon icon="fa-sharp fa-regular fa-file-import" />
      </button>

      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        // The value is cleared so picking the same file twice fires twice.
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void pick(file);
        }}
      />
    </div>
  );
}
