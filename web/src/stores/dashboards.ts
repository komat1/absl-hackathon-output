import { create } from "zustand";
import { exportDashboard, type DashboardFile } from "@/lib/dashboardFile";
import { useChat, type Message } from "@/stores/chat";
import type { Block } from "@/types/blocks";

/**
 * TABS = DASHBOARDS (one conversation each)
 *
 * A tab is a whole dashboard: its own blocks, its own chat, its own server
 * session. The strip holds what is OPEN, in two groups, in this order:
 *
 *   1. favourites — pinned, kept across reloads, always in the strip even when
 *      closed (clicking one builds it from its saved question)
 *   2. everything else that is open, in the order it was opened
 *
 * Closing a dashboard that was asked something does not throw it away: it goes
 * to the history at the end of the strip and can be reopened from there. Within
 * one browser session a reopened dashboard comes back exactly as it was, server
 * session included; after a reload only the question survives, so it rebuilds.
 *
 * Only ONE chat is live at a time: the copilot store (`stores/chat.ts`) holds
 * the dashboard on screen, and the others are parked here as snapshots. The
 * copilot store is left untouched by this file on purpose — it is swapped
 * through `useChat.setState`, so nothing in the dock, the composer or the
 * blocks has to know that tabs exist.
 */
export interface Dashboard {
  id: string;
  title: string;
  /** FontAwesome name, the string style the Icon component takes. */
  icon: string;
  /** The question that builds this dashboard, sent the first time it is opened. */
  seed?: string;
  favorite: boolean;
  /** True once it has been opened in this session, so it carries a conversation. */
  open: boolean;
  /** A tab opened with + is nameless until its first question names it. */
  autoTitle?: boolean;
}

/** A dashboard that was closed. The strip is now; this is what was. */
export interface HistoryEntry {
  entryId: string;
  /** The dashboard it came from, so reopening lands back on the same tab. */
  tabId: string;
  title: string;
  icon: string;
  /** What rebuilds it: its saved question, or the first one it was asked. */
  question?: string;
  closedAt: number;
  /** True while this browser session can still put the conversation back. */
  restorable: boolean;
}

/** A parked conversation — everything per-dashboard the copilot store holds. */
interface Parked {
  sessionId: string;
  messages: Message[];
  blocks: Block[];
  error: string | null;
}

const STORE_KEY = "copilot-dashboards";
const HISTORY_KEY = "copilot-dashboard-history";
/** Enough to find yesterday's view, not so much that the menu becomes an archive. */
const HISTORY_MAX = 25;

/** What a fresh browser starts with: the four views a sales person opens daily. */
const DEFAULTS: readonly Dashboard[] = [
  {
    id: "pipeline",
    title: "Pipeline",
    icon: "fa-sharp fa-regular fa-chart-pyramid",
    seed: "Show the Active pipeline by cluster, unweighted and weighted, with distinct deal counts.",
    favorite: true,
    open: false
  },
  {
    id: "priorities",
    title: "Priorities",
    icon: "fa-sharp fa-regular fa-ranking-star",
    seed: "Which three Active deals should I focus on, and why?",
    favorite: true,
    open: false
  },
  {
    id: "siemens",
    title: "Siemens",
    icon: "fa-sharp fa-regular fa-building",
    seed:
      "Prepare me for a meeting with Siemens: revenue Jan–Oct 2026, the monthly trend and open opportunities.",
    favorite: true,
    open: false
  },
  {
    id: "customers",
    title: "Top customers",
    icon: "fa-sharp fa-regular fa-trophy",
    seed: "Which five customers generated the most recorded revenue in 2025?",
    favorite: true,
    open: false
  }
];

function sid(): string {
  const part = () => Math.random().toString(36).slice(2, 10);
  return part() + part();
}

function blank(): Dashboard {
  return {
    id: sid(),
    title: "New dashboard",
    icon: "fa-sharp fa-regular fa-chart-mixed",
    favorite: false,
    open: true,
    autoTitle: true
  };
}

/** Favourites first, then the open ones — the strip order, everywhere. */
function strip(tabs: Dashboard[]): Dashboard[] {
  return [...tabs.filter((tab) => tab.favorite), ...tabs.filter((tab) => !tab.favorite)];
}

/** Only favourites are remembered: an unpinned tab is this session's work. */
function save(tabs: Dashboard[]): void {
  const pinned = tabs
    .filter((tab) => tab.favorite)
    .map(({ id, title, icon, seed }) => ({ id, title, icon, seed, favorite: true, open: false }));
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(pinned));
  } catch {
    // A full or blocked storage is not worth losing the strip over.
  }
}

/** History survives a reload as a list of questions, never as saved answers:
 *  the figures on a dashboard belong to the conversation that queried them. */
function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.map((entry) => ({ ...entry, restorable: false })))
    );
  } catch {
    // Not worth losing the strip over.
  }
}

function storedHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as HistoryEntry[])
      .filter((entry) => entry && typeof entry.entryId === "string" && typeof entry.title === "string")
      .map((entry) => ({
        entryId: entry.entryId,
        tabId: typeof entry.tabId === "string" ? entry.tabId : entry.entryId,
        title: entry.title,
        icon: typeof entry.icon === "string" ? entry.icon : "fa-sharp fa-regular fa-chart-mixed",
        question: typeof entry.question === "string" ? entry.question : undefined,
        closedAt: typeof entry.closedAt === "number" ? entry.closedAt : 0,
        // Nothing from a previous session can be put back: that server session
        // is gone, so the dashboard is rebuilt from its question instead.
        restorable: false
      }))
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function stored(): Dashboard[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS.map((tab) => ({ ...tab }));
    const saved = (JSON.parse(raw) as Dashboard[])
      .filter((tab) => tab && typeof tab.id === "string" && typeof tab.title === "string")
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        icon: typeof tab.icon === "string" ? tab.icon : "fa-sharp fa-regular fa-chart-mixed",
        seed: typeof tab.seed === "string" ? tab.seed : undefined,
        favorite: true,
        open: false
      }));
    // Every favourite unpinned? Then the strip is empty on purpose, and the
    // blank tab below carries the session.
    return saved;
  } catch {
    return DEFAULTS.map((tab) => ({ ...tab }));
  }
}

/**
 * Conversations of closed dashboards, kept for as long as the page lives. The
 * server still holds their sessions, so a reopened dashboard is the same
 * conversation — not a replay of it. Deliberately outside the store and
 * outside localStorage: it is memory, not state to render or to persist.
 */
const graveyard = new Map<string, Parked>();

/** The conversation on screen, lifted out of the copilot store as it is. */
function park(): Parked {
  const { sessionId, messages, blocks, error } = useChat.getState();
  return { sessionId, messages, blocks, error };
}

/**
 * Put a parked conversation on screen — or a brand new one.
 *
 * An answer still streaming writes into the one live store, so it would land in
 * the dashboard being switched TO. It is stopped first; whatever it had already
 * built stays on the tab it was building.
 */
function restore(parked: Parked | undefined): void {
  const chat = useChat.getState();
  if (chat.streaming) chat.stop();
  useChat.setState(
    parked ?? { sessionId: sid(), messages: [], blocks: [], error: null, streaming: false }
  );
}

/** Send the dashboard's own question, but never over an existing conversation. */
function build(tab: Dashboard): void {
  if (!tab.seed) return;
  const chat = useChat.getState();
  if (chat.messages.length > 0 || chat.streaming) return;
  void chat.send(tab.seed);
}

interface DashboardState {
  tabs: Dashboard[];
  activeId: string;
  /** Conversations of the tabs that are not on screen, keyed by tab id. */
  parked: Record<string, Parked>;
  /** Dashboards that have been closed, newest first. */
  history: HistoryEntry[];
  /** Open a tab. `build` runs its saved question when the dashboard is empty —
   *  true on a click, false when only focus moved there. */
  select: (id: string, options?: { build?: boolean }) => void;
  openNew: () => void;
  close: (id: string) => void;
  /** Put a closed dashboard back in the strip and on screen. */
  reopen: (entryId: string) => void;
  forget: (entryId: string) => void;
  clearHistory: () => void;
  toggleFavorite: (id: string) => void;
  rename: (id: string, title: string) => void;
  /** Write the dashboard on screen to a JSON file. Returns the file name, or
   *  null when there is nothing on it yet. */
  exportActive: () => string | null;
  /** Open a dashboard read from a file in a tab of its own. */
  importFile: (file: DashboardFile) => void;
}

const initial = strip(stored());
const first = initial[0] ?? blank();
// Nothing is sent on a page load: the first dashboard opens empty with its
// question offered as one click, so a reload never spends a model call.
const booted = initial.some((tab) => tab.id === first.id)
  ? initial.map((tab) => (tab.id === first.id ? { ...tab, open: true } : tab))
  : [first];

export const useDashboards = create<DashboardState>((set, get) => ({
  tabs: booted,
  activeId: first.id,
  parked: {},
  history: storedHistory(),

  select(id, options) {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;

    if (id === state.activeId) {
      if (options?.build) build(tab);
      return;
    }

    const parked = { ...state.parked, [state.activeId]: park() };
    const incoming = parked[id];
    delete parked[id];
    restore(incoming);

    const tabs = state.tabs.map((candidate) =>
      candidate.id === id ? { ...candidate, open: true } : candidate
    );
    set({ activeId: id, parked, tabs });
    if (options?.build) build({ ...tab, open: true });
  },

  openNew() {
    const state = get();
    const tab = blank();
    const parked = { ...state.parked, [state.activeId]: park() };
    restore(undefined);
    set({ tabs: [...state.tabs, tab], activeId: tab.id, parked });
  },

  close(id) {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;

    // A favourite is pinned: closing it empties the dashboard but keeps the tab,
    // so the next click builds it again. Anything else leaves the strip.
    const tabs = tab.favorite
      ? state.tabs.map((candidate) => (candidate.id === id ? { ...candidate, open: false } : candidate))
      : state.tabs.filter((candidate) => candidate.id !== id);
    const parked = { ...state.parked };
    const closing = id === state.activeId ? park() : state.parked[id];
    delete parked[id];
    save(tabs);

    // A dashboard that was never asked anything has nothing to remember. One
    // that was goes to the history, replacing its own older entry so repeatedly
    // closing the same favourite does not fill the menu with it.
    let history = state.history;
    if (closing && closing.messages.length > 0) {
      const entry: HistoryEntry = {
        entryId: sid(),
        tabId: id,
        title: tab.title,
        icon: tab.icon,
        question: tab.seed ?? closing.messages.find((message) => message.role === "user")?.content,
        closedAt: Date.now(),
        restorable: true
      };
      graveyard.set(entry.entryId, closing);
      history = [entry, ...state.history.filter((old) => old.tabId !== id)].slice(0, HISTORY_MAX);
      saveHistory(history);
    }

    if (id !== state.activeId) {
      set({ tabs, parked, history });
      return;
    }

    // Closing the dashboard on screen: step to the next tab in the strip, or
    // back to the previous one when it was the last.
    const order = strip(state.tabs);
    const index = order.findIndex((candidate) => candidate.id === id);
    const next = [...order.slice(index + 1), ...order.slice(0, index).reverse()].find(
      (candidate) => candidate.id !== id
    );

    if (!next) {
      const fresh = blank();
      restore(undefined);
      set({ tabs: [...tabs, fresh], activeId: fresh.id, parked, history });
      return;
    }

    const incoming = parked[next.id];
    delete parked[next.id];
    restore(incoming);
    set({
      tabs: tabs.map((candidate) => (candidate.id === next.id ? { ...candidate, open: true } : candidate)),
      activeId: next.id,
      parked,
      history
    });
  },

  /**
   * Reopen a closed dashboard. Its conversation comes back whole when this page
   * still holds it — same blocks, same server session, so a follow-up question
   * continues where it left off. Otherwise the tab opens on its question and
   * builds itself again, which is the honest thing: the figures on a dashboard
   * belong to the conversation that queried them, and that one is gone.
   */
  reopen(entryId) {
    const state = get();
    const entry = state.history.find((candidate) => candidate.entryId === entryId);
    if (!entry) return;

    const chat = graveyard.get(entryId);
    graveyard.delete(entryId);
    const history = state.history.filter((candidate) => candidate.entryId !== entryId);
    saveHistory(history);

    const parked = { ...state.parked, [state.activeId]: park() };
    delete parked[entry.tabId];
    restore(chat);

    // A favourite is still in the strip, pinned and empty; anything else has to
    // be put back, after the favourites, with its question for rebuilding.
    const known = state.tabs.find((candidate) => candidate.id === entry.tabId);
    const tab: Dashboard = known
      ? { ...known, open: true }
      : {
          id: entry.tabId,
          title: entry.title,
          icon: entry.icon,
          seed: entry.question,
          favorite: false,
          open: true
        };
    const tabs = known
      ? state.tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate))
      : [...state.tabs, tab];

    set({ tabs, activeId: tab.id, parked, history });
    if (!chat) build(tab);
  },

  forget(entryId) {
    graveyard.delete(entryId);
    const history = get().history.filter((entry) => entry.entryId !== entryId);
    saveHistory(history);
    set({ history });
  },

  clearHistory() {
    graveyard.clear();
    saveHistory([]);
    set({ history: [] });
  },

  toggleFavorite(id) {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;

    // Unpinning a closed favourite takes it out of the strip: nothing is open
    // under it, so there would be nothing left to click.
    const tabs =
      tab.favorite && !tab.open && tab.id !== state.activeId
        ? state.tabs.filter((candidate) => candidate.id !== id)
        : state.tabs.map((candidate) =>
            candidate.id === id ? { ...candidate, favorite: !candidate.favorite, open: true } : candidate
          );
    save(tabs);
    set({ tabs });
  },

  rename(id, title) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const tabs = get().tabs.map((tab) =>
      tab.id === id ? { ...tab, title: trimmed.slice(0, 40), autoTitle: false } : tab
    );
    save(tabs);
    set({ tabs });
  },

  /**
   * Export the dashboard on screen. What goes in the file is its blocks and the
   * question that built it — never the conversation, and never a pending write
   * (lib/dashboardFile.ts says why).
   */
  exportActive() {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.id === state.activeId);
    if (!tab) return null;
    const chat = useChat.getState();
    return exportDashboard({
      title: tab.title,
      icon: tab.icon,
      question: tab.seed ?? chat.messages.find((message) => message.role === "user")?.content,
      blocks: chat.blocks
    });
  },

  /**
   * Put an imported dashboard on screen, in a new tab, with the dashboard it
   * replaced parked as usual.
   *
   * The tab opens on a fresh server session and one system note, because the
   * blocks are a snapshot: the file holds the figures as they were, and the
   * conversation that produced them lives nowhere but in the session it was
   * had. A question asked here queries the live database and may well answer
   * differently — which the note says, so the screen never implies otherwise.
   * The question the file carries becomes the tab's seed, so the same dashboard
   * can be rebuilt from live data on one click.
   */
  importFile(file) {
    const state = get();
    const tab: Dashboard = {
      id: sid(),
      title: file.title,
      icon: file.icon,
      seed: file.question,
      favorite: false,
      open: true
    };
    const parked = { ...state.parked, [state.activeId]: park() };
    restore({
      sessionId: sid(),
      messages: [
        {
          id: sid().slice(0, 8),
          role: "system",
          content: `Imported \u201c${file.title}\u201d from a file${
            file.exported_at ? ` exported ${new Date(file.exported_at).toLocaleString("en-IE")}` : ""
          }. The blocks below are that snapshot; this conversation starts fresh, so a question here queries the database as it is now.`
        }
      ],
      blocks: file.blocks,
      error: null
    });
    set({ tabs: [...state.tabs, tab], activeId: tab.id, parked });
  }
}));

/** The strip order, for the component and for keyboard navigation. */
export function tabOrder(tabs: Dashboard[]): Dashboard[] {
  return strip(tabs);
}

/** "Which three Active deals…" — a tab is named after the question it answers. */
function nameFrom(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length <= 26) return clean;
  const cut = clean.slice(0, 26);
  const space = cut.lastIndexOf(" ");
  return `${(space > 12 ? cut.slice(0, space) : cut).replace(/[,.;:]$/, "")}…`;
}

// A tab opened with + has no name until it is asked something. The question is
// typed into the copilot, not into this store, so the name is picked up here.
useChat.subscribe((chat) => {
  const { tabs, activeId } = useDashboards.getState();
  const tab = tabs.find((candidate) => candidate.id === activeId);
  if (!tab?.autoTitle) return;
  const asked = chat.messages.find((message) => message.role === "user");
  if (!asked) return;
  useDashboards.setState({
    tabs: tabs.map((candidate) =>
      candidate.id === activeId ? { ...candidate, title: nameFrom(asked.content), autoTitle: false } : candidate
    )
  });
});
