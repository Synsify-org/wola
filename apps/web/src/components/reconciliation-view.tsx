"use client";
// Payroll reconciliation screen. Plain on purpose: a finance person should be able to
// answer "did everyone's deduction arrive?" at a glance, then act on the exceptions.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Upload, Check, Pause, Loader2, Wallet } from "lucide-react";
import { formatMoney } from "@wola/engine";
import { OptionSelect } from "@/components/ui/select";
import type { CycleReport, CycleLine, CycleStatus, ActualsPreview, EarlyRepaymentRequest } from "@wola/db";
import {
  postBulkRunAction, previewActualsAction, postActualsAction, catchUpAction, pauseLoanAction,
  recordEarlyAction, declineEarlyAction,
} from "@/app/(app)/payroll/actions";

type Request = EarlyRepaymentRequest & { borrower: string; employeeNo: string; product: string };

const STATUS: Record<CycleStatus, { label: string; chip: string }> = {
  paid: { label: "Paid", chip: "chip--approved" },
  over: { label: "Over", chip: "chip--awaiting" },
  short: { label: "Short", chip: "chip--rejected" },
  missed: { label: "Missed", chip: "chip--rejected" },
  awaiting: { label: "Awaiting", chip: "chip--awaiting" },
  suspended: { label: "Paused", chip: "" },
};

const inputCls = "h-9 rounded-lg border border-rule bg-surface px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40";
const btnCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rule bg-surface px-3 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50";
const primaryCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

export default function ReconciliationView({
  report, requests, canAct, currency, prev, next,
}: {
  report: CycleReport; requests: Request[]; canAct: boolean; currency: string; prev: string; next: string | null;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ data: ActualsPreview; csv: string; fileName: string } | null>(null);
  const [open, setOpen] = useState<{ loanId: string; mode: "pay" | "pause" } | null>(null);
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState("1");
  const [reason, setReason] = useState("");

  const t = report.totals;
  const dueNow = report.lines.filter((l) => l.status === "awaiting" || l.status === "short" || l.status === "missed");
  const note = (ok: boolean, text: string) => setMessage({ ok, text });
  const done = (text: string) => { note(true, text); setOpen(null); router.refresh(); };

  function bulk() {
    if (!confirm(`Record ${money(dueNow.reduce((s, l) => s + l.remaining, 0))} across ${dueNow.length} loans as deducted for ${report.label}?`)) return;
    start(async () => {
      const r = await postBulkRunAction(report.cycle);
      if (!r.ok) return note(false, r.error);
      done(r.posted ? `Recorded ${money(r.postedTotal)} across ${r.posted} loans.` : "Nothing was due to record.");
    });
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const csv = await file.text();
    start(async () => {
      const r = await previewActualsAction(report.cycle, csv);
      if (!r.ok) return note(false, r.error);
      setMessage(null);
      setPreview({ data: r.preview, csv, fileName: file.name });
    });
  }

  function confirmImport() {
    if (!preview) return;
    start(async () => {
      const r = await postActualsAction(report.cycle, preview.csv, preview.fileName);
      if (!r.ok) return note(false, r.error);
      setPreview(null);
      done(`Recorded ${money(r.postedTotal)} across ${r.posted} loans from ${preview.fileName}.`);
    });
  }

  function catchUp(l: CycleLine) {
    const v = Number(amount);
    start(async () => {
      const r = await catchUpAction(l.loanId, v);
      if (!r.ok) return note(false, r.error);
      done(r.settled ? `${l.name}'s loan is now fully paid.` : `Recorded ${money(v)} for ${l.name}.`);
    });
  }

  function pause(l: CycleLine) {
    start(async () => {
      const r = await pauseLoanAction(l.loanId, report.cycle, Number(months), reason);
      if (!r.ok) return note(false, r.error);
      setReason("");
      done(`${l.name}'s instalments are paused until ${r.to}.`);
    });
  }

  // The pay / pause form, shown under a loan when its button was pressed. One definition
  // for the table (wide screens) and the cards (phones).
  const inlineForm = (l: CycleLine) => open?.loanId === l.loanId ? (

                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            {open.mode === "pay" ? (
                              <>
                                <label className="text-xs text-ink-soft">Amount received<input className={`${inputCls} mt-1 block w-36`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                                <button className={primaryCls} disabled={pending} onClick={() => catchUp(l)}>Record</button>
                              </>
                            ) : (
                              <>
                                <div className="text-xs text-ink-soft">Months<OptionSelect ariaLabel="Months to pause" className="mt-1 w-24" value={months} onValueChange={setMonths} options={[1, 2, 3, 4, 5, 6, 9, 12].map((m) => ({ value: String(m), label: String(m) }))} /></div>
                                <label className="text-xs text-ink-soft">Reason<input className={`${inputCls} mt-1 block w-52`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Unpaid leave" /></label>
                                <button className={primaryCls} disabled={pending || !reason.trim()} onClick={() => pause(l)}>Pause from {report.label}</button>
                              </>
                            )}
                            <button className={btnCls} onClick={() => setOpen(null)}>Cancel</button>
                          </div>
  ) : null;

  const rowButtons = (l: CycleLine) => canAct && open?.loanId !== l.loanId && (l.status === "short" || l.status === "missed" || l.status === "awaiting") ? (
    <span className="inline-flex flex-wrap gap-1.5">
      <button className={btnCls} onClick={() => { setAmount(String(l.remaining)); setOpen({ loanId: l.loanId, mode: "pay" }); }}><Wallet className="h-4 w-4" /> Record payment</button>
      <button className={btnCls} onClick={() => setOpen({ loanId: l.loanId, mode: "pause" })}><Pause className="h-4 w-4" /> Pause</button>
    </span>
  ) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Payroll reconciliation</h1>
          <p className="mt-1 text-sm text-ink-soft">What should come out of salaries, what did, and what to do about the gap.</p>
        </div>
        <nav aria-label="Payroll month" className="flex items-center gap-1">
          <Link href={`/payroll?cycle=${prev}`} className={btnCls} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Link>
          <span className="min-w-32 text-center text-sm font-medium text-ink">{report.label}</span>
          {next ? <Link href={`/payroll?cycle=${next}`} className={btnCls} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Link>
            : <span className={`${btnCls} pointer-events-none opacity-40`} aria-hidden><ChevronRight className="h-4 w-4" /></span>}
        </nav>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Expected" value={money(t.expected)} sub={`${t.loans} loan${t.loans === 1 ? "" : "s"}`} />
        <Tile label="Received" value={money(t.received)} sub={t.expected > 0 ? `${Math.round((t.received / t.expected) * 100)}% of expected` : "—"} />
        <Tile label="Still to collect" value={money(t.shortfall)} sub={report.open ? "Month still open" : "Month closed"} tone={t.shortfall > 0 && !report.open ? "bad" : undefined} />
        <Tile label="Exceptions" value={String(t.counts.short + t.counts.missed)} sub={`${t.counts.paid + t.counts.over} on track`} tone={t.counts.short + t.counts.missed > 0 ? "bad" : undefined} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <a className={btnCls} href={`/payroll/expected.csv?cycle=${report.cycle}`}><Download className="h-4 w-4" /> Expected deductions (CSV)</a>
        {canAct ? (
          <>
            <label className={`${btnCls} cursor-pointer`}>
              <Upload className="h-4 w-4" /> Import payroll file
              <input type="file" accept=".csv,text/csv" className="sr-only" disabled={pending}
                onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <button className={primaryCls} onClick={bulk} disabled={pending || dueNow.length === 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Record all due deductions
            </button>
          </>
        ) : null}
      </div>

      {message ? (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-approved-wash text-approved" : "bg-rejected-wash text-rejected"}`}>{message.text}</p>
      ) : null}

      {preview ? <PreviewPanel p={preview.data} fileName={preview.fileName} money={money} pending={pending} onConfirm={confirmImport} onCancel={() => setPreview(null)} /> : null}

      <section aria-labelledby="loans-h" className="overflow-hidden rounded-2xl border border-rule bg-surface">
        <h2 id="loans-h" className="border-b border-rule px-5 py-3 text-base font-semibold text-ink">Loans in {report.label}</h2>
        {report.lines.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-soft">No deductions are due for this month.</p>
        ) : (
          <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-paper text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr><th className="px-5 py-2">Employee</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Remaining</th><th className="px-3 py-2">Status</th><th className="px-5 py-2"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {report.lines.map((l) => {
                  const s = STATUS[l.status];
                  return (
                    <tr key={l.loanId} className="align-top">
                      <td className="px-5 py-3">
                        <Link href={`/loans/${l.loanId}`} className="font-medium text-ink hover:underline">{l.name}</Link>
                        <div className="text-xs text-ink-soft">{l.employeeNo} · {l.product}{l.arrearsBroughtForward > 0 ? ` · incl. ${money(l.arrearsBroughtForward)} arrears` : ""}</div>
                        {inlineForm(l)}
                      </td>
                      <td className="num px-3 py-3 text-right">{money(l.expected)}</td>
                      <td className="num px-3 py-3 text-right">{money(l.received)}</td>
                      <td className="num px-3 py-3 text-right">{l.remaining > 0 ? money(l.remaining) : "—"}</td>
                      <td className="px-3 py-3"><span className={`chip ${s.chip}`}>{s.label}</span></td>
                      <td className="px-5 py-3 text-right">{rowButtons(l)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-rule sm:hidden">
            {report.lines.map((l) => {
              const st = STATUS[l.status];
              return (
                <li key={l.loanId} className="space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/loans/${l.loanId}`} className="block break-words font-medium text-ink hover:underline">{l.name}</Link>
                      <div className="mt-0.5 break-words text-xs text-ink-soft">{l.employeeNo} · {l.product}</div>
                    </div>
                    <span className={`chip shrink-0 ${st.chip}`}>{st.label}</span>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 rounded-xl bg-paper px-3 py-2.5 text-sm">
                    <div className="min-w-0"><dt className="text-[0.6875rem] uppercase tracking-wide text-ink-soft">Expected</dt><dd className="num mt-0.5 break-words font-medium text-ink">{money(l.expected)}</dd></div>
                    <div className="min-w-0"><dt className="text-[0.6875rem] uppercase tracking-wide text-ink-soft">Received</dt><dd className="num mt-0.5 break-words font-medium text-ink">{money(l.received)}</dd></div>
                    <div className="min-w-0"><dt className="text-[0.6875rem] uppercase tracking-wide text-ink-soft">Remaining</dt><dd className="num mt-0.5 break-words font-medium text-ink">{l.remaining > 0 ? money(l.remaining) : "—"}</dd></div>
                  </dl>
                  {l.arrearsBroughtForward > 0 ? <p className="text-xs text-ink-soft">Includes {money(l.arrearsBroughtForward)} brought forward from earlier months.</p> : null}
                  {inlineForm(l)}
                  {rowButtons(l)}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>

      <section aria-labelledby="early-h" className="rounded-2xl border border-rule bg-surface">
        <h2 id="early-h" className="border-b border-rule px-5 py-3 text-base font-semibold text-ink">Early repayment requests</h2>
        {requests.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-soft">No one is waiting to repay early.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {requests.map((q) => <EarlyRow key={q.id} q={q} money={money} canAct={canAct} onDone={(t) => done(t)} onFail={(t) => note(false, t)} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "bad" }) {
  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className={`num mt-1 text-xl font-semibold ${tone === "bad" ? "text-rejected" : "text-ink"}`}>{value}</dd>
      <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>
    </div>
  );
}

function PreviewPanel({ p, fileName, money, pending, onConfirm, onCancel }: {
  p: ActualsPreview; fileName: string; money: (n: number) => string; pending: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const tone: Record<string, string> = { exact: "chip--approved", over: "chip--awaiting", short: "chip--awaiting" };
  return (
    <section aria-label="Import preview" className="rounded-2xl border border-rule bg-surface">
      <div className="border-b border-rule px-5 py-3">
        <h2 className="text-base font-semibold text-ink">Check before recording: {fileName}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {p.totals.postable} row{p.totals.postable === 1 ? "" : "s"} ready to record ({money(p.totals.postableTotal)}).
          {p.totals.blocked > 0 ? ` ${p.totals.blocked} can't be recorded.` : ""}
          {p.totals.missing > 0 ? ` ${p.totals.missing} loan${p.totals.missing === 1 ? " owes" : "s owe"} something but ${p.totals.missing === 1 ? "isn't" : "aren't"} in the file (${money(p.totals.missingTotal)}).` : ""}
        </p>
      </div>
      <ul className="max-h-72 divide-y divide-rule overflow-y-auto text-sm">
        {p.parseErrors.map((e) => <li key={`e${e.line}`} className="px-5 py-2 text-rejected">Line {e.line}: {e.message}</li>)}
        {p.rows.map((r) => (
          <li key={r.row.line} className="flex items-start justify-between gap-3 px-5 py-2">
            <span className="min-w-0"><span className="font-medium text-ink">{r.loan?.name ?? r.row.employeeNo}</span> <span className="text-ink-soft">{r.message}</span></span>
            <span className="flex shrink-0 items-center gap-2"><span className="num">{money(r.row.amount)}</span><span className={`chip ${tone[r.status] ?? "chip--rejected"}`}>{r.status.replace("_", " ")}</span></span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-rule px-5 py-3">
        <button className={primaryCls} disabled={pending || p.totals.postable === 0} onClick={onConfirm}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Record {p.totals.postable} row{p.totals.postable === 1 ? "" : "s"}
        </button>
        <button className={btnCls} onClick={onCancel}>Discard</button>
      </div>
    </section>
  );
}

function EarlyRow({ q, money, canAct, onDone, onFail }: {
  q: Request; money: (n: number) => string; canAct: boolean; onDone: (t: string) => void; onFail: (t: string) => void;
}) {
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const what = q.kind === "full" ? `Pay off in full (about ${money(q.quotedPayoff)})` : `Lump sum of ${money(q.amount ?? 0)}`;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
      <div className="min-w-0">
        <Link href={`/loans/${q.loanId}`} className="font-medium text-ink hover:underline">{q.borrower}</Link>
        <div className="text-ink-soft">{what}{q.reason ? ` · ${q.reason}` : ""}</div>
        {declining ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={`${inputCls} w-64`} placeholder="Reason, shown to the borrower" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className={btnCls} disabled={pending || !note.trim()} onClick={() => start(async () => { const r = await declineEarlyAction(q.id, note); r.ok ? onDone("Request declined.") : onFail(r.error); })}>Decline</button>
            <button className={btnCls} onClick={() => setDeclining(false)}>Cancel</button>
          </div>
        ) : null}
      </div>
      {canAct && !declining ? (
        <div className="flex gap-2">
          <button className={primaryCls} disabled={pending} onClick={() => start(async () => {
            if (!confirm(`Confirm the money for ${q.borrower} has arrived?`)) return;
            const r = await recordEarlyAction(q.id);
            r.ok ? onDone(r.settled ? `${q.borrower}'s loan is paid off.` : `Recorded ${money(r.amount)}; the schedule was shortened.`) : onFail(r.error);
          })}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Money received</button>
          <button className={btnCls} onClick={() => setDeclining(true)}>Decline</button>
        </div>
      ) : null}
    </li>
  );
}
