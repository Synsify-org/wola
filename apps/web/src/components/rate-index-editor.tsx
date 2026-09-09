"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Percent, Loader2, Check, AlertTriangle } from "lucide-react";
import { setRateIndexAction } from "@/app/settings/rate-indices-actions";
import DashboardCard from "./dashboard-card";

export interface RateIndexRow {
  name: string;
  currentValue: number;
  effectiveFrom: string;
  productsLinked: number;
}

// Admin-only: set/update a named rate index (e.g. BoU CBR). Interest-bearing
// products with no index at all hard-fail final approval — the warning list
// below surfaces that BEFORE an approver hits it, not after.
export default function RateIndexEditor({
  indices,
  productsMissing,
}: {
  indices: RateIndexRow[];
  productsMissing: { id: string; name: string }[];
}) {
  const [name, setName] = useState(indices[0]?.name ?? "CBR");
  const [value, setValue] = useState(
    indices[0] ? String(indices[0].currentValue) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const parsed = Number(value);
  const validValue = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  function save() {
    setError(null);
    setSaved(false);
    if (!name.trim()) { setError("Name is required."); return; }
    if (!validValue) { setError("Enter a non-negative rate (e.g. 16.5 for 16.5%)."); return; }
    startTransition(async () => {
      const res = await setRateIndexAction(name.trim(), parsed);
      if (res.ok) { setSaved(true); router.refresh(); }
      else setError(res.error);
    });
  }

  return (
    <DashboardCard title="Rate indices">
      {productsMissing.length > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-rejected-wash px-3 py-2 text-xs text-rejected">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {productsMissing.length} product{productsMissing.length === 1 ? "" : "s"} apply
            interest but have no rate index set — final approval will fail on{" "}
            {productsMissing.map((p) => p.name).join(", ")} until one is set below.
          </span>
        </div>
      ) : null}

      {indices.length > 0 ? (
        <table className="ledger mb-4">
          <tbody>
            {indices.map((r) => (
              <tr key={r.name}>
                <td className="text-sm font-medium text-ink">{r.name}</td>
                <td className="num r text-sm text-ink">{r.currentValue.toFixed(3)}%</td>
                <td className="text-xs text-ink-soft">since {r.effectiveFrom}</td>
                <td className="text-xs text-ink-soft">{r.productsLinked} product{r.productsLinked === 1 ? "" : "s"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mb-4 text-xs text-ink-soft">No rate index set yet.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="caps mb-1.5 block">Index name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); setError(null); }}
            placeholder="CBR"
            className="h-9.5 w-full rounded-lg border border-rule bg-surface px-3 text-sm text-ink outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="caps mb-1.5 block">Value (%, e.g. 16.5)</label>
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setSaved(false); setError(null); }}
            inputMode="decimal"
            placeholder="16.5"
            className="h-9.5 w-full rounded-lg border border-rule bg-surface px-3 text-sm text-ink outline-none focus:border-brand"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={save}
            disabled={pending}
            className="btn btn--primary inline-flex h-9.5 items-center gap-2 rounded-full text-sm disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Percent className="h-4 w-4" />}
            {pending ? "Saving…" : saved ? "Saved" : "Set rate"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-3 text-xs font-medium text-error-600">{error}</p> : null}
      <p className="mt-3 text-xs text-ink-soft">
        Effective today. Every interest-bearing product currently on this index's previous
        value (or with none set) is repointed to the new value; past values are kept for audit.
      </p>
    </DashboardCard>
  );
}
