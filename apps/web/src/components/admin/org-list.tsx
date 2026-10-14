"use client";
// Every organisation, searchable. A table from md up; one card per organisation on a phone.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatMoney } from "@wola/engine";
import type { OrgSummary } from "@wola/db";
import { StatusChip } from "./parts";
import { timeAgo } from "@/lib/time-ago";

export default function OrgList({ orgs }: { orgs: OrgSummary[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? orgs.filter((o) => `${o.name} ${o.slug} ${o.status} ${o.plan}`.toLowerCase().includes(t)) : orgs;
  }, [orgs, q]);

  return (
    <div className="space-y-4">
      <label className="relative block max-w-md">
        <span className="sr-only">Search organisations</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, address or status"
          className="h-11 w-full rounded-xl border border-rule bg-surface pl-10 pr-3 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-100"
        />
      </label>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-rule bg-surface px-6 py-10 text-center text-sm text-ink-soft">
          {orgs.length === 0 ? "No organisations have been onboarded yet." : "No organisation matches that search."}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-rule bg-surface shadow-theme-xs md:block">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Organisation</th><th>Status</th><th className="r">People</th><th className="r">Active loans</th>
                  <th className="r">Outstanding</th><th className="r">Behind</th><th>Last activity</th><th>Onboarded</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/tenants/${o.id}`} className="font-medium text-ink hover:underline">{o.name}</Link>
                      <div className="num text-xs text-ink-faint">{o.slug} · {o.plan}</div>
                    </td>
                    <td><StatusChip status={o.status} /></td>
                    <td className="num r">{o.people}</td>
                    <td className="num r">{o.activeLoans}</td>
                    <td className="num r">{formatMoney(o.outstanding, o.currency)}</td>
                    <td className="num r">{o.arrearsLoans > 0 ? <span className="text-rejected">{o.arrearsLoans}</span> : "0"}</td>
                    <td className="text-sm text-ink-soft">{o.lastActivityAt ? timeAgo(o.lastActivityAt) : "None yet"}</td>
                    <td className="text-sm text-ink-soft">{new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {shown.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/tenants/${o.id}`} className="block rounded-2xl border border-rule bg-surface p-4 shadow-theme-xs active:bg-paper">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-medium text-ink">{o.name}</div>
                      <div className="num text-xs text-ink-faint">{o.slug} · {o.plan}</div>
                    </div>
                    <StatusChip status={o.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-paper px-3 py-2.5 text-sm">
                    <div className="min-w-0"><dt className="text-[0.6875rem] uppercase tracking-wide text-ink-soft">People</dt><dd className="num mt-0.5 font-medium text-ink">{o.people}</dd></div>
                    <div className="min-w-0"><dt className="text-[0.6875rem] uppercase tracking-wide text-ink-soft">Loans</dt><dd className="num mt-0.5 font-medium text-ink">{o.activeLoans}</dd></div>
                    <div className="min-w-0"><dt className="text-[0.6875rem] uppercase tracking-wide text-ink-soft">Behind</dt><dd className={"num mt-0.5 font-medium " + (o.arrearsLoans ? "text-rejected" : "text-ink")}>{o.arrearsLoans}</dd></div>
                  </dl>
                  <p className="num mt-2 break-words text-sm text-ink">{formatMoney(o.outstanding, o.currency)} <span className="text-xs text-ink-soft">outstanding</span></p>
                  <p className="mt-0.5 text-xs text-ink-faint">{o.lastActivityAt ? `Last activity ${timeAgo(o.lastActivityAt)}` : "No activity yet"}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
