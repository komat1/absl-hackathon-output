import { useState } from "react";
import { BlockView } from "./BlockView";
import { Icon } from "@/components/ui/Icon";
import { useChat } from "@/stores/chat";
import type { Block, ChartKind } from "@/types/blocks";

/**
 * A generated block with a small edit toolbar: rename, resize, switch the chart
 * form, reorder, remove. Edits change only what is on screen — the figures stay
 * exactly what the tool returned, and nothing is sent to the server.
 *
 * Preview blocks (pending deal writes) are left alone: their confirm/cancel
 * buttons are the one path to a write, and editing around them invites mistakes.
 */

/** Forms that read the same data shape (x_key + series), so a switch is safe. */
const SWAPPABLE: ChartKind[] = ["bar", "line", "area", "stacked-bar"];

export function EditableBlock({ block, index, count }: { block: Block; index: number; count: number }) {
  const updateBlock = useChat((state) => state.updateBlock);
  const moveBlock = useChat((state) => state.moveBlock);
  const removeBlock = useChat((state) => state.removeBlock);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  if (block.type === "preview") return <BlockView block={block} />;

  const currentTitle = "title" in block ? (block.title ?? "") : "";

  function startRename() {
    setTitle(currentTitle);
    setEditing(true);
  }

  function commitRename() {
    const trimmed = title.trim();
    // Callout and research require a title; an empty one would not render.
    if (trimmed || (block.type !== "callout" && block.type !== "research")) {
      updateBlock(block.id, { title: trimmed || null } as Partial<Block>);
    }
    setEditing(false);
  }

  const button =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-3)] hover:bg-[var(--raise-2)] hover:text-[var(--text)] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="group relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--raise)] p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100 print:hidden">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setEditing(false);
            }}
            placeholder="Widget title"
            className="h-7 w-48 rounded-md bg-[var(--nest)] px-2 text-sm text-[var(--text)] outline-none"
          />
        ) : (
          <button type="button" className={button} title="Rename" onClick={startRename}>
            <Icon icon="fa-sharp fa-regular fa-pen" />
          </button>
        )}

        {block.type === "chart" && SWAPPABLE.includes(block.chart) && (
          <select
            value={block.chart}
            title="Chart type"
            onChange={(event) => updateBlock(block.id, { chart: event.target.value as ChartKind })}
            className="h-7 rounded-md bg-transparent px-1 text-xs text-[var(--text-3)] outline-none hover:bg-[var(--raise-2)]"
          >
            {SWAPPABLE.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        )}

        {block.type === "chart" && (
          <button
            type="button"
            className={button}
            title={block.size === "half" ? "Full width" : "Half width"}
            onClick={() => updateBlock(block.id, { size: block.size === "half" ? "full" : "half" })}
          >
            <Icon
              icon={
                block.size === "half"
                  ? "fa-sharp fa-regular fa-arrows-left-right"
                  : "fa-sharp fa-regular fa-arrows-to-line"
              }
            />
          </button>
        )}

        <button type="button" className={button} title="Move up" disabled={index === 0} onClick={() => moveBlock(block.id, -1)}>
          <Icon icon="fa-sharp fa-regular fa-arrow-up" />
        </button>
        <button
          type="button"
          className={button}
          title="Move down"
          disabled={index === count - 1}
          onClick={() => moveBlock(block.id, 1)}
        >
          <Icon icon="fa-sharp fa-regular fa-arrow-down" />
        </button>
        <button type="button" className={button} title="Remove widget" onClick={() => removeBlock(block.id)}>
          <Icon icon="fa-sharp fa-regular fa-trash" />
        </button>
      </div>
      <BlockView block={block} />
    </div>
  );
}
