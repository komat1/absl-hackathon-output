import { CalloutView, FindingsView } from "./FindingsView";
import { ChartView } from "./ChartView";
import { PreviewView } from "./PreviewView";
import { ResearchView } from "./ResearchView";
import { StatsView } from "./StatsView";
import { TableView } from "./TableView";
import type { Block } from "@/types/blocks";

/**
 * The whole registry of renderable components. The agent can compose a view out
 * of these and nothing else — it never sends code, only a validated block.
 */
export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "stats":
      return <StatsView block={block} />;
    case "chart":
      return <ChartView block={block} />;
    case "table":
      return <TableView block={block} />;
    case "findings":
      return <FindingsView block={block} />;
    case "callout":
      return <CalloutView block={block} />;
    case "preview":
      return <PreviewView block={block} />;
    case "research":
      return <ResearchView block={block} />;
  }
}
