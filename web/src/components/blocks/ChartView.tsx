import { CartesianChart } from "./charts/CartesianChart";
import { FunnelView } from "./charts/FunnelView";
import { HeatmapView } from "./charts/HeatmapView";
import { PieView } from "./charts/PieView";
import { ScatterView } from "./charts/ScatterView";
import { WaterfallView } from "./charts/WaterfallView";
import type { ChartBlock } from "@/types/blocks";

/**
 * The chart registry: one component per form the server may ask for.
 *
 * Switching form is a setting on the block, not a different block — so "make
 * that a funnel" keeps the same data, the same scope and the same filters, and
 * only the marks change. The switch itself is exhaustive over ChartKind, which
 * is how a form added to the contract without a renderer becomes a compile
 * error here rather than an empty panel in front of a judge.
 */
export function ChartView({ block }: { block: ChartBlock }) {
  switch (block.chart) {
    case "pie":
      return <PieView block={block} />;
    case "funnel":
      return <FunnelView block={block} />;
    case "scatter":
      return <ScatterView block={block} />;
    case "waterfall":
      return <WaterfallView block={block} />;
    case "heatmap":
      return <HeatmapView block={block} />;
    case "line":
    case "area":
    case "bar":
    case "stacked-bar":
    case "horizontal-bar":
    case "combo":
      return <CartesianChart block={block} />;
  }
}
