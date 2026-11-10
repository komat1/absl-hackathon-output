import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useChat } from "@/stores/chat";
import { tabOrder, useDashboards } from "@/stores/dashboards";
import "./dashboardTabs.css";

/**
 * The tab strip over the content card. One tab = one dashboard with its own
 * conversation; favourites are pinned to the front of the row and the open ones
 * follow, separated by a hairline.
 *
 * The selected tab is a piece of the card sticking up into the frame — the same
 * move as the page tabs in the admin panel this design comes from. Star pins a
 * dashboard (it then stays in the strip across reloads and rebuilds itself on a
 * click); the cross empties it; a double-click renames it.
 *
 * The strip is what is OPEN. What was closed is in the copilot's own history
 * (components/tabs/DashboardHistory.tsx), beside its "new" button.
 */
export function DashboardTabs() {
  const tabs = useDashboards((state) => state.tabs);
  const activeId = useDashboards((state) => state.activeId);
  const select = useDashboards((state) => state.select);
  const openNew = useDashboards((state) => state.openNew);
  const close = useDashboards((state) => state.close);
  const toggleFavorite = useDashboards((state) => state.toggleFavorite);
  const rename = useDashboards((state) => state.rename);
  const streaming = useChat((state) => state.streaming);
  const list = useRef<HTMLDivElement>(null);
  /** The tab being renamed, if any — a double-click opens the name for editing. */
  const [editing, setEditing] = useState<string | null>(null);

  const order = tabOrder(tabs);
  const activeIndex = order.findIndex((tab) => tab.id === activeId);

  // A row that does not fit scrolls sideways — the selected tab has to be whole
  // on screen even when it was selected by something other than a click.
  useLayoutEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, order.length]);

  /** Arrows move focus along the row; Enter or Space opens what has focus, so
   *  walking the strip never fires a dashboard's question by itself. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : -1;
    if (!step && jump < 0) return;
    event.preventDefault();
    const items = list.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!items?.length) return;
    const from = Array.from(items).findIndex((item) => item === document.activeElement);
    const current = from === -1 ? activeIndex : from;
    const next = step ? (current + step + items.length) % items.length : jump;
    items[next]?.focus();
  }

  return (
    <div className="dt-strip theme-frame">
      <div
        ref={list}
        role="tablist"
        aria-label="Dashboards"
        className="dt-list"
        data-first-active={activeIndex === 0 || undefined}
        onKeyDown={onKeyDown}
      >
        {order.map((tab, index) => {
          const active = tab.id === activeId;
          const opensGroup = !tab.favorite && index > 0 && order[index - 1]!.favorite;
          return (
            <Fragment key={tab.id}>
              {opensGroup && <span className="dt-split" aria-hidden="true" />}
              <div
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className="dt-tab"
                data-state={active ? "active" : "inactive"}
                data-open={tab.open || undefined}
                title={tab.seed ? `${tab.title} — ${tab.seed}` : tab.title}
                onClick={() => select(tab.id, { build: true })}
                onDoubleClick={() => setEditing(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  select(tab.id, { build: true });
                }}
              >
                <span className="dt-face">
                  <Icon icon={tab.icon} className="shrink-0 text-[12px]" />
                  {editing === tab.id ? (
                    <input
                      className="dt-rename"
                      defaultValue={tab.title}
                      size={Math.max(tab.title.length, 8)}
                      // Focus and select on the frame AFTER the commit: React
                      // puts the caret back at the end of a freshly mounted
                      // input, so selecting during `autoFocus` is undone and
                      // the first keystroke runs on from the old name instead
                      // of replacing it.
                      ref={(element) => {
                        if (!element) return;
                        requestAnimationFrame(() => {
                          element.focus();
                          element.select();
                        });
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={(event) => {
                        rename(tab.id, event.currentTarget.value);
                        setEditing(null);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          rename(tab.id, event.currentTarget.value);
                          setEditing(null);
                        }
                        if (event.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="dt-label">{tab.title}</span>
                  )}
                  {active && streaming && <span className="dt-busy" aria-hidden="true" />}

                  <button
                    type="button"
                    className="dt-act"
                    data-on={tab.favorite || undefined}
                    aria-pressed={tab.favorite}
                    title={tab.favorite ? "Remove from favourites" : "Keep as a favourite"}
                    aria-label={tab.favorite ? `Remove ${tab.title} from favourites` : `Keep ${tab.title} as a favourite`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(tab.id);
                    }}
                  >
                    <Icon icon={tab.favorite ? "fa-sharp fa-solid fa-star" : "fa-sharp fa-regular fa-star"} />
                  </button>

                  {tab.open && (
                    <button
                      type="button"
                      className="dt-act"
                      title={tab.favorite ? "Empty this dashboard (it stays pinned)" : "Close this dashboard"}
                      aria-label={`Close ${tab.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        close(tab.id);
                      }}
                    >
                      <Icon icon="fa-sharp fa-regular fa-xmark" />
                    </button>
                  )}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <button
        type="button"
        className="icon-button dt-new"
        onClick={openNew}
        title="New dashboard"
        aria-label="New dashboard"
      >
        <Icon icon="fa-sharp fa-regular fa-plus" />
      </button>
    </div>
  );
}
