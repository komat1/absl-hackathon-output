import { useLayoutEffect, useRef } from "react";
import { BubbleTrace } from "./BubbleTrace";
import { Composer } from "./Composer";
import { RichText } from "./RichText";
import { SiriOrb } from "./SiriOrb";
import { DashboardHistory } from "@/components/tabs/DashboardHistory";
import { Icon } from "@/components/ui/Icon";
import { useChat } from "@/stores/chat";
import type { Message } from "@/stores/chat";

interface Suggestion {
  icon: string;
  /** What the chip says — short enough to read at a glance. */
  label: string;
  /** What is actually asked. The chip is a shortcut, not the question. */
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: "fa-sharp fa-regular fa-user-tie",
    label: "Brief me on Siemens",
    prompt:
      "Prepare me for a meeting with Siemens: revenue Jan–Oct 2026, the monthly trend and open opportunities."
  },
  {
    icon: "fa-sharp fa-regular fa-chart-pyramid",
    label: "Active pipeline",
    prompt: "Show the Active pipeline by cluster, unweighted and weighted, with distinct deal counts."
  },
  {
    icon: "fa-sharp fa-regular fa-ranking-star",
    label: "Which 3 deals first?",
    prompt: "Which three Active deals should I focus on, and why?"
  },
  {
    icon: "fa-sharp fa-regular fa-trophy",
    label: "Best accounts 2025",
    prompt: "Which five customers generated the most recorded revenue in 2025?"
  }
];

/**
 * The copilot panel, in the right column of the frame — the same surface and
 * the same panel as the AI assistant in the admin app this UI comes from: the
 * orb standing behind the greeting while nothing is happening, rising out of
 * frame once the conversation starts, the trace of what was queried above each
 * answer, the question in an inverted bubble, and one rounded composer.
 *
 * Docked rather than floating on purpose. The panel there covers the page
 * because its answers are prose about the page; this one GENERATES the page, so
 * the figures and the conversation have to be legible at the same time — the
 * content card narrows instead (`.ai-dock` holds the last grid column).
 */
export function AssistantDock() {
  const messages = useChat((state) => state.messages);
  const streaming = useChat((state) => state.streaming);
  const error = useChat((state) => state.error);
  const send = useChat((state) => state.send);
  const reset = useChat((state) => state.reset);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the stream only while the reader is at the bottom — scrolling up to
  // re-read a figure must not be yanked back down by the next token.
  const stickToBottom = useRef(true);
  const empty = messages.length === 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, streaming]);

  return (
    <div className="ai-bubble" data-placement="dock" role="complementary" aria-label="Sales copilot">
      {/* The orb is the backdrop, not an element in the flow: big behind the
          greeting at rest, pushed up and dimmed once there is something to
          read. It only ripples while a query is running. */}
      <div className={`ai-bubble-orb${empty ? "" : " is-docked"}`}>
        <SiriOrb active={streaming} className="h-full w-full" />
      </div>

      <div className="ai-bubble-top">
        <span className="text-[13px] font-semibold text-foreground">Copilot</span>
        <span className="text-[11.5px] text-[color:var(--text-3)]">simulated data</span>
        <span className="flex-1" />
        {/* What was closed sits next to what starts something new: the strip
            above the canvas is the dashboards that are open, this is the ones
            that were (components/tabs/DashboardHistory.tsx). */}
        <DashboardHistory />
        {!empty && (
          <button
            type="button"
            className="ai-bubble-ghost"
            onClick={() => {
              stickToBottom.current = true;
              reset();
            }}
            title="New conversation"
            aria-label="New conversation"
          >
            <Icon icon="fa-sharp fa-regular fa-pen-to-square" />
          </button>
        )}
      </div>

      <div className="ai-bubble-scroll-wrap">
        <div
          ref={scrollRef}
          className="ai-bubble-scroll"
          onScroll={(event) => {
            const el = event.currentTarget;
            el.toggleAttribute("data-scrolled", el.scrollTop > 4);
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {empty ? (
            <div className="ai-bubble-empty">
              <p className="text-[20px] font-bold tracking-[-0.015em] text-foreground">
                What are you preparing for?
              </p>
              <p className="mt-1 text-[13px] text-[color:var(--text-2)]">
                Ask about an account, the pipeline or a deal. Every figure comes from a query — I never estimate
                one, and any deal change is yours to confirm.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    className="ai-bubble-chip"
                    onClick={() => void send(suggestion.prompt)}
                    title={suggestion.prompt}
                  >
                    <Icon icon={suggestion.icon} />
                    <span>{suggestion.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] leading-5 text-[color:var(--text-3)]">
                Company names are real; every figure is simulated hackathon data.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-1">
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <div key={message.id} className="ai-bubble-user">
                    {message.content}
                  </div>
                ) : message.role === "system" ? (
                  <Record key={message.id} message={message} />
                ) : (
                  <Reply
                    key={message.id}
                    message={message}
                    live={streaming && index === messages.length - 1}
                    onSuggest={(prompt) => void send(prompt)}
                  />
                )
              )}

              {error && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] text-[color:var(--red)]">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="ai-bubble-fade" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>

      <Composer />
    </div>
  );
}

/**
 * What a confirm or cancel click did, recorded in the thread. It is not an
 * answer — the decision happened outside the model, at /api/confirm — so it is
 * not dressed as one.
 */
function Record({ message }: { message: Message }) {
  return (
    <div className="ai-bubble-note" style={{ margin: 0 }}>
      <Icon icon="fa-sharp fa-regular fa-circle-check" />
      <span className="min-w-0 flex-1">{message.content}</span>
    </div>
  );
}

/** One copilot turn: what it queried, then the answer. */
/** Split the reply into prose and the ">> " follow-up lines the agent ends with. */
function splitSuggestions(content: string): { body: string; next: string[] } {
  const next: string[] = [];
  const body = content
    .split("\n")
    .filter((line) => {
      const m = line.trim().match(/^(?:[-*]\s*)?>>\s*(.+)$/);
      if (m) next.push(m[1].trim());
      return !m && !/^>>?\s*$/.test(line.trim());
    })
    .join("\n")
    .trimEnd();
  return { body, next: next.slice(0, 3) };
}

function Reply({
  message,
  live,
  onSuggest,
}: {
  message: Message;
  live: boolean;
  onSuggest: (prompt: string) => void;
}) {
  const { body, next } = splitSuggestions(message.content);
  const written = body.trim().length > 0;
  return (
    <div className="ai-bubble-reply">
      {(message.steps?.length ?? 0) > 0 && (
        <BubbleTrace
          steps={message.steps ?? []}
          startedAt={message.startedAt}
          endedAt={message.endedAt}
          live={live && !written}
        />
      )}

      {written && (
        <div className="ai-bubble-text">
          <RichText text={body} />
          {live && <span className="analyst-caret" />}
        </div>
      )}

      {message.stopped && <span className="text-[12.5px] text-[color:var(--text-3)]">You stopped the answer.</span>}

      {!live && next.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {next.map((prompt) => (
            <button key={prompt} type="button" className="ai-bubble-chip" onClick={() => onSuggest(prompt)}>
              <Icon icon="fa-sharp fa-regular fa-sparkles" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
