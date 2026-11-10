import { useState } from "react";
import { AssistantDock } from "@/components/assistant/AssistantDock";
import { MyChanges } from "@/components/MyChanges";
import { EditableBlock } from "@/components/blocks/EditableBlock";
import { Researcher } from "@/components/Researcher";
import { DashboardActions } from "@/components/DashboardActions";
import { PrintHeader } from "@/components/PrintHeader";
import { Shell } from "@/components/Shell";
import type { ViewKey } from "@/components/Sidebar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useChat } from "@/stores/chat";
import { useDashboards } from "@/stores/dashboards";
import "@/components/ui/dockPanel.css";
import "@/components/blocks/blocks.css";

/**
 * The page is whatever the conversation has built. There is no fixed dashboard
 * to filter: the copilot composes the view out of the component registry, and a
 * follow-up prompt patches one block without touching the others.
 *
 * Two pages are not that. My changes is the write record — read-only, never
 * routed through the model, and it has to be openable to be worth anything.
 * The researcher looks outside the database entirely: real public sources,
 * fetched over tens of seconds, which is why it is a place you go to rather
 * than something that blocks a chat answer.
 */
export default function App() {
  const [view, setView] = useState<ViewKey>("canvas");

  return (
    <Shell dock={<AssistantDock />} view={view} onView={setView}>
      {view === "changes" ? <MyChanges /> : view === "research" ? <Researcher /> : <Canvas />}
    </Shell>
  );
}

/**
 * The canvas of the dashboard on the selected tab. Each tab carries its own
 * blocks and its own conversation, so switching tabs swaps the whole view.
 *
 * A favourite that has not been asked anything yet shows the question it was
 * saved with and builds itself on one click — which is also what clicking its
 * tab does. A page load sends nothing by itself.
 */
function Canvas() {
  const blocks = useChat((state) => state.blocks);
  const messages = useChat((state) => state.messages);
  const streaming = useChat((state) => state.streaming);
  const send = useChat((state) => state.send);
  const tab = useDashboards((state) => state.tabs.find((candidate) => candidate.id === state.activeId));

  function view() {
    if (blocks.length > 0) {
      // Two columns on a wide screen: a block takes the whole row unless the
      // server marked it half-width, and two halves in a row pair up.
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {blocks.map((block, index) => (
            <div
              key={block.id}
              className={
                block.type === "chart" && block.size === "half" ? "min-w-0" : "min-w-0 md:col-span-2"
              }
            >
              <EditableBlock block={block} index={index} count={blocks.length} />
            </div>
          ))}
        </div>
      );
    }

    // Blocks land one by one as the tools return, so the wait has a shape.
    if (streaming) {
      return (
        <>
          <div className="flex gap-3">
            <Skeleton className="h-[88px] flex-1" />
            <Skeleton className="h-[88px] flex-1" />
            <Skeleton className="h-[88px] flex-1" />
          </div>
          <Skeleton className="h-[240px] w-full" />
        </>
      );
    }

    const seed = tab?.seed;
    if (seed && messages.length === 0) {
      return (
        <EmptyState
          icon={tab.icon}
          title={tab.title}
          hint={`\u201c${seed}\u201d`}
          action={<Button onClick={() => void send(seed)}>Build this dashboard</Button>}
        />
      );
    }

    return (
      <EmptyState
        icon="fa-sharp fa-regular fa-chart-mixed"
        title="No view yet"
        hint="Ask the copilot for an account briefing, the Active pipeline or the deals worth prioritizing. Cards, charts and tables appear here as it answers. A dashboard exported from this app can be imported above."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      {/* On paper only — what this sheet is (components/PrintHeader.tsx). */}
      <PrintHeader />
      {/* Print, export, import: they act on this dashboard, so they sit on it. */}
      <DashboardActions />
      {view()}
    </div>
  );
}
