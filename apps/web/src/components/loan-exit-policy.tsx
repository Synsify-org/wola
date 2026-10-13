"use client";
// What happens to a loan when its borrower leaves. Two honest options; nothing is ever
// written off automatically.
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { saveLoanExitPolicyAction } from "@/app/(app)/settings/details-actions";

type Policy = "recover_balance" | "manual";
const OPTIONS: { value: Policy; title: string; body: string }[] = [
  { value: "recover_balance", title: "Ask for the balance", body: "When HR marks someone as exited, a request to pay off each running loan goes to finance (Payroll screen). Nothing moves until finance records the money." },
  { value: "manual", title: "Handle it by hand", body: "Nothing is opened automatically. HR is only warned that the person still has a running loan." },
];

export default function LoanExitPolicy({ initial, canEdit }: { initial: Policy; canEdit: boolean }) {
  const [saved, setSaved] = useState<Policy>(initial);
  const [value, setValue] = useState<Policy>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <fieldset disabled={!canEdit || pending} className="min-w-0 space-y-3">
      <legend className="sr-only">When a borrower leaves</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm transition-colors ${value === o.value ? "border-brand-300 bg-brand-wash" : "border-rule bg-surface hover:border-brand-200"}`}>
          <input type="radio" name="exit-policy" className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]" checked={value === o.value} onChange={() => { setValue(o.value); setMsg(null); }} />
          <span className="min-w-0">
            <span className="block font-medium text-ink">{o.title}</span>
            <span className="mt-0.5 block text-ink-soft">{o.body}</span>
          </span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canEdit || pending || value === saved}
          onClick={() => start(async () => {
            const r = await saveLoanExitPolicyAction(value);
            if (r.ok) setSaved(value);
            setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
          })}
          className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save
        </button>
        {!canEdit ? <span className="text-xs text-ink-soft">Only an administrator can change this.</span> : null}
        {msg ? <span role="status" className={`text-sm ${msg.ok ? "text-approved" : "text-rejected"}`}>{msg.text}</span> : null}
      </div>
    </fieldset>
  );
}
