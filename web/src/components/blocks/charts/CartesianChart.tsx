import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ChartFrame, ChartLegend } from "./ChartFrame";
import { ChartTip, type RechartsTipProps } from "./ChartTip";
import { TONE_COLOR, seriesColor } from "@/lib/chartColors";
import { compactMoney, formatValue } from "@/lib/format";
import type { ChartBlock, ValueFormat } from "@/types/blocks";

/**
 * Everything that lives on an x and a y axis: line, area, bar, stacked bar,
 * horizontal bar and the bar-plus-line combo.
 *
 * All six are one ComposedChart with different marks, because they are one
 * question asked in different voices — and because switching between them then
 * cannot lose the data, the scope or the reference line.
 *
 * There is no second y-axis, by construction. A combo's series share one
 * scale, so a smaller measure draws smaller; two scales would let a line
 * crossing the bars mean nothing at all.
 */
export function CartesianChart({ block }: { block: ChartBlock }) {
  const horizontal = block.chart === "horizontal-bar";
  const stacked = block.chart === "stacked-bar" || (horizontal && Boolean(block.stacked));
  const money = block.format === "money";
  const tick = { fill: "var(--text-3)", fontSize: 11 };
  const axis = { stroke: "var(--line)" };
  const ticks = money ? compactMoney : (value: number) => formatValue(value, block.format);

  // Long labels — company names, clusters — need room, and a ranking is the
  // chart whose labels are longest. Measured off the data rather than guessed.
  const widest = horizontal
    ? Math.min(176, Math.max(64, ...block.data.map((row) => String(row[block.x_key] ?? "").length * 6.4)))
    : 56;

  const legend = block.series.map((series, index) => ({
    name: series.name,
    color: seriesColor(series, index)
  }));

  return (
    <ChartFrame
      title={block.title}
      note={block.note}
      legend={<ChartLegend items={legend} />}
      height={horizontal ? Math.max(200, 30 + block.data.length * 30) : 260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={block.data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
          barCategoryGap={stacked ? "22%" : "18%"}
        >
          <CartesianGrid stroke="var(--line)" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={tick} {...axis} tickFormatter={ticks} />
              <YAxis
                type="category"
                dataKey={block.x_key}
                tick={tick}
                {...axis}
                width={widest}
                interval={0}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={block.x_key} tick={tick} {...axis} />
              <YAxis type="number" tick={tick} {...axis} tickFormatter={ticks} width={56} />
            </>
          )}
          <Tooltip
            content={<CartesianTip format={block.format} />}
            cursor={{ fill: "color-mix(in oklab, var(--text) 6%, transparent)" }}
          />

          {(block.references ?? []).map((reference) => (
            <ReferenceLine
              key={reference.label}
              {...(reference.axis === "y" ? { y: Number(reference.value) } : { x: reference.value })}
              stroke={TONE_COLOR[reference.tone]}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: reference.label,
                position: "insideTopRight",
                fill: "var(--text-4)",
                fontSize: 10.5
              }}
            />
          ))}

          {block.series.map((series, index) => {
            const color = seriesColor(series, index);
            const last = index === block.series.length - 1;
            if (series.draw === "line" || block.chart === "line") {
              return (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--raise)" }}
                />
              );
            }
            if (block.chart === "area") {
              return (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
              );
            }
            return (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.name}
                stackId={stacked ? "one" : undefined}
                fill={color}
                // A 2px surface edge between stacked segments, so two adjacent
                // fills never touch and read as one block.
                stroke={stacked ? "var(--raise)" : undefined}
                strokeWidth={stacked ? 2 : 0}
                radius={roundedEnd(horizontal, stacked, last)}
                maxBarSize={horizontal ? 18 : 38}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Rounded only at the data end, anchored square to the baseline — and on a
 *  stack only the topmost segment, which is where the data actually ends. */
function roundedEnd(
  horizontal: boolean,
  stacked: boolean,
  last: boolean
): [number, number, number, number] {
  if (stacked && !last) return [0, 0, 0, 0];
  return horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
}

function CartesianTip({
  active,
  payload,
  label,
  format
}: RechartsTipProps & { format: ValueFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTip
      heading={label === undefined ? undefined : String(label)}
      rows={payload.map((entry) => ({
        name: entry.name ?? String(entry.dataKey ?? ""),
        value: entry.value,
        color: entry.color,
        format
      }))}
    />
  );
}
