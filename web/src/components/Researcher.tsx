import { useEffect, useMemo, useRef, useState } from "react";
import { BlockView } from "@/components/blocks/BlockView";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PillTabs, type PillTab } from "@/components/ui/PillTabs";
import { NewDealForm } from "@/components/NewDealForm";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { accounts, streamResearch, type Account, type ResearchMode } from "@/lib/api";
import type { ResearchBlock } from "@/types/blocks";

const MODES: ReadonlyArray<PillTab<ResearchMode>> = [
  { key: "account", label: "Account", icon: "fa-sharp fa-regular fa-building-magnifying-glass" },
  { key: "industry", label: "Industry", icon: "fa-sharp fa-regular fa-globe" },
  { key: "prospects", label: "Prospects", icon: "fa-sharp fa-regular fa-binoculars" }
];

const ASK: Record<ResearchMode, { hint: string; placeholder: string; examples: string[] }> = {
  account: {
    hint: "Public context on an account you already sell to — pick it, then say what you are looking for.",
    placeholder: "cybersecurity and regulatory exposure",
    examples: [
      "cybersecurity and regulatory exposure",
      "technology lifecycle and end-of-life announcements",
      "service continuity — outages, incidents, supply disruption",
      "recent company news worth opening a meeting with"
    ]
  },
  industry: {
    hint: "A sector or a rule, not a company. Nothing here is evidence about any one account.",
    placeholder: "NIS2 deadlines for mid-size European manufacturers",
    examples: [
      "NIS2 deadlines for mid-size European manufacturers",
      "security incidents in automotive suppliers this year",
      "end-of-life dates for enterprise VPN and SD-WAN platforms"
    ]
  },
  prospects: {
    hint: "Companies that resemble one we already sell to. Research suggestions with sources — never pipeline.",
    placeholder: "mid-size Czech or Slovak manufacturers that would buy managed security",
    examples: [
      "mid-size Czech or Slovak manufacturers that would buy managed security",
      "logistics companies expanding sites in central Europe",
      "companies that just announced a new plant or data centre"
    ]
  }
};

/** The wait is the feature's one real cost, so it is counted out loud. */
function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [running]);
  return seconds;
}

/**
 * The researcher — the third place in the sidebar, and the only one that looks
 * outside the database.
 *
 * It is a page of its own rather than more tools on the copilot, for two
 * reasons. A research run takes tens of seconds, which would block the chat
 * every time someone asked about pipeline; and public claims have to be kept
 * visibly apart from simulated figures, which a separate place does by
 * standing somewhere else. The copilot can still pull one report onto the
 * canvas when asked — this page is where the work is done.
 *
 * Every run streams the searches it makes as it makes them. A minute of
 * spinner with nothing behind it is indistinguishable from a broken key, and
 * this is the one feature in the app that can fail for reasons outside it.
 */
export function Researcher() {
  const [mode, setMode] = useState<ResearchMode>("account");
  const [customer, setCustomer] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Account[]>([]);
  const [reports, setReports] = useState<ResearchBlock[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const elapsed = useElapsed(running);
  const ask = ASK[mode];

  useEffect(() => {
    void accounts()
      .then(setList)
      .catch(() => setList([]));
    return () => controller.current?.abort();
  }, []);

  const ready = useMemo(() => {
    if (running) return false;
    if (mode === "account") return customer.trim().length > 0;
    if (mode === "industry") return query.trim().length > 2;
    return query.trim().length > 2 || customer.trim().length > 0;
  }, [mode, customer, query, running]);

  async function run() {
    if (!ready) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setRunning(true);
    setSteps([]);
    setError(null);
    await streamResearch(
      { mode, customer: customer.trim() || null, query: query.trim() },
      {
        onStep: (label) => setSteps((current) => [...current, label]),
        // Newest first, and each run keeps its own id so one does not replace
        // another: a researcher you cannot compare against the last answer is
        // half a researcher.
        onBlock: (block) => setReports((current) => [{ ...block, id: `research-${Date.now()}` }, ...current]),
        onError: setError,
        onDone: () => undefined
      },
      controller.current.signal
    );
    setRunning(false);
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      <SectionHeader
        title="Researcher"
        description="Public, dated context around an account — security, service continuity, technology lifecycle, regulatory. It searches the web and cites what it found; it cannot see the sales database, and nothing it returns is evidence that an account is affected."
      />

      <section className="panel p-4">
        <PillTabs tabs={MODES} value={mode} onChange={setMode} />
        <p className="mt-2.5 text-[12px] leading-5 text-[color:var(--text-3)]">{ask.hint}</p>

        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-end">
          {mode !== "industry" && (
            <label className="flex min-w-0 flex-col gap-1.5 sm:w-[240px]">
              <span className="text-[11.5px] font-semibold text-[color:var(--text-3)]">
                {mode === "prospects" ? "Account to match (optional)" : "Account"}
              </span>
              <input
                list="research-accounts"
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder={mode === "prospects" ? "Siemens" : "Pick an account"}
                className="field"
                spellCheck={false}
              />
              <datalist id="research-accounts">
                {list.map((account) => (
                  <option key={account.partner} value={account.name} />
                ))}
              </datalist>
            </label>
          )}

          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold text-[color:var(--text-3)]">
              {mode === "account" ? "What to look for (optional)" : "What to look for"}
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run();
              }}
              placeholder={ask.placeholder}
              className="field"
            />
          </label>

          <Button onClick={() => void run()} disabled={!ready} className="shrink-0">
            <Icon icon="fa-sharp fa-regular fa-magnifying-glass" className="mr-1.5 text-[11px]" />
            Research
          </Button>
        </div>

        {!running && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ask.examples.map((example) => (
              <button
                key={example}
                type="button"
                className="badge badge-gray hover:text-[color:var(--text)]"
                onClick={() => setQuery(example)}
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </section>

      <NewDealForm accounts={list} initialCustomer={customer.trim()} />

      {/* The wait, narrated. These are the queries the researcher really ran. */}
      {running && (
        <section className="panel p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <Icon icon="fa-sharp fa-regular fa-spinner fa-spin" className="text-[12px] text-[color:var(--brand-400)]" />
              <span className="text-[13px] font-semibold text-[color:var(--text)]">Searching public sources</span>
            </div>
            <span className="tabular-nums text-[11.5px] text-[color:var(--text-4)]">{elapsed}s</span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-5 text-[color:var(--text-4)]">
            Up to three searches, then it writes up what the sources support. Usually under a minute.
          </p>
          <ul className="mt-2.5 flex flex-col gap-1">
            {steps.map((step, index) => (
              <li
                key={`${step}-${index}`}
                className="flex gap-2 text-[12px] leading-5 text-[color:var(--text-2)]"
              >
                <Icon
                  icon="fa-sharp fa-regular fa-magnifying-glass"
                  className="mt-[4px] shrink-0 text-[9px] text-[color:var(--text-4)]"
                />
                <span className="min-w-0">{step}</span>
              </li>
            ))}
            {steps.length === 0 && (
              <li className="text-[12px] leading-5 text-[color:var(--text-4)]">Planning the searches…</li>
            )}
          </ul>
          <Button variant="secondary" className="mt-3" onClick={() => controller.current?.abort()}>
            Stop waiting
          </Button>
        </section>
      )}

      {error && (
        <section className="panel p-4">
          <div className="flex items-baseline gap-2">
            <Icon icon="fa-sharp fa-regular fa-triangle-exclamation" className="text-[12px]" style={{ color: "var(--red)" }} />
            <span className="text-[13px] font-semibold text-[color:var(--text)]">The researcher stopped</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-[color:var(--text-2)]">{error}</p>
          <p className="mt-1.5 text-[11.5px] leading-5 text-[color:var(--text-4)]">
            This is the one feature that depends on the public internet, so it can fail where the rest of the
            app does not. A narrower question usually finishes faster.
          </p>
        </section>
      )}

      {reports.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}

      {reports.length === 0 && !running && !error && (
        <EmptyState
          icon="fa-sharp fa-regular fa-binoculars"
          title="Nothing researched yet"
          hint="Pick an account and ask for its public context, or switch to Industry for a sector, or Prospects to look for companies that resemble a customer you already have."
        />
      )}
    </div>
  );
}
