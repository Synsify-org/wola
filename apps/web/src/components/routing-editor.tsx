"use client";
// Approval routing: for each loan product, the ordered list of approvers an
// application passes through. Only administrators can edit (the server action
// enforces it). While applications are in review the approvers themselves are
// locked — they were submitted under this chain — but time limits and
// delegation can still be tuned.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Loader2, Lock, Plus, Trash2, UserCheck } from "lucide-react";
import { EXCEPTION_APPLICANT_ROLES, MAX_STAGES, ROUTABLE_ROLES, validateStages } from "@wola/engine";
import { OptionSelect } from "@/components/ui/select";
import { roleLabel } from "@/lib/product-summary";
import { saveChainAction } from "@/app/(app)/settings/routing/actions";

export interface RoutingStageView { id: string; role: string; slaHours: number | null; allowDelegation: boolean }
export interface RoutingChainView { appliesTo: string; stages: RoutingStageView[] }
export interface ProductRoutingView {
  productId: string;
  productName: string;
  active: boolean;
  inReview: number;
  chains: RoutingChainView[];
}

type Row = { key: number; role: string; sla: string; delegation: boolean };
let nextKey = 1;
const toRows = (stages: { role: string; slaHours: number | null; allowDelegation: boolean }[]): Row[] =>
  stages.map((s) => ({ key: nextKey++, role: s.role, sla: s.slaHours == null ? "" : String(s.slaHours), delegation: s.allowDelegation }));

const smallInput =
  "h-10 w-full rounded-xl border border-rule bg-surface px-3 text-sm text-ink shadow-theme-xs outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-ink-faint/50 focus-visible:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-100 disabled:bg-paper";
const iconBtn =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-rule text-ink-soft transition-colors hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

function ChainSummary({ stages }: { stages: { role: string }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {stages.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          {i > 0 ? <span className="text-ink-faint" aria-hidden>→</span> : null}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-brand text-[0.625rem] font-bold text-brand-ink">{i + 1}</span>
            {roleLabel(s.role)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChainEditor({
  productId, appliesTo, initialStages, locked, canEdit, isNew, onDone,
}: {
  productId: string;
  appliesTo: string;
  initialStages: { role: string; slaHours: number | null; allowDelegation: boolean }[];
  locked: boolean;
  canEdit: boolean;
  /** An exception that hasn't been saved yet. */
  isNew?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initialStages));
  const [editing, setEditing] = useState(!!isNew);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const stages = rows.map((r) => ({
    role: r.role,
    slaHours: r.sla.trim() === "" ? null : Number(r.sla),
    allowDelegation: r.delegation,
  }));
  const check = validateStages(stages, { required: appliesTo === "default" });
  const used = new Set(rows.map((r) => r.role));
  const free = ROUTABLE_ROLES.filter((r) => !used.has(r));

  const touch = () => setMsg(null);
  const move = (i: number, d: -1 | 1) => setRows((cur) => {
    const j = i + d;
    if (j < 0 || j >= cur.length) return cur;
    const copy = [...cur];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  function save(list = stages) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveChainAction(productId, appliesTo, list);
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: res.message });
      setEditing(false);
      onDone?.();
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        {rows.length ? <ChainSummary stages={rows} /> : <p className="text-sm font-medium text-rejected">Nobody — applications for this product can&apos;t be approved yet.</p>}
        <div className="flex items-center gap-3">
          {msg?.kind === "ok" ? <span className="inline-flex items-center gap-1 text-xs font-medium text-approved"><Check className="h-3.5 w-3.5" />{msg.text}</span> : null}
          {canEdit ? (
            <button onClick={() => setEditing(true)} className="btn btn--ghost h-9 rounded-full px-4 text-sm">
              {rows.length ? "Edit" : "Set up"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {locked ? (
        <div className="flex items-start gap-2 rounded-xl bg-awaiting-wash px-3 py-2 text-xs text-ink">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Applications are still in review, so who approves — and in what order — is locked. You can still change time limits.
        </div>
      ) : null}

      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-xl border border-rule bg-paper/60 p-3 sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">{i + 1}</span>
            <OptionSelect
              ariaLabel={`Approver for stage ${i + 1}`}
              value={r.role}
              disabled={locked}
              onValueChange={(v) => { setRows((cur) => cur.map((x) => x.key === r.key ? { ...x, role: v } : x)); touch(); }}
              options={ROUTABLE_ROLES.filter((role) => role === r.role || !used.has(role)).map((role) => ({ value: role, label: roleLabel(role) }))}
            />
            <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
              <input
                aria-label={`Time limit in hours for stage ${i + 1}`}
                value={r.sla}
                inputMode="numeric"
                placeholder="No limit"
                onChange={(e) => { setRows((cur) => cur.map((x) => x.key === r.key ? { ...x, sla: e.target.value } : x)); touch(); }}
                className={smallInput}
              />
              <span className="shrink-0 text-xs text-ink-soft">hours</span>
            </div>
            <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
              <button type="button" aria-label="Move up" disabled={locked || i === 0} onClick={() => { move(i, -1); touch(); }} className={iconBtn}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Move down" disabled={locked || i === rows.length - 1} onClick={() => { move(i, 1); touch(); }} className={iconBtn}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label="Remove approver" disabled={locked || (appliesTo === "default" && rows.length === 1)} onClick={() => { setRows((cur) => cur.filter((x) => x.key !== r.key)); touch(); }} className={iconBtn}><Trash2 className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-xs text-ink-soft">
        A time limit marks an application &ldquo;over limit&rdquo; in that approver&apos;s queue once it has waited longer. It
        doesn&apos;t approve or reassign anything by itself.
      </p>

      {!locked && rows.length < MAX_STAGES && free.length > 0 ? (
        <button type="button" onClick={() => { setRows((cur) => [...cur, { key: nextKey++, role: free[0], sla: "", delegation: true }]); touch(); }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <Plus className="h-4 w-4" /> Add an approver
        </button>
      ) : null}

      {!check.ok && rows.length > 0 ? <p className="text-xs font-medium text-error-600">{check.error}</p> : null}
      {msg?.kind === "err" ? (
        <div className="flex items-start gap-2 rounded-xl bg-rejected-wash px-3 py-2 text-sm text-rejected">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {msg.text}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button onClick={() => save()} disabled={pending || !check.ok} className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full text-sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={pending}
          onClick={() => { setRows(toRows(initialStages)); setEditing(false); setMsg(null); if (isNew) onDone?.(); }}
          className="text-sm font-medium text-ink-soft hover:text-ink">
          Cancel
        </button>
        {appliesTo !== "default" && !isNew && !locked ? (
          <button type="button" disabled={pending} onClick={() => save([])} className="ml-auto text-sm font-medium text-rejected hover:underline">
            Remove this exception
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function RoutingEditor({ product, canEdit }: { product: ProductRoutingView; canEdit: boolean }) {
  const [drafts, setDrafts] = useState<string[]>([]);
  const standard = product.chains.find((c) => c.appliesTo === "default");
  const exceptions = product.chains.filter((c) => c.appliesTo !== "default");
  const takenGroups = new Set([...exceptions.map((c) => c.appliesTo), ...drafts]);
  const addable = EXCEPTION_APPLICANT_ROLES.filter((r) => !takenGroups.has(r));
  const [pick, setPick] = useState<string>("");
  const locked = product.inReview > 0;

  return (
    <section className={"rounded-2xl border border-rule bg-surface p-5 shadow-theme-xs sm:p-6 " + (product.active ? "" : "opacity-75")}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[1.0625rem] font-semibold text-ink">{product.productName}</h2>
        {!product.active ? <span className="chip">Off</span> : null}
        {product.inReview > 0 ? <span className="chip chip--awaiting">{product.inReview} in review</span> : null}
      </div>

      <div className="caps mb-2">Standard chain</div>
      <ChainEditor
        productId={product.productId}
        appliesTo="default"
        initialStages={standard?.stages ?? []}
        locked={locked}
        canEdit={canEdit}
      />

      {exceptions.length > 0 || drafts.length > 0 || (canEdit && addable.length > 0) ? (
        <div className="mt-6 border-t border-rule pt-5">
          <div className="caps mb-1">Different approvers for some applicants</div>
          <p className="mb-3 text-xs text-ink-soft">
            Applicants never approve their own loan: if their role is on the chain, that step is skipped. Give a group
            its own chain only if skipping isn&apos;t enough.
          </p>

          <div className="space-y-4">
            {exceptions.map((c) => (
              <div key={c.appliesTo} className="rounded-xl border border-rule p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                  <UserCheck className="h-4 w-4 text-ink-faint" /> When a {roleLabel(c.appliesTo)} applies
                </div>
                <ChainEditor productId={product.productId} appliesTo={c.appliesTo} initialStages={c.stages} locked={locked} canEdit={canEdit} />
              </div>
            ))}
            {drafts.map((g) => (
              <div key={g} className="rounded-xl border border-brand-200 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                  <UserCheck className="h-4 w-4 text-ink-faint" /> When a {roleLabel(g)} applies
                </div>
                <ChainEditor
                  isNew
                  productId={product.productId}
                  appliesTo={g}
                  initialStages={(standard?.stages ?? []).filter((s) => s.role !== g)}
                  locked={false}
                  canEdit={canEdit}
                  onDone={() => setDrafts((cur) => cur.filter((x) => x !== g))}
                />
              </div>
            ))}
          </div>

          {canEdit && addable.length > 0 && !locked ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="w-56">
                <OptionSelect
                  ariaLabel="Applicant group"
                  value={pick}
                  placeholder="Choose a group…"
                  onValueChange={setPick}
                  options={addable.map((r) => ({ value: r, label: roleLabel(r) }))}
                />
              </div>
              <button type="button" disabled={!pick} onClick={() => { setDrafts((cur) => [...cur, pick]); setPick(""); }}
                className="btn btn--ghost h-10 rounded-full px-4 text-sm">
                <Plus className="h-4 w-4" /> Add exception
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
