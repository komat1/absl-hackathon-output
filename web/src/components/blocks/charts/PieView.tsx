import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartFrame, ChartLegend } from "./ChartFrame";
import { ChartTip, type RechartsTipProps } from "./ChartTip";
import { groupColor } from "@/lib/chartColors";
import type { ChartBlock, ValueFormat } from "@/types/blocks";

/**
 * A split read at a glance.
 *
 * Kept as a donut rather than a full pie — the hole gives the slices a common
 * inner edge, which is the only thing that makes close shares comparable. When
 * the reader has to rank the parts or tell near-equal ones apart, the answer is
 * a horizontal-bar instead, and the agent is told so.
 */
export function PieView({ block }: { block: ChartBlock }) {
  const key = block.series[0]?.key ?? "value";
  const items = block.data.map((row, index) => ({
    name: String(row[block.x_key] ?? ""),
    // An outcome split (Won / Lost / Active) wears the status colours the
    // server named; anything else takes the categorical slots in order.
    color: groupColor(block, String(row[block.x_key] ?? ""), index)
  }));
  return (
    <ChartFrame title={block.title} note={block.note} legend={<ChartLegend items={items} />}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={block.data}
            dataKey={key}
            nameKey={block.x_key}
            innerRadius={54}
            outerRadius={92}
            paddingAngle={2}
            stroke="var(--raise)"
            strokeWidth={2}
          >
            {items.map((item, index) => (
              <Cell key={index} fill={item.color} />
            ))}
          </Pie>
          <Tooltip content={<PieTip format={block.format} />} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function PieTip({ active, payload, format }: RechartsTipProps & { format: ValueFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTip
      rows={payload.map((entry) => ({
        name: entry.name ?? "",
        value: entry.value,
        color: entry.color,
        format
      }))}
    />
  );
}
