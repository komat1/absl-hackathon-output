import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartLegend } from "./ChartFrame";
import { ChartTip, type RechartsTipProps } from "./ChartTip";
import { TONE_COLOR } from "@/lib/chartColors";
import { compactMoney } from "@/lib/format";
import type { ChartBlock } from "@/types/blocks";

const NEUTRAL = "color-mix(in oklab, var(--text) 42%, var(--raise))";

/**
 * The bridge from one period's total to the next.
 *
 * Each step floats on a transparent base computed by the server, so a step
 * starts where the one before it finished and the two totals stand on the
 * axis. Colour is polarity — up, down, and a neutral grey for the totals,
 * which are not a direction.
 */
export function WaterfallView({ block }: { block: ChartBlock }) {
  const spanKey = block.series[0]?.key ?? "span";
  const tick = { fill: "var(--text-3)", fontSize: 10.5 };
  return (
    <ChartFrame
      title={block.title}
      note={block.note}
      height={300}
      legend={
        <ChartLegend
          items={[
            { name: "Period total", color: NEUTRAL },
            { name: "Increase", color: TONE_COLOR.good },
            { name: "Decrease", color: TONE_COLOR.bad }
          ]}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={block.data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          {/* Six steps, named in full — "Workplace & Communications" does not fit
              under a bar at this width, and angling the labels keeps every name
              whole instead of truncating it to something ambiguous. */}
          <XAxis
            dataKey={block.x_key}
            tick={tick}
            stroke="var(--line)"
            interval={0}
            angle={-28}
            textAnchor="end"
            height={78}
          />
          <YAxis tick={tick} stroke="var(--line)" tickFormatter={compactMoney} width={56} />
          <Tooltip
            content={<WaterfallTip block={block} />}
            cursor={{ fill: "color-mix(in oklab, var(--text) 6%, transparent)" }}
          />
          {/* The invisible pedestal each step stands on. */}
          <Bar dataKey="base" stackId="bridge" fill="transparent" isAnimationActive={false} />
          <Bar dataKey={spanKey} stackId="bridge" radius={[4, 4, 0, 0]} maxBarSize={46}>
            {block.data.map((row, index) => (
              <Cell key={index} fill={stepColor(row)} />
            ))}
            {/* A step worth a few per cent of the total is a bar two pixels
                tall. The bar stays honest — it is not stretched to be seen —
                and the figure above it is what makes it readable. */}
            <LabelList content={<StepLabel rows={block.data} />} />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * The signed figure above a step.
 *
 * Only the steps carry one: a period total is not a direction, and printing it
 * as "+€12.6M" would read as a rise that never happened. The totals are the
 * tallest bars on the chart and the axis already says what they are.
 */
function StepLabel({
  x = 0,
  y = 0,
  width = 0,
  index = 0,
  rows
}: {
  x?: number;
  y?: number;
  width?: number;
  index?: number;
  rows: ChartBlock["data"];
}) {
  const row = rows[index];
  if (!row || row.kind !== "delta") return null;
  const amount = Number(row.value ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 6}
      textAnchor="middle"
      fontSize={10.5}
      fill="var(--text-3)"
      className="tabular-nums"
    >
      {`${amount > 0 ? "+" : "−"}${compactMoney(Math.abs(amount))}`}
    </text>
  );
}

function stepColor(row: Record<string, string | number | null>): string {
  if (row.kind === "total") return NEUTRAL;
  return Number(row.value ?? 0) >= 0 ? TONE_COLOR.good : TONE_COLOR.bad;
}

function WaterfallTip({ active, payload, block }: RechartsTipProps & { block: ChartBlock }) {
  const row = payload?.[0]?.payload as Record<string, string | number | null> | undefined;
  if (!active || !row) return null;
  const total = row.kind === "total";
  const value = Number(row.value ?? 0);
  return (
    <ChartTip
      heading={String(row[block.x_key] ?? "")}
      rows={[
        {
          name: total ? "Recorded revenue" : "Change",
          value: total ? value : null,
          raw: total ? undefined : `${value >= 0 ? "+" : "−"}${compactMoney(Math.abs(value))}`,
          format: block.format,
          color: stepColor(row)
        }
      ]}
    />
  );
}
