"use client";
import { useEffect, useState, useTransition } from "react";
import { Wallet, Loader2 } from "lucide-react";
import { recordRepaymentAction } from "@/app/(app)/loans/[id]/repay-actions";
import { formatMoney } from "@wola/engine";

// Shown on an ACTIVE loan for finance roles. Records a repayment (pre-filled
// with what's due now, from the ledger) and revalidates so the true
// outstanding drops. On full repayment the loan auto-settles.
//
// Closing without a stale window: the page renders this with key={payoff}.
// Every successful payment changes the payoff, so when the refreshed page
// arrives React REMOUNTS this component — the form closes in the very render
// that shows the new balance and progress. Until then it stays open showing
// "Updating…". (Closing when the action resolved left ~0.5s of old figures on
// screen: the action's result lands before its revalidated page data.)
export default function RepayButton({
  loanId,
  suggested,
  currency,
}: {
  loanId: string;
  suggested: number;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(suggested));
  const [source, setSource] = useState<"payroll" | "manual">("payroll");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const ugx = (n: number) => formatMoney(n, currency);

  // Safety net: if the refreshed page somehow never arrives, don't leave the
  // form stuck on "Updating…".
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => { setSaved(false); setOpen(false); }, 8000);
    return () => clearTimeout(t);
  }, [saved]);

  function submit() {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) { setError("Enter a positive amount."); return; }
    startTransition(async () => {
      const res = await recordRepaymentAction(loanId, value, source);
      if (res.ok) setSaved(true); // closes via remount when the new figures render
      else setError(res.error);
    });
  }

  const busy = pending || saved;

  if (!open) {
    return (
      <button
        onClick={() => {
          // Re-read what's due now: the amount owed changes after every
          // payment, and the final instalment is often smaller.
          setAmount(String(suggested));
          setError(null);
          setOpen(true);
        }}
        className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm"
      >
        <Wallet className="h-4 w-4" />
        Record repayment
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
      <p className="text-sm font-medium text-ink">Record a repayment</p>
      <p className="mt-1 text-xs text-ink-soft">
        Posts a deduction to the ledger. Outstanding updates immediately.
      </p>

      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Amount
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand num"
        />
      </label>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setSource("payroll")}
          disabled={busy}
          className={
            "rounded-full px-3 py-1 text-xs font-medium " +
            (source === "payroll" ? "bg-brand text-brand-ink" : "border border-rule text-ink-soft")
          }
        >
          Payroll
        </button>
        <button
          onClick={() => setSource("manual")}
          disabled={busy}
          className={
            "rounded-full px-3 py-1 text-xs font-medium " +
            (source === "manual" ? "bg-brand text-brand-ink" : "border border-rule text-ink-soft")
          }
        >
          Manual
        </button>
      </div>

      {error ? <p className="mt-2 text-xs font-medium text-error-600">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {pending ? "Recording…" : saved ? "Updating…" : `Record ${ugx(Number(amount) || 0)}`}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          disabled={busy}
          className="btn btn--ghost rounded-full text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
