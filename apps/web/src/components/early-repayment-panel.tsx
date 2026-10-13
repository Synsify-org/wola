"use client";
// Ask to repay a loan early. The borrower (or HR, for someone leaving) asks; finance
// records the money when it arrives, and a lump sum shortens the schedule.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@wola/engine";
import { requestEarlyAction, cancelEarlyRequestAction } from "@/app/(app)/loans/[id]/early-actions";

const inputCls = "h-9 rounded-lg border border-rule bg-surface px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40";
const btnCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rule bg-surface px-3 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50";
const primaryCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

export default function EarlyRepaymentPanel({
  loanId, payoff, currency, open,
}: {
  loanId: string; payoff: number; currency: string;
  open: { id: string; kind: "full" | "partial"; amount: number | null; mine: boolean } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);

  if (open) {
    return (
      <section aria-labelledby="early-h" className="mb-6 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
        <h2 id="early-h" className="text-sm font-semibold text-ink">Early repayment requested</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {open.kind === "full" ? "Paying off the whole balance." : `Paying a lump sum of ${money(open.amount ?? 0)}.`}{" "}
          Finance will record it when the money arrives; until then nothing changes on this loan.
        </p>
        {open.mine ? (
          <button className={`${btnCls} mt-3`} disabled={pending} onClick={() => start(async () => {
            const r = await cancelEarlyRequestAction(loanId, open.id);
            if (r.ok) router.refresh(); else setError(r.error);
          })}>Withdraw request</button>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-sm text-rejected">{error}</p> : null}
      </section>
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await requestEarlyAction(loanId, kind, kind === "partial" ? Number(amount) : null, reason);
      if (r.ok) router.refresh(); else setError(r.error);
    });
  }

  return (
    <section aria-labelledby="early-h" className="mb-6 rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <h2 id="early-h" className="text-sm font-semibold text-ink">Repay early</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Pay a lump sum to finish sooner, or settle the whole balance (about {money(payoff)} today). Finance records it once the money has arrived.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <fieldset className="flex gap-4 text-sm text-ink">
          <legend className="sr-only">What to repay</legend>
          <label className="flex items-center gap-1.5"><input type="radio" checked={kind === "full"} onChange={() => setKind("full")} /> Whole balance</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={kind === "partial"} onChange={() => setKind("partial")} /> A lump sum</label>
        </fieldset>
        {kind === "partial" ? (
          <label className="text-xs text-ink-soft">Amount<input className={`${inputCls} mt-1 block w-36`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        ) : null}
        <label className="text-xs text-ink-soft">Note (optional)<input className={`${inputCls} mt-1 block w-56`} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className={primaryCls} disabled={pending || (kind === "partial" && !(Number(amount) > 0))} onClick={submit}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send request
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-rejected">{error}</p> : null}
    </section>
  );
}
