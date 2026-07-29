"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, Eye, Search } from "lucide-react";
import type { ApplicationRow } from "@/app/applications/page";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// Strip the "[demo] kind for Name" seed marker; show a clean purpose.
const cleanPurpose = (p: string | null, kind: string) => {
  if (!p) return kind.charAt(0).toUpperCase() + kind.slice(1);
  const m = p.replace(/^\[demo\][^a-z]*/i, "").trim();
  return m.length > 0 ? m : kind;
};

const STATUS_CHIP: Record<string, string> = {
  approved: "chip chip--approved",
  rejected: "chip chip--rejected",
  submitted: "chip chip--awaiting",
  in_review: "chip chip--awaiting",
  withdrawn: "chip",
  draft: "chip",
};
const statusLabel = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const col = createColumnHelper<ApplicationRow>();

export default function ApplicationsTable({ rows }: { rows: ApplicationRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "appliedAt", desc: true },
  ]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (kind !== "all" && r.productKind !== kind) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.applicantName.toLowerCase().includes(q) &&
          !r.employeeNo.toLowerCase().includes(q) &&
          !r.productName.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [rows, status, kind, search]);

  const columns = useMemo(
    () => [
      col.accessor("applicantName", {
        header: "Applicant",
        cell: (c) => (
          <div>
            <div className="font-medium text-ink">{c.getValue()}</div>
            <div className="num text-xs text-ink-soft">
              {c.row.original.employeeNo}
            </div>
          </div>
        ),
      }),
      col.accessor("productName", {
        header: "Product / Purpose",
        cell: (c) => (
          <div>
            <div className="text-ink">{c.getValue()}</div>
            <div className="text-xs text-ink-soft">
              {cleanPurpose(c.row.original.purpose, c.row.original.productKind)}
            </div>
          </div>
        ),
      }),
      col.accessor("amount", {
        header: "Amount",
        cell: (c) => <span className="num">{ugx(c.getValue())}</span>,
      }),
      col.accessor("tenorMonths", {
        header: "Term",
        cell: (c) => <span className="num text-ink-soft">{c.getValue()} mo</span>,
      }),
      col.accessor("status", {
        header: "Status",
        cell: (c) => (
          <span className={STATUS_CHIP[c.getValue()] ?? "chip"}>
            {statusLabel(c.getValue())}
          </span>
        ),
      }),
      col.accessor("appliedAt", {
        header: "Applied",
        cell: (c) => (
          <span className="num text-ink-soft">{shortDate(c.getValue())}</span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Link
            href={"/applications/" + c.row.original.id}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <Eye className="h-3.5 w-3.5" /> View
          </Link>
        ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const kinds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.productKind))),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Loan applications</h1>
        <p className="text-sm text-ink-soft">
          {filtered.length} of {rows.length} application
          {rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface p-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, staff no, product..."
            className="w-full rounded-md border border-rule bg-paper py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-rule bg-paper px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <option value="all">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="in_review">In review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-rule bg-paper px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <option value="all">All types</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        <table className="ledger">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id}>
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {flexRender(
                          h.column.columnDef.header,
                          h.getContext(),
                        )}
                        <ArrowUpDown className="h-3 w-3 opacity-50" />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-sm text-ink-soft">
                  No applications match your filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
