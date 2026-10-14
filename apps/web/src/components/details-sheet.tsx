"use client";
// "Fill in details": one table where HR (or an administrator) types in what the organisation's
// own staff list did not have: gross and net pay, whether each person is past probation, their
// work email (where the invitation goes) and, for anyone loaded under a temporary number, the real
// employee number. Missing values are highlighted. Only the rows you change are saved, together,
// and nothing is saved if any row is wrong.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Save } from "lucide-react";
import { isProvisionalEmployeeNo } from "@wola/engine";
import { OptionSelect } from "@/components/ui/select";
import { saveDetailsAction, type DetailsRow } from "@/app/(app)/settings/employees-actions";

export type SheetPerson = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  title: string | null;
  gross: number;
  net: number;
  postProbation: boolean;
  workEmail: string | null;
  hasLogin: boolean;
  note: string | null;
};

type Draft = { employeeNo: string; gross: string; net: string; post: boolean; email: string };

const toDraft = (p: SheetPerson): Draft => ({
  employeeNo: p.employeeNo,
  gross: p.gross ? String(p.gross) : "",
  net: p.net ? String(p.net) : "",
  post: p.postProbation,
  email: p.workEmail ?? "",
});
const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(/[,\s]/g, "")));
const cell = "h-9 w-full rounded-lg border bg-surface px-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus-visible:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-100";
const ok = "border-rule hover:border-ink-faint/50";
const warn = "border-awaiting bg-awaiting-wash";

export default function DetailsSheet({ people }: { people: SheetPerson[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(people.map((p) => [p.id, toDraft(p)])));
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string; rows?: string[] } | null>(null);

  const initial = useMemo(() => Object.fromEntries(people.map((p) => [p.id, toDraft(p)])), [people]);
  const changed = people.filter((p) => JSON.stringify(drafts[p.id]) !== JSON.stringify(initial[p.id]));
  const set = (id: string, patch: Partial<Draft>) => { setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } })); setResult(null); };

  function save() {
    const rows: DetailsRow[] = changed.map((p) => {
      const d = drafts[p.id];
      return { id: p.id, employee_no: d.employeeNo, gross_salary: num(d.gross), net_salary: num(d.net), is_post_probation: d.post, work_email: d.email.trim() || null };
    });
    start(async () => {
      const r = await saveDetailsAction(rows);
      if (!r.ok) { setResult({ kind: "error", text: r.error, rows: r.rowErrors }); return; }
      setResult({ kind: "ok", text: `Saved ${r.saved} ${r.saved === 1 ? "person" : "people"}.` });
      router.refresh();
    });
  }

  if (people.length === 0) {
    return <div className="rounded-xl border border-rule bg-surface p-10 text-center text-sm text-ink-soft shadow-theme-sm">Nobody needs this filled in. Everything here is complete.</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs font-medium text-ink-soft">
              <th className="px-3 py-2.5">Person</th>
              <th className="px-3 py-2.5">Employee no</th>
              <th className="px-3 py-2.5">Gross pay (monthly)</th>
              <th className="px-3 py-2.5">Net pay (monthly)</th>
              <th className="px-3 py-2.5">Probation</th>
              <th className="px-3 py-2.5">Work email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {people.map((p) => {
              const d = drafts[p.id];
              const dirty = JSON.stringify(d) !== JSON.stringify(initial[p.id]);
              const temp = isProvisionalEmployeeNo(p.employeeNo);
              return (
                <tr key={p.id} className={dirty ? "bg-brand-50/40" : undefined}>
                  <td className="px-3 py-2 align-middle">
                    <div className="font-medium text-ink">{p.name}</div>
                    <div className="text-xs text-ink-soft">{[p.department, p.title].filter(Boolean).join(" · ")}</div>
                    {p.note ? <div className="mt-0.5 flex items-start gap-1 text-xs text-awaiting"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{p.note}</div> : null}
                  </td>
                  <td className="w-40 px-3 py-2">
                    <input
                      aria-label={`Employee number for ${p.name}`}
                      value={d.employeeNo}
                      disabled={!temp}
                      onChange={(e) => set(p.id, { employeeNo: e.target.value })}
                      className={`num ${cell} ${temp ? warn : "border-transparent bg-transparent opacity-70"}`}
                    />
                    {temp ? <span className="mt-0.5 block text-[11px] text-awaiting">Temporary: type the real number</span> : null}
                  </td>
                  <td className="w-44 px-3 py-2">
                    <input aria-label={`Gross pay for ${p.name}`} inputMode="numeric" placeholder="e.g. 2500000" value={d.gross}
                      onChange={(e) => set(p.id, { gross: e.target.value })} className={`num ${cell} ${num(d.gross) > 0 ? ok : warn}`} />
                  </td>
                  <td className="w-44 px-3 py-2">
                    <input aria-label={`Net pay for ${p.name}`} inputMode="numeric" placeholder="e.g. 2000000" value={d.net}
                      onChange={(e) => set(p.id, { net: e.target.value })} className={`num ${cell} ${num(d.net) > 0 ? ok : warn}`} />
                  </td>
                  <td className="w-44 px-3 py-2">
                    <OptionSelect ariaLabel={`Probation status for ${p.name}`} size="sm" value={d.post ? "post" : "on"} onValueChange={(v) => set(p.id, { post: v === "post" })}
                      options={[{ value: "post", label: "Past probation" }, { value: "on", label: "On probation" }]} />
                  </td>
                  <td className="w-64 px-3 py-2">
                    {p.hasLogin ? (
                      <span className="text-xs text-ink-soft">Has a login</span>
                    ) : (
                      <input aria-label={`Work email for ${p.name}`} type="email" placeholder="name@company.com" value={d.email}
                        onChange={(e) => set(p.id, { email: e.target.value })} className={`${cell} ${d.email.trim() ? ok : warn}`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-surface/95 p-3 shadow-theme-md backdrop-blur">
        <button onClick={save} disabled={pending || changed.length === 0} className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full text-sm disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes yet"}
        </button>
        {changed.length ? <button onClick={() => { setDrafts(initial); setResult(null); }} disabled={pending} className="text-sm font-medium text-ink-soft hover:text-ink">Undo all</button> : null}
        {result?.kind === "ok" ? <span className="text-sm font-medium text-approved"><Check className="mr-1 inline h-4 w-4" />{result.text}</span> : null}
        {result?.kind === "error" ? <span className="text-sm font-medium text-error-600">{result.text}</span> : null}
      </div>
      {result?.kind === "error" && result.rows?.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-error-600">{result.rows.slice(0, 20).map((r, i) => <li key={i}>{r}</li>)}</ul>
      ) : null}
    </div>
  );
}
