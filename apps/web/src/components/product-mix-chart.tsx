"use client";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

// Forest-brand ramp for slices — brand green down through lighter greens,
// never the state colours (those mean approved/rejected, not product).
const COLORS = ["#064E3B", "#1B5E4B", "#40916C", "#74C69D", "#B7E4C7"];

type Slice = { name: string; principal: number; n: number };

export default function ProductMixChart({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.principal, 0);

  return (
    <div className="rounded-lg border border-rule bg-surface p-4">
      <div className="caps mb-3">Book by product</div>
      <div className="flex items-center gap-6">
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="principal"
                nameKey="name"
                innerRadius={44}
                outerRadius={72}
                paddingAngle={2}
                strokeWidth={0}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => ugx(value)}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--color-rule)",
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <ul className="flex-1 space-y-2">
          {data.map((d, i) => {
            const pct = total > 0 ? Math.round((d.principal / total) * 100) : 0;
            return (
              <li key={d.name} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <span className="flex-1 truncate text-ink">{d.name}</span>
                <span className="num text-xs text-ink-soft">{pct}%</span>
                <span className="num w-28 text-right text-ink">
                  {ugx(d.principal)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
