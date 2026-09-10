"use client";
import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { importEmployeesAction, type ImportResult } from "@/app/settings/employees-actions";

// HR's bulk import tool: CSV in, employees table upserted by employee_no.
// Same mechanism handles new starters AND a periodic payroll/salary refresh —
// see the comment in employees-actions.ts for why there's no separate
// "payroll import" path.
export default function EmployeeImport() {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function submit() {
    setResult(null);
    if (!csvText.trim()) {
      setResult({ ok: false, error: "Choose a CSV file or paste rows first." });
      return;
    }
    startTransition(async () => {
      const res = await importEmployeesAction(csvText);
      setResult(res);
      if (res.ok) {
        setCsvText("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm">
        <Upload className="h-4 w-4" />
        Import employees
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <p className="text-sm font-medium text-ink">Import employees (CSV)</p>
      <p className="mt-1 text-xs text-ink-soft">
        Header row required: <code className="num">employee_no, full_name, department, department_head_no, title, gross_salary, net_salary, is_post_probation, on_final_warning</code>.
        Re-running with an existing employee_no updates that row (salary refresh included) — the same import covers new starters and payroll updates. Values must not contain commas.
      </p>

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="mt-3 block text-sm text-ink-soft" />

      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder="…or paste CSV rows here"
        rows={6}
        className="num mt-3 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none focus:border-brand"
      />

      {result && !result.ok ? (
        <div className="mt-3 rounded-md bg-rejected-wash px-3 py-2 text-sm text-rejected">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {result.error}
          </div>
          {result.rowErrors && result.rowErrors.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
              {result.rowErrors.slice(0, 20).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result && result.ok ? (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-approved-wash px-3 py-2 text-sm text-approved">
          <CheckCircle2 className="h-4 w-4" />
          Imported: {result.created} created, {result.updated} updated.
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button onClick={submit} disabled={pending} className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {pending ? "Importing…" : "Import"}
        </button>
        <button
          onClick={() => { setOpen(false); setResult(null); setCsvText(""); }}
          disabled={pending}
          className="btn btn--ghost rounded-full text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
