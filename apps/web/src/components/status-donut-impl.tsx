"use client";
// The applications-by-status donut (analytics). Split out of analytics-view.tsx so
// recharts loads lazily — see lazy-chart.tsx.
import { PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type DonutDatum = { name: string; value: number; key: string };

// Status codes are fixed, code-level identifiers (safe as CSS custom-property
// keys), unlike free-text product/department names elsewhere — so this donut
// gets full config-driven colouring via chart.tsx.
export default function StatusDonutImpl({ data, colors }: { data: DonutDatum[]; colors: Record<string, string> }) {
  const config = Object.fromEntries(
    Object.entries(colors).map(([status, color]) => [status, { label: (status.charAt(0).toUpperCase() + status.slice(1)).replace(/_/g, " "), color }]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[160px] w-full">
      <PieChart accessibilityLayer>
        <Pie data={data} dataKey="value" nameKey="key" innerRadius={45} outerRadius={70} paddingAngle={2}>
          {data.map((d) => <Cell key={d.key} fill={`var(--color-${d.key})`} />)}
        </Pie>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
      </PieChart>
    </ChartContainer>
  );
}
