import { create } from "zustand";
import { streamChat, type ConfirmResult } from "@/lib/api";
import type { Block } from "@/types/blocks";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  stopped?: boolean;
  /** The trace: what the agent looked at before it wrote, one sentence per
   *  query. Kept on the message rather than in a single "current steps" slot,
   *  so scrolling back to an older answer still shows how it was arrived at. */
  steps?: string[];
  /** Wall clock of the turn, for the folded "Worked 4 s · 3 steps" line. */
  startedAt?: number;
  endedAt?: number;
  /** The question this reply answers, so "Try again" has something to re-ask. */
  prompt?: string;
}

/** Dock width bounds. Below ~360 the tables and the step rail stop making sense. */
export const MIN_DOCK = 360;
export const MAX_DOCK = 760;
const WIDTH_KEY = "copilot-dock-width";

function storedWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return 424;
  return Math.min(MAX_DOCK, Math.max(MIN_DOCK, Math.round(raw)));
}

interface ChatState {
  sessionId: string;
  messages: Message[];
  /** The generated view. Blocks are replaced by id, so a follow-up prompt that
   *  changes one component leaves every other one exactly as it was. */
  blocks: Block[];
  streaming: boolean;
  error: string | null;
  /** How wide the reader dragged the dock. Remembered across reloads. */
  width: number;
  setWidth: (width: number) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  applyResult: (result: ConfirmResult) => void;
  reset: () => void;
  /** Widget edits — on screen only. They never reach the server or the database. */
  updateBlock: (blockId: string, patch: Partial<Block>) => void;
  moveBlock: (blockId: string, by: -1 | 1) => void;
  removeBlock: (blockId: string) => void;
}

let controller: AbortController | null = null;

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Replace in place by id, append when new — the same rule the server uses. */
function merge(blocks: Block[], incoming: Block): Block[] {
  const index = blocks.findIndex((block) => block.id === incoming.id);
  if (index === -1) return [...blocks, incoming];
  const next = blocks.slice();
  next[index] = incoming;
  return next;
}

export const useChat = create<ChatState>((set, get) => ({
  sessionId: id() + id(),
  messages: [],
  blocks: [],
  streaming: false,
  error: null,
  width: storedWidth(),

  setWidth(width: number) {
    const next = Math.min(MAX_DOCK, Math.max(MIN_DOCK, Math.round(width)));
    localStorage.setItem(WIDTH_KEY, String(next));
    set({ width: next });
  },

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    const replyId = id();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: id(), role: "user", content: trimmed },
        // Something has to move the instant the question is sent — the server's
        // first trace line lands a beat later. "Thinking" is the only step this
        // store invents, and the trace draws no chip for it.
        {
          id: replyId,
          role: "assistant",
          content: "",
          prompt: trimmed,
          steps: ["Thinking"],
          startedAt: Date.now()
        }
      ],
      streaming: true,
      error: null
    }));

    controller = new AbortController();
    const patch = (change: (message: Message) => Message) =>
      set((state) => ({
        messages: state.messages.map((message) => (message.id === replyId ? change(message) : message))
      }));
    const append = (delta: string) =>
      patch((message) => ({ ...message, content: message.content + delta }));

    try {
      await streamChat(
        get().sessionId,
        trimmed,
        {
          onText: append,
          onStep: (label) =>
            patch((message) => ({ ...message, steps: [...(message.steps ?? []), label] })),
          onBlock: (block) => set((state) => ({ blocks: merge(state.blocks, block) })),
          onDone: () => set({ streaming: false }),
          onError: (message) => set({ error: message, streaming: false })
        },
        controller.signal
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        set({ error: String(error) });
      }
    } finally {
      set({ streaming: false });
      patch((message) => ({ ...message, endedAt: Date.now() }));
      controller = null;
    }
  },

  stop() {
    controller?.abort();
    set((state) => ({
      streaming: false,
      messages: state.messages.map((message, index) =>
        index === state.messages.length - 1 ? { ...message, stopped: true } : message
      )
    }));
  },

  /**
   * After a confirmed save the server returns the rebuilt blocks — only the ones
   * whose data the write touched. They are swapped in here, with no page reload
   * and no refetch of anything else on screen.
   */
  applyResult(result: ConfirmResult) {
    set((state) => {
      let blocks = state.blocks;
      for (const block of result.refreshed ?? []) blocks = merge(blocks, block);
      return {
        blocks,
        messages: [...state.messages, { id: id(), role: "system", content: result.message }]
      };
    });
  },

  updateBlock(blockId, patch) {
    set((state) => ({
      blocks: state.blocks.map((block) =>
        block.id === blockId ? ({ ...block, ...patch } as Block) : block
      )
    }));
  },

  moveBlock(blockId, by) {
    set((state) => {
      const index = state.blocks.findIndex((block) => block.id === blockId);
      const target = index + by;
      if (index === -1 || target < 0 || target >= state.blocks.length) return state;
      const blocks = state.blocks.slice();
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { blocks };
    });
  },

  removeBlock(blockId) {
    set((state) => ({ blocks: state.blocks.filter((block) => block.id !== blockId) }));
  },

  reset() {
    controller?.abort();
    set({ sessionId: id() + id(), messages: [], blocks: [], streaming: false, error: null });
  }
}));
