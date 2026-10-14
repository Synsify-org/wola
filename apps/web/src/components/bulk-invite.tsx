"use client";
// Invite many people from a list (employee number, work email, role). Two steps on purpose:
// "Check the list" writes nothing and shows what would happen row by row; only then
// "Send invitations". The server action enforces who may do this and reuses the same invite path
// as inviting one person, so no rule is bypassed.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, MailPlus, Upload } from "lucide-react";
import DashboardCard from "./dashboard-card";
import { roleLabel } from "@/lib/product-summary";
import { bulkInviteAction, type BulkInviteResult } from "@/app/(app)/settings/access/actions";

export default function BulkInvite() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const file = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result ?? "")); setResult(null); };
    reader.readAsText(f);
  }
  const run = (send: boolean) => start(async () => {
    const r = await bulkInviteAction(text, send);
    setResult(r);
    if (r.ok && send) { setText(""); setFileName(""); if (file.current) file.current.value = ""; router.refresh(); }
  });

  const rows = result?.ok ? result.rows : [];
  const problems = rows.filter((r) => r.problem);
  const sent = result?.ok ? result.sent : null;

  return (
    <DashboardCard title="Invite many people from a list">
      <p className="text-sm text-ink-soft">
        A file with the columns <code className="num">employee_no</code> and <code className="num">role</code> (and <code className="num">work_email</code> if you have it).
        People must already be in <b>Settings → Employees</b>. A missing email is taken from the work email saved on their record
        (<b>Employees → Fill in details</b>); anyone with none is skipped, so you can send the list in stages and upload it again.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input ref={file} type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" id="bulk-invite-file" />
        <label htmlFor="bulk-invite-file" className="btn inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-rule bg-surface px-4 text-sm font-medium text-ink hover:border-ink-faint/50">
          <Upload className="h-4 w-4" /> {fileName || "Choose a CSV file"}
        </label>
        <button onClick={() => run(false)} disabled={pending || !text.trim()} className="btn inline-flex h-10 items-center gap-2 rounded-full border border-rule bg-surface px-4 text-sm font-medium text-ink hover:border-ink-faint/50 disabled:opacity-50">
          {pending && sent === null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Check the list
        </button>
      </div>

      {result && !result.ok ? (
        <p className="mt-4 flex items-start gap-2 text-sm font-medium text-error-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {result.error}</p>
      ) : null}

      {result?.ok && sent !== null ? (
        <p className="mt-4 text-sm font-medium text-approved">
          <Check className="mr-1 inline h-4 w-4" />
          {sent} invitation{sent === 1 ? "" : "s"} sent. They arrive by email within a few minutes{problems.length ? `; ${problems.length} could not be sent (below)` : ""}.
        </p>
      ) : null}

      {result?.ok && sent === null ? (
        <p className="mt-4 text-sm text-ink">
          <b>{result.willInvite}</b> will be invited{problems.length ? <>, <b className="text-error-600">{problems.length}</b> have a problem</> : null}
          {result.noEmail ? <>, <b>{result.noEmail}</b> have no email yet and are skipped</> : null}.
        </p>
      ) : null}

      {result?.ok && problems.length ? (
        <ul className="mt-3 divide-y divide-rule rounded-xl border border-rule text-sm">
          {problems.slice(0, 50).map((r) => (
            <li key={r.line} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2">
              <span className="min-w-0 break-words"><span className="font-medium text-ink">{r.name ?? r.employeeNo ?? `Line ${r.line}`}</span> <span className="text-ink-soft">{r.email}</span></span>
              <span className="text-xs text-error-600">{r.problem}</span>
            </li>
          ))}
          {problems.length > 50 ? <li className="px-4 py-2 text-xs text-ink-soft">…and {problems.length - 50} more.</li> : null}
        </ul>
      ) : null}

      {result?.ok && sent === null && result.willInvite > 0 ? (
        <>
          <ul className="mt-3 max-h-64 divide-y divide-rule overflow-y-auto rounded-xl border border-rule text-sm">
            {rows.filter((r) => !r.problem).map((r) => (
              <li key={r.line} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2">
                <span className="min-w-0 break-words"><span className="font-medium text-ink">{r.name}</span> <span className="text-ink-soft">{r.email}</span></span>
                <span className="text-xs text-ink-soft">{roleLabel(r.role)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => run(true)} disabled={pending} className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
              Send {result.willInvite} invitation{result.willInvite === 1 ? "" : "s"}
            </button>
            <p className="text-xs text-ink-soft">Each person chooses their own password. Links work for 7 days.</p>
          </div>
        </>
      ) : null}
    </DashboardCard>
  );
}
