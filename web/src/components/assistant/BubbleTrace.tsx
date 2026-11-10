import { useEffect, useRef, useState } from "react";
import { Orb } from "./Orb";
import { Icon } from "@/components/ui/Icon";

/**
 * What the copilot did while it was answering.
 *
 * Shaped the way the chats people already know draw it (Perplexity, Dropbox
 * Dash): no rail of dots, but a row per step with an ICON for the kind of work,
 * a short title and a quiet detail under it. Above them one calm line — while
 * it runs "Thinking", afterwards "Thought for 6 s", which unfolds. No surface
 * and no outline: it is a note on the answer, not a card beside it.
 *
 * It is also the audit trail a judge asks for — "where did that number come
 * from?" is answered on screen, in the server's own words. The labels are
 * written by `Session.step` in api/app/agent.py, one per tool; a label this
 * table does not know still gets a row, just a generic glyph.
 */
export function BubbleTrace({
  steps,
  startedAt,
  endedAt,
  live
}: {
  steps: string[];
  startedAt?: number;
  endedAt?: number;
  live: boolean;
}) {
  // The opening "Thinking" is filler until the first real step arrives — in the
  // list it would be noise, it belongs in the header line.
  const work = steps.filter((step) => !isThinking(step)).map(parseStep);

  const [open, setOpen] = useState(live);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen(live);
  }, [live]);

  const seconds = startedAt && endedAt ? Math.max(1, Math.round((endedAt - startedAt) / 1000)) : 0;
  const canOpen = work.length > 0;

  return (
    <div className="ai-trace">
      <button
        type="button"
        className="ai-trace-toggle"
        data-live={live ? "true" : undefined}
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        onClick={() => {
          touched.current = true;
          setOpen((value) => !value);
        }}
      >
        <span className="ai-trace-glyph">
          {live ? <Orb size={14} state="working" /> : <Icon icon="fa-sharp fa-regular fa-sparkles" />}
        </span>
        {live ? (
          <span className="analyst-shimmer font-medium">Thinking</span>
        ) : (
          <span>{seconds > 0 ? `Thought for ${formatSeconds(seconds)}` : "Thought"}</span>
        )}
        {canOpen && (
          <Icon
            icon="fa-sharp fa-regular fa-chevron-down"
            className="ai-trace-chevron"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          />
        )}
      </button>

      {canOpen && (
        <div className="analyst-collapse" data-open={open ? "true" : "false"}>
          <div>
            <ol className="ai-trace-list">
              {work.map((step, index) => {
                const running = live && index === work.length - 1;
                return (
                  <li
                    key={`${index}-${step.title}-${step.detail}`}
                    className="ai-trace-step analyst-step"
                    data-running={running ? "true" : undefined}
                    style={{ ["--i" as string]: String(Math.min(index, 8)) }}
                  >
                    <span className="ai-trace-glyph">
                      <Icon icon={`fa-sharp fa-regular ${iconFor(step.title)}`} />
                    </span>
                    <span className="min-w-0">
                      <span className={`block ${running ? "analyst-shimmer" : ""}`}>{step.title}</span>
                      {step.detail && <span className="ai-trace-detail">{step.detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function isThinking(step: string): boolean {
  return step === "Thinking";
}

/** "Looking up the account: Siemens" → title + detail. */
function parseStep(step: string): { title: string; detail: string } {
  const at = step.indexOf(": ");
  if (at <= 0) return { title: step, detail: "" };
  return { title: step.slice(0, at), detail: step.slice(at + 2) };
}

/**
 * The glyph for a kind of work. The server writes the labels
 * (`Session.step` in api/app/agent.py), so the choice is made on how they
 * start; an unknown step gets the spark, not an empty column.
 */
const ICONS: [prefix: string, icon: string][] = [
  ["Looking up the account", "fa-building"],
  ["Setting the period", "fa-calendar-range"],
  ["Checking what is selected", "fa-crosshairs"],
  ["Checking what the data holds", "fa-circle-info"],
  ["Reading the account briefing", "fa-file-lines"],
  ["Reading deal", "fa-handshake"],
  ["Querying monthly revenue", "fa-chart-line"],
  ["Querying the pipeline", "fa-chart-pyramid"],
  ["Querying the funnel", "fa-filter"],
  ["Mapping active deals", "fa-chart-scatter"],
  ["Bridging two periods", "fa-arrow-right-arrow-left"],
  ["Redrawing", "fa-chart-mixed"],
  ["Listing opportunities", "fa-table"],
  ["Comparing two periods", "fa-scale-balanced"],
  ["Ranking accounts", "fa-ranking-star"],
  ["Scoring active deals", "fa-list-check"],
  ["Previewing the change", "fa-pen-to-square"],
  ["Saving the confirmed change", "fa-floppy-disk"],
  ["Discarding the pending change", "fa-ban"]
];

function iconFor(title: string): string {
  return ICONS.find(([prefix]) => title.startsWith(prefix))?.[1] ?? "fa-sparkles";
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
