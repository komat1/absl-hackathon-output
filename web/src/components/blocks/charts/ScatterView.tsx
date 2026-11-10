import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ChartFrame, ChartLegend } from "./ChartFrame";
import { ChartTip, type RechartsTipProps } from "./ChartTip";
import { groupColor } from "@/lib/chartColors";
import { compactMoney, formatValue } from "@/lib/format";
import type { ChartBlock, ValueFormat } from "@/types/blocks";

/**
 * One point per deal: value across, win probability up, weighted value as size.
 *
 * This is the chart that answers "what should I work on" without being told —
 * the top right is big and likely, the bottom right is big and not, and colour
 * says which ones have run out of time.
 *
 * Colour carries at most three states, named in the legend. Classes read in all
 * pairs at once rather than side by side, so a fourth hue would stop being
 * separable; the server refuses to send one.
 */
export function ScatterView({ block }: { block: ChartBlock }) {
  const xKey = block.x_key;
  const yKey = block.y_key ?? "y";
  const groupKey = block.group_key;
  const yFormat: ValueFormat = block.y_format ?? "number";

  // Legend order follows the states the server declared, so "Overdue" leads
  // whether or not any deal is currently overdue.
  const declared = Object.keys(block.group_tones ?? {});
  const present = [...new Set(block.data.map((row) => String(row[groupKey ?? ""] ?? "")))];
  const groups = groupKey
    ? [...declared.filter((name) => present.includes(name)), ...present.filter((n) => !declared.includes(n))]
    : ["All"];

  const items = groups.map((name, index) => ({ name, color: groupColor(block, name, index) }));
  const tick = { fill: "var(--text-3)", fontSize: 11 };
  const axis = { stroke: "var(--line)" };

  return (
    <ChartFrame title={block.title} note={block.note} legend={<ChartLegend items={items} />}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
          <CartesianGrid stroke="var(--line)" />
          <XAxis
            type="number"
            dataKey={xKey}
            tick={tick}
            {...axis}
            tickFormatter={block.format === "money" ? compactMoney : undefined}
            label={{
              value: "Deal value",
              position: "insideBottom",
              offset: -12,
              fill: "var(--text-4)",
              fontSize: 10.5
            }}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            tick={tick}
            {...axis}
            width={46}
            domain={[0, 100]}
            tickFormatter={(value: number) => formatValue(value, yFormat)}
          />
          {block.size_key && <ZAxis type="number" dataKey={block.size_key} range={[48, 420]} />}
          <Tooltip
            content={<ScatterTip block={block} />}
            cursor={{ stroke: "var(--line)", strokeDasharray: "3 3" }}
          />
          {groups.map((name, index) => (
            <Scatter
              key={name}
              name={name}
              data={groupKey ? block.data.filter((row) => String(row[groupKey] ?? "") === name) : block.data}
              fill={groupColor(block, name, index)}
              fillOpacity={0.72}
              // A surface ring, so two points that overlap stay two points.
              stroke="var(--raise)"
              strokeWidth={1.5}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ScatterTip({ active, payload, block }: RechartsTipProps & { block: ChartBlock }) {
  const point = payload?.[0]?.payload as Record<string, string | number | null> | undefined;
  if (!active || !point) return null;
  const label = block.label_key ? String(point[block.label_key] ?? "") : undefined;
  const deal = point.deal ? ` · ${point.deal}` : "";
  return (
    <ChartTip
      heading={label ? `${label}${deal}` : undefined}
      rows={[
        { name: "Deal value", value: point[block.x_key], format: block.format },
        { name: "Win probability", value: point[block.y_key ?? "y"], format: block.y_format ?? "percent" },
        ...(block.size_key
          ? [{ name: "Weighted", value: point[block.size_key], format: block.format }]
          : []),
        ...(point.close_date ? [{ name: "Close date", value: null, raw: String(point.close_date) }] : []),
        ...(block.group_key
          ? [{ name: "Status", value: null, raw: String(point[block.group_key] ?? "") }]
          : [])
      ]}
    />
  );
}
