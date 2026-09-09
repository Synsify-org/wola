"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wallet, Loader2 } from "lucide-react";
import { recordRepaymentAction } from "@/app/loans/[id]/repay-actions";

// Shown on an ACTIVE loan for finance roles. Records a repayment (default: the
// scheduled instalment, the common payroll case) and revalidates so the true
// outstanding drops. On full repayment the loan auto-settles.
export default function RepayButton({
  loanId,
  suggested,
}: {
  loanId: string;
  suggested: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(suggested)));
  const [source, setSource] = useState<"payroll" | "manual">("payroll");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

  function submit() {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) { setError("Enter a positive amount."); return; }
    startTransition(async () => {
      const res = await recordRepaymentAction(loanId, value, source);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
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
          className="mt-1 w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand num"
        />
      </label>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setSource("payroll")}
          className={
            "rounded-full px-3 py-1 text-xs font-medium " +
            (source === "payroll" ? "bg-brand text-brand-ink" : "border border-rule text-ink-soft")
          }
        >
          Payroll
        </button>
        <button
          onClick={() => setSource("manual")}
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
          disabled={pending}
          className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {pending ? "Recording…" : `Record ${ugx(Number(amount) || 0)}`}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          disabled={pending}
          className="btn btn--ghost rounded-full text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
