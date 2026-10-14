"use client";
// Operator-only panel on a TRIAL organisation: load practice loans and a payroll history so the client can
// experience a working book. The ledger is append-only, so this cannot be undone: it asks the operator to type
// the organisation's short name first.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FlaskConical, Loader2, AlertTriangle } from "lucide-react";
import { loadPracticeDataAction } from "@/app/admin/tenants/[id]/actions";

export default function PracticeDataPanel({ tenantId, slug }: { tenantId: string; slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const run = (mode: "book" | "history") => start(async () => {
    const r = await loadPracticeDataAction(tenantId, mode, typed);
    setMsg(r.ok ? { kind: "ok", text: r.text } : { kind: "error", text: r.error });
    if (r.ok) { setTyped(""); router.refresh(); }
  });
  const ready = typed.trim() === slug && !pending;
  const btn = "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium disabled:opacity-50 ";

  return (
    <section className="mb-6 rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs" aria-label="Practice data">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><FlaskConical className="h-4 w-4 text-brand" aria-hidden /> Practice data (trial organisation)</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        Adds practice loans, a payroll history (last month left with a missed and a short deduction), one loan waiting for disbursement and applications at every approval stage,
        for the people already loaded. Approvals are attributed to practice accounts that cannot sign in and are never emailed. It uses the staff pay and probation already on file,
        and only works on an organisation flagged as a trial. <b>It cannot be undone</b> (the ledger is append-only); a trial is discarded whole.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-soft">
          Type <span className="num font-semibold text-ink">{slug}</span> to confirm
          <input value={typed} onChange={(e) => { setTyped(e.target.value); setMsg(null); }} autoComplete="off" spellCheck={false}
            className="mt-1 block h-10 w-56 rounded-xl border border-rule bg-surface px-3 text-sm text-ink outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100" />
        </label>
        <button disabled={!ready} onClick={() => run("book")} className={btn + "bg-brand text-brand-ink hover:bg-brand-700"}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Load practice loans and history
        </button>
        <button disabled={!ready} onClick={() => run("history")} className={btn + "border border-rule bg-surface text-ink hover:border-ink-faint/50"}>
          Payroll history only
        </button>
      </div>
      {msg ? (
        <p className={"mt-3 flex items-start gap-2 text-sm font-medium " + (msg.kind === "ok" ? "text-approved" : "text-error-600")}>
          {msg.kind === "ok" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />} {msg.text}
        </p>
      ) : null}
    </section>
  );
}
