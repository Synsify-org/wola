"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2 } from "lucide-react";
import { disburseAction } from "@/app/loans/[id]/actions";

// Shown on a pending_disbursement loan for finance roles. Confirms the pay-out,
// captures an optional reference (cheque no / transfer ref), and calls the
// server action. On success the page revalidates and the loan flips to active.
export default function DisburseButton({
  loanId,
  amount,
}: {
  loanId: string;
  amount: number;
}) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const ugx = "UGX " + Math.round(amount).toLocaleString();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await disburseAction(loanId, reference);
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
        <Banknote className="h-4 w-4" />
        Disburse {ugx}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
      <p className="text-sm font-medium text-ink">
        Confirm disbursement of {ugx}
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        This records the pay-out and activates the loan. It can only be done once.
      </p>

      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Reference (optional)
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Cheque no / transfer ref"
          className="mt-1 w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
      </label>

      {error ? (
        <p className="mt-2 text-xs font-medium text-error-600">{error}</p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
          {pending ? "Disbursing…" : "Confirm disbursement"}
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
