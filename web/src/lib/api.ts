import type { Block, EditableField, ResearchBlock } from "@/types/blocks";

export interface Health {
  ok: boolean;
  database?: { lines: number; deals: number; revenue_rows: number };
  reference_date?: string;
  model?: string;
  agent_ready?: boolean;
  error?: string;
  hint?: string;
}

export async function health(): Promise<Health> {
  try {
    const response = await fetch("/api/health");
    return (await response.json()) as Health;
  } catch (error) {
    return { ok: false, error: String(error), hint: "Is the API running? `make api`" };
  }
}

export interface ChatHandlers {
  onText: (delta: string) => void;
  onBlock: (block: Block) => void;
  /** One line of the trace: a query the agent ran, as the server worded it. */
  onStep: (label: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Server-sent events over POST, so the stream carries text deltas and UI blocks
 * on the same connection: a block appears the moment its tool returns, while
 * the answer is still being written.
 */
export async function streamChat(
  sessionId: string,
  message: string,
  handlers: ChatHandlers,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
    signal
  });

  if (!response.ok || !response.body) {
    handlers.onError(
      response.status === 503
        ? "The agent has no API key. Set ANTHROPIC_API_KEY in .env and restart the API."
        : `The API answered ${response.status}.`
    );
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // SSE frames are separated by a blank line; a frame can arrive in pieces.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === "text") handlers.onText(data.delta as string);
      else if (event === "step") handlers.onStep(data.label as string);
      else if (event === "block") handlers.onBlock(data as Block);
      else if (event === "error") handlers.onError(data.message as string);
      else if (event === "done") handlers.onDone();
    }
  }
}

export interface ConfirmResult {
  saved: boolean;
  message: string;
  refreshed?: Block[];
}

export async function decide(
  sessionId: string,
  pendingId: string,
  decision: "confirm" | "cancel"
): Promise<ConfirmResult> {
  const response = await fetch("/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, pending_id: pendingId, decision })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }));
    return { saved: false, message: detail.detail ?? "That change could not be applied." };
  }
  return (await response.json()) as ConfirmResult;
}

/** One confirmed write, as `deal_update_audit` stored it. */
export interface AuditEntry {
  id: number;
  changed_at: string;
  deal_id: string;
  /** Text in the database; one of `EditableField` in practice. */
  field: string;
  old_value: string | null;
  new_value: string;
  rows_affected: number;
}

/**
 * One confirmed decision: every row a single transaction wrote, grouped.
 *
 * A decision can move status, win probability and close date together — "move
 * this deal forward" usually moves at least two — and each field is its own row
 * in `deal_update_audit`. They share the transaction's `changed_at`, which is
 * what the server groups on to put them back together.
 */
export interface AuditDecision {
  id: number;
  changed_at: string;
  deal_id: string;
  /** From the deal rollup; null if the deal is not in it. */
  customer_name?: string | null;
  rows_affected: number;
  fields_changed: number;
  changes: { field: string; old_value: string | null; new_value: string }[];
}

/**
 * The write log. Read-only, no session and no model involved — the audit page
 * asks PostgreSQL directly, so it stays readable when the agent has no key.
 *
 * The endpoint answers the same writes two ways: `entries` as they were stored,
 * one row per field, and `decisions` grouped back into the transactions a
 * person actually confirmed.
 */
async function fetchAudit(limit: number): Promise<{ entries: AuditEntry[]; decisions: AuditDecision[] }> {
  let response: Response;
  try {
    // A dead API accepts the connection and never answers, which would leave
    // the page spinning forever. The brief asks for slow and failed queries to
    // be shown, not hidden behind a skeleton, so the wait is bounded here.
    response = await fetch(`/api/audit?limit=${limit}`, { signal: AbortSignal.timeout(8000) });
  } catch (failure) {
    throw new Error(
      (failure as Error).name === "TimeoutError"
        ? "The audit trail did not answer within 8 seconds."
        : "The API is unreachable. Is it running? `make api`"
    );
  }
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? "The database is unreachable. Is it up? `make up`"
        : `The API answered ${response.status}.`
    );
  }
  return (await response.json()) as { entries: AuditEntry[]; decisions: AuditDecision[] };
}

/** The raw rows, exactly as `deal_update_audit` stored them. */
export async function auditTrail(limit = 50): Promise<AuditEntry[]> {
  return (await fetchAudit(limit)).entries;
}

/** The same writes, grouped into the decisions that produced them. */
export async function auditDecisions(limit = 50): Promise<AuditDecision[]> {
  return (await fetchAudit(limit)).decisions;
}

/** Narrowing helper so the log can label a field with the UI's own wording. */
export type AuditField = EditableField;

/** One of the 30 accounts, for the researcher's picker. */
export interface Account {
  partner: string;
  name: string;
  deals: number;
  revenue_total: number;
}

export async function accounts(): Promise<Account[]> {
  const response = await fetch("/api/accounts", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`The API answered ${response.status}.`);
  return ((await response.json()) as { accounts: Account[] }).accounts;
}

/** One Active deal, as `deal_summary` holds it — the sidebar's row. */
export interface Deal {
  deal: string;
  partner: string;
  name: string;
  status: string;
  opportunity_type: string;
  deal_value_eur: number;
  win_probability_percent: number;
  weighted_value_eur: number;
  close_date: string;
  line_count: number;
  clusters: string[];
  overdue: boolean;
}

export type DealSort = "close_date" | "deal_value" | "weighted" | "probability";

export interface CurrentDeals {
  deals: Deal[];
  /** Deals matching, not rows returned — the list is capped at `limit`. */
  total: number;
  value_eur: number;
  weighted_eur: number;
  overdue: number;
  reference_date: string;
  /** The term the figures above were measured over, as the server read it. */
  search: string;
}

/**
 * The Active book for the sidebar. Read-only and model-free, like the audit
 * trail: it asks PostgreSQL through `/api/deals`, so the list is there before
 * anything has been asked and stays there when the agent has no key.
 *
 * `search` is passed to the server rather than applied here: the panel holds
 * forty rows and the book holds thousands, so filtering in the browser would
 * search only what happened to be on screen.
 */
export async function currentDeals(
  sort: DealSort = "close_date",
  limit = 40,
  search = ""
): Promise<CurrentDeals> {
  let response: Response;
  try {
    response = await fetch(
      `/api/deals?sort=${sort}&limit=${limit}&q=${encodeURIComponent(search.trim())}`,
      { signal: AbortSignal.timeout(8000) }
    );
  } catch (failure) {
    throw new Error(
      (failure as Error).name === "TimeoutError"
        ? "The deal list did not answer within 8 seconds."
        : "The API is unreachable. Is it running? `make api`"
    );
  }
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? "The database is unreachable. Is it up? `make up`"
        : `The API answered ${response.status}.`
    );
  }
  return (await response.json()) as CurrentDeals;
}

export type ResearchMode = "account" | "industry" | "prospects";

export interface ResearchHandlers {
  /** One search, as the researcher actually ran it. */
  onStep: (label: string) => void;
  onBlock: (block: ResearchBlock) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

/**
 * The researcher. A different agent from the copilot, and the only call in this
 * app that waits on the public internet — it really does run searches, so it
 * streams: the page shows each query as it happens instead of a spinner that
 * cannot say what it is waiting for. Same four events as the chat stream.
 */
export async function streamResearch(
  input: { mode: ResearchMode; customer?: string | null; query: string },
  handlers: ResearchHandlers,
  signal?: AbortSignal
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal
    });
  } catch (failure) {
    if ((failure as Error).name === "AbortError") return;
    handlers.onError("The API is unreachable. Is it running? `make api`");
    return;
  }

  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    handlers.onError(
      detail?.detail ??
        (response.status === 503
          ? "The researcher has no API key. Set ANTHROPIC_API_KEY in .env and restart the API."
          : `The API answered ${response.status}.`)
    );
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === "step") handlers.onStep(data.label as string);
      else if (event === "block") handlers.onBlock(data as ResearchBlock);
      else if (event === "error") handlers.onError(data.message as string);
      else if (event === "done") handlers.onDone();
    }
  }
}

/** Product → cluster, for the new-deal form. */
export interface Product {
  product: string;
  cluster: string;
}

export async function products(): Promise<Product[]> {
  const response = await fetch("/api/products", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`The API answered ${response.status}.`);
  return ((await response.json()) as { products: Product[] }).products;
}

export interface NewDealDraft {
  customer: string;
  product: string;
  price_eur: number;
  win_probability_percent: number;
  close_date: string;
  opportunity_type: "New Business" | "Upsell" | "Renewal";
}

export interface NewDealPreview extends NewDealDraft {
  pending_id: string;
  cluster: string;
  partner: string | null;
  existing_account: boolean;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).join("; ")
          : `The API answered ${response.status}.`
    );
  }
  return data as T;
}

/** Validate a draft and park it under a pending id. Writes nothing. */
export function previewNewDeal(draft: NewDealDraft): Promise<NewDealPreview> {
  return postJson("/api/deals/new/preview", draft);
}

/** Confirm writes the deal; cancel drops the draft without touching the database. */
export function decideNewDeal(
  pending_id: string,
  decision: "confirm" | "cancel"
): Promise<{ saved: boolean; message: string; result?: { deal: string } }> {
  return postJson("/api/deals/new/decide", { pending_id, decision });
}
