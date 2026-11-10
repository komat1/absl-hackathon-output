import { Icon } from "@/components/ui/Icon";
import { useChat } from "@/stores/chat";
import type { CalloutBlock, FindingsBlock } from "@/types/blocks";

const TONE_COLOR: Record<string, string> = {
  good: "var(--green)",
  bad: "var(--red)",
  warn: "var(--amber)",
  info: "var(--brand-400)",
  neutral: "var(--text-3)"
};

/** Recommendations. Every item shows the figures it rests on, because a ranking
 *  a sales person cannot audit is a ranking they will not act on. */
export function FindingsView({ block }: { block: FindingsBlock }) {
  const send = useChat((state) => state.send);
  const streaming = useChat((state) => state.streaming);
  return (
    <section className="panel animate-block-in p-4">
      {block.title && <h3 className="mb-3 text-[13px] font-semibold text-[color:var(--text-2)]">{block.title}</h3>}
      <ol className="flex flex-col gap-2.5">
        {block.items.map((item, index) => {
          const color = TONE_COLOR[item.tone] ?? TONE_COLOR.info;
          return (
            <li
              key={item.title}
              className="overflow-hidden rounded-[var(--r-md)] border border-[color:var(--line)] bg-[color:var(--nest)]"
            >
              <div className="flex items-start gap-3 p-3.5 pb-3">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)] text-[11px] font-bold tabular-nums"
                  style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold leading-6 text-[color:var(--text)]">{item.title}</div>
                  <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--text-2)]">{item.summary}</p>
                  {item.evidence.length > 0 && (
                    <ul className="mt-2.5 flex flex-col gap-1.5">
                      {item.evidence.map((line) => (
                        <li key={line} className="flex gap-2 text-[11.5px] leading-[18px] text-[color:var(--text-3)]">
                          <span
                            className="mt-[7px] size-1 shrink-0 rounded-full"
                            style={{ background: color }}
                            aria-hidden
                          />
                          <span className="min-w-0">{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-[color:var(--text-4)]">
                    <Icon icon="fa-sharp fa-regular fa-database" className="text-[9px]" />
                    From the sales database
                  </div>
                </div>
              </div>
              {item.next_step && (
                <div className="flex items-center gap-3 border-t border-[color:var(--line)] px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 text-[12px] leading-5 text-[color:var(--text-2)]">
                    {item.next_step}
                  </span>
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => void send(`${item.title}: ${item.next_step}`)}
                    className="primary-button shrink-0 !h-7 !gap-1.5 !px-2.5 !text-[11.5px] disabled:cursor-wait disabled:opacity-60"
                  >
                    <Icon icon="fa-sharp fa-regular fa-sparkles" className="text-[10px]" />
                    Ask copilot
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A statement that is not a number: a limitation, a caveat, a judgement call.
 *  Its evidence list is what separates "the data says" from "I think". */
export function CalloutView({ block }: { block: CalloutBlock }) {
  const color = TONE_COLOR[block.tone] ?? TONE_COLOR.info;
  return (
    <section className="panel animate-block-in flex gap-3 p-4" style={{ borderLeft: `3px solid ${color}` }}>
      <Icon
        icon={
          block.tone === "warn"
            ? "fa-sharp fa-regular fa-triangle-exclamation"
            : block.tone === "bad"
              ? "fa-sharp fa-regular fa-circle-exclamation"
              : "fa-sharp fa-regular fa-circle-info"
        }
        className="mt-0.5 shrink-0 text-[13px]"
        style={{ color }}
      />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-[color:var(--text)]">{block.title}</div>
        <p className="mt-1 text-[12.5px] leading-5 text-[color:var(--text-2)]">{block.body}</p>
        {block.evidence.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5">
            {block.evidence.map((line) => (
              <li key={line} className="text-[11.5px] leading-5 text-[color:var(--text-4)]">
                · {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
