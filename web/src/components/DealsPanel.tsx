import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { currentDeals, type CurrentDeals, type Deal } from "@/lib/api";
import { compactMoney } from "@/lib/format";
import { useChat } from "@/stores/chat";

const DAY = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short" });

/**
 * "12 Nov" — the decision date, short enough for a 240px column.
 *
 * The year appears only when the date is outside the reference year, because a
 * list sorted by close date runs off the end of it: a bare "15 Feb" under a
 * November row reads as the past when it is next spring.
 */
function closeDay(iso: string, referenceYear: number): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  const year = parsed.getFullYear();
  return year === referenceYear ? DAY.format(parsed) : `${DAY.format(parsed)} \u2019${String(year).slice(2)}`;
}

/** The two orders worth a click in a side panel: what is next, what is biggest.
 *  A switch rather than a segmented control — at this width a pill track would
 *  cost more height than the two rows it reorders. */
type DealOrder = "close_date" | "deal_value";

const ORDER: Record<DealOrder, { label: string; hint: string; next: DealOrder }> = {
  close_date: {
    label: "Soonest",
    hint: "Sorted by close date, soonest first — switch to the largest deals",
    next: "deal_value"
  },
  deal_value: {
    label: "Largest",
    hint: "Sorted by deal value, largest first — switch to the soonest close dates",
    next: "close_date"
  }
};

/**
 * CURRENT DEALS — the standing list in the left sidebar.
 *
 * Everything else on screen is composed per question; this is the book itself,
 * so it is a place and not an answer: read straight from `deal_summary` through
 * `/api/deals`, never through the model, which is why it is on screen before
 * anything has been asked and stays readable with no API key.
 *
 * "Current" is `won_lost_active_status = 'Active'` — the deals still to be won
 * or lost. Closed ones are history and belong to a question about a period.
 *
 * Two things the figures must not be allowed to imply:
 *   * the header totals cover the WHOLE Active book, aggregated in PostgreSQL,
 *     while the rows are only the first 40 — the count says which is which;
 *   * weighted value is value × probability, a planning figure and not a
 *     forecast, so it is labelled "weighted" wherever it appears.
 *
 * A row is a question, not a navigation: clicking one asks the copilot about
 * that deal, which is the only way this app opens anything. The list refetches
 * when a turn ends, so a confirmed close-date or status change shows up here
 * without a reload.
 */
export function DealsPanel({ onOpen }: { onOpen?: () => void }) {
  const [sort, setSort] = useState<DealOrder>("close_date");
  //: What is typed, and what has actually been asked for — the gap between the
  //: two is the debounce, so a five-letter name is one query and not five.
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CurrentDeals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [asked, setAsked] = useState<string | null>(null);

  const send = useChat((state) => state.send);
  const streaming = useChat((state) => state.streaming);
  // A confirmed write appends a system message, so the message count is the
  // app's own "something happened" signal — no new store state for the list.
  const turns = useChat((state) => state.messages.length);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await currentDeals(sort, 40, search));
    } catch (failure) {
      // Shown, not swallowed: an empty list and a dead API must not look alike.
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, [search, sort]);

  // Typing is not a query: the term settles for a beat before the server hears
  // about it, so holding a key down does not open a connection per letter.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 220);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    if (streaming) return;
    void load();
  }, [load, streaming, turns]);

  // The figures are the matching set, not the book, whenever a term is on —
  // "4 matching" and "100 Active" must never be read as the same sentence. Two
  // lines by design: the count and the money, then the planning figure, rather
  // than one sentence that wraps wherever the column happens to end.
  const summary = useMemo(() => {
    if (!data) return null;
    return {
      count: `${data.total} ${data.search ? "matching" : "Active"} · ${compactMoney(data.value_eur)}`,
      weighted: `${compactMoney(data.weighted_eur)} weighted`
    };
  }, [data]);

  const referenceYear = data ? Number(data.reference_date.slice(0, 4)) : new Date().getFullYear();

  function ask(deal: Deal) {
    setAsked(deal.deal);
    onOpen?.();
    void send(
      `Brief me on deal ${deal.deal} — ${deal.name}, ${deal.opportunity_type}, ` +
        `closing ${deal.close_date} at ${deal.win_probability_percent}%. ` +
        `Show the deal detail with its product lines, and say what I should do next.`
    );
  }

  return (
    <section className="app-side-panel deals-panel" aria-label="Current deals">
      <header className="deals-head">
        <span className="deals-title">Current deals</span>
        <button
          type="button"
          className="deals-order"
          onClick={() => setSort(ORDER[sort].next)}
          title={ORDER[sort].hint}
        >
          {ORDER[sort].label}
        </button>
        <button
          type="button"
          className="icon-button-sm"
          onClick={() => void load()}
          title="Reload the deal list"
          aria-label="Reload the deal list"
        >
          <Icon
            icon={
              loading
                ? "fa-sharp fa-regular fa-spinner-third fa-spin"
                : "fa-sharp fa-regular fa-arrow-rotate-right"
            }
          />
        </button>
      </header>

      {/* Typed here, matched in PostgreSQL: a customer anywhere in the name, or
          an opportunity number from its first digits. */}
      <div className="deals-search">
        <Icon icon="fa-sharp fa-regular fa-magnifying-glass" className="deals-search-icon" />
        <input
          className="field deals-search-field"
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search deals"
          aria-label="Search the Active deals by customer or deal number"
          maxLength={80}
        />
        {typed && (
          <button
            type="button"
            className="deals-search-clear"
            onClick={() => setTyped("")}
            title="Clear the search"
            aria-label="Clear the search"
          >
            <Icon icon="fa-sharp fa-regular fa-xmark" />
          </button>
        )}
      </div>

      {/* What the figures cover: the matching set, which with no term is the
          whole Active book — while the rows below are only the first 40. */}
      <p className="deals-summary">
        {error || !summary ? (
          <span className="deals-summary-line">{error ? "Not loaded" : "Loading\u2026"}</span>
        ) : (
          <>
            <span className="deals-summary-line">{summary.count}</span>
            <span className="deals-summary-line">
              {summary.weighted}
              {data && data.overdue > 0 && (
                <>
                  {" \u00b7 "}
                  <span className="deals-overdue-count">{data.overdue} overdue</span>
                </>
              )}
            </span>
          </>
        )}
      </p>

      <div className="deals-list">
        {error ? (
          <div className="deals-note">
            <Icon icon="fa-sharp fa-regular fa-triangle-exclamation" className="mr-1.5" />
            {error}
          </div>
        ) : !data ? (
          <div className="deals-note">Reading the Active book…</div>
        ) : data.deals.length === 0 ? (
          <div className="deals-note">
            {data.search
              ? `No Active deal matches \u201c${data.search}\u201d. Closed deals are not in this list — ask the copilot about them.`
              : "No Active deals — every deal in the book is Won or Lost."}
          </div>
        ) : (
          data.deals.map((deal) => (
            <button
              key={deal.deal}
              type="button"
              className={`deal-row${asked === deal.deal ? " active" : ""}`}
              onClick={() => ask(deal)}
              disabled={streaming}
              title={`${deal.name} · ${deal.opportunity_type} · ${deal.line_count} product line${
                deal.line_count === 1 ? "" : "s"
              } · ${deal.clusters.join(", ")} · deal ${deal.deal}`}
            >
              <span className="deal-row-top">
                <span className="deal-name truncate">{deal.name}</span>
                <span className="deal-value">{compactMoney(deal.deal_value_eur)}</span>
              </span>
              <span className="deal-row-meta">
                {deal.overdue ? (
                  <span className="deal-flag">
                    <Icon icon="fa-sharp fa-regular fa-triangle-exclamation" />{" "}
                    {closeDay(deal.close_date, referenceYear)}
                  </span>
                ) : (
                  <span>{closeDay(deal.close_date, referenceYear)}</span>
                )}
                <span className="deal-dot">·</span>
                <span>{deal.win_probability_percent}%</span>
                <span className="deal-dot">·</span>
                <span className="truncate">{deal.opportunity_type}</span>
              </span>
            </button>
          ))
        )}
        {data && data.total > data.deals.length && (
          <p className="deals-note">
            {data.deals.length} of {data.total} shown. Ask the copilot for the rest — by account,
            cluster or close date.
          </p>
        )}
      </div>
    </section>
  );
}
