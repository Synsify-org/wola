"use client";
// Create / edit a loan product. Plain-language fields over the engine's rule
// columns (see 0008_product_rules.sql). Validation is the engine's own
// validateProductConfig, run live, so the form and the server agree.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { describePricing, effectiveAnnualRate, validateProductConfig, type ProductConfigInput } from "@wola/engine";
import { OptionSelect } from "@/components/ui/select";
import DashboardCard from "./dashboard-card";
import {
  createProductAction,
  updateProductAction,
  setProductActiveAction,
} from "@/app/(app)/settings/products/actions";

export interface ProductFormInitial extends ProductConfigInput {
  id: string;
  active: boolean;
  applications: number;
  inReview: number;
  activeLoans: number;
}

const inputCls =
  "h-10 w-full rounded-xl border border-rule bg-surface px-3.5 text-sm text-ink shadow-theme-xs outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-ink-faint/50 focus-visible:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-100 disabled:cursor-not-allowed disabled:bg-paper disabled:text-ink-soft";

const KIND_OPTIONS = [
  { value: "advance", label: "Advance", hint: "short, against salary" },
  { value: "term", label: "Term loan", hint: "development / personal" },
  { value: "asset", label: "Asset finance", hint: "e.g. a car" },
];

function Field({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      {/* The label wraps its control so the two are associated (screen readers,
          click-to-focus) without threading ids through every field. */}
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
        {children}
      </label>
      {error ? <p className="mt-1.5 text-xs font-medium text-error-600">{error}</p>
        : hint ? <p className="mt-1.5 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

function Check_({
  checked, onChange, title, desc, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string; disabled?: boolean }) {
  return (
    <label className={"flex items-start gap-3 rounded-xl border border-rule bg-surface p-3.5 " + (disabled ? "opacity-70" : "cursor-pointer hover:border-brand-200")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-soft">{desc}</span>
      </span>
    </label>
  );
}

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export default function ProductForm({
  initial,
  rates,
  otherProducts,
  canEdit,
}: {
  initial: ProductFormInitial | null;
  rates: { name: string; currentValue: number }[];
  otherProducts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<string>(initial?.kind ?? "term");
  const [capMethod, setCapMethod] = useState<string>(initial?.capMethod ?? "salary_multiple");
  const [capBasis, setCapBasis] = useState<string>(initial?.capBasis ?? "gross");
  const [capMultiple, setCapMultiple] = useState(initial?.capMultiple != null ? String(initial.capMultiple) : "");
  const [thPct, setThPct] = useState(initial?.takehomeFactor != null ? String(+(initial.takehomeFactor * 100).toFixed(2)) : "");
  const [thMonths, setThMonths] = useState(initial?.takehomeMultiplier != null ? String(initial.takehomeMultiplier) : "");
  const [tenor, setTenor] = useState(initial ? String(initial.maxTenorMonths) : "12");
  // One pricing choice in the UI, stored as (interestApplies, rateMode).
  const [pricing, setPricing] = useState<"none" | "index" | "fixed">(
    initial ? (!initial.interestApplies ? "none" : initial.rateMode) : "index",
  );
  const interest = pricing !== "none";
  const [margin, setMargin] = useState(initial && initial.rateMargin ? String(initial.rateMargin) : "");
  const [fixedPct, setFixedPct] = useState(initial?.fixedRate != null ? String(initial.fixedRate) : "");
  const [rate, setRate] = useState<string>(initial?.rateIndexName ?? rates[0]?.name ?? "");
  const [probation, setProbation] = useState(initial?.requiresPostProbation ?? true);
  const [warning, setWarning] = useState(initial?.blockedByFinalWarning ?? true);
  const [external, setExternal] = useState(initial?.requiresExternalDeclaration ?? false);
  const [excludes, setExcludes] = useState<string[]>(initial?.excludes ?? []);
  const [copyFrom, setCopyFrom] = useState<string>("none");

  const input: ProductConfigInput = useMemo(() => ({
    name,
    kind: kind as ProductConfigInput["kind"],
    capMethod: capMethod as ProductConfigInput["capMethod"],
    capBasis: capBasis as ProductConfigInput["capBasis"],
    capMultiple: capMethod === "salary_multiple" ? toNum(capMultiple) : null,
    takehomeFactor: capMethod === "takehome_factor" ? (toNum(thPct) === null ? null : toNum(thPct)! / 100) : null,
    takehomeMultiplier: capMethod === "takehome_factor" ? toNum(thMonths) : null,
    maxTenorMonths: toNum(tenor) ?? 0,
    interestApplies: interest,
    rateMode: pricing === "fixed" ? "fixed" : "index",
    rateIndexName: pricing === "index" ? rate || null : null,
    rateMargin: pricing === "index" ? (toNum(margin) ?? 0) : 0,
    fixedRate: pricing === "fixed" ? toNum(fixedPct) : null,
    requiresPostProbation: probation,
    blockedByFinalWarning: warning,
    requiresExternalDeclaration: external,
    excludes,
  }), [name, kind, capMethod, capBasis, capMultiple, thPct, thMonths, tenor, interest, pricing, rate, margin, fixedPct, probation, warning, external, excludes]);

  const liveErrors = validateProductConfig(input, initial?.id) as Record<string, string | undefined>;
  // Show a message once the person has tried to save, or the server rejected a field.
  const err = (k: string) => (submitted ? liveErrors[k] : undefined) ?? serverFieldErrors[k];

  const dirty = () => { setSaved(false); setServerError(null); setServerFieldErrors({}); };
  const disabled = !canEdit || pending;

  function save() {
    setSubmitted(true);
    setServerError(null);
    setServerFieldErrors({});
    if (Object.keys(liveErrors).length) return;
    startTransition(async () => {
      const res = initial
        ? await updateProductAction(initial.id, input)
        : await createProductAction(input, copyFrom === "none" ? null : copyFrom);
      if (!res.ok) { setServerError(res.error); setServerFieldErrors(res.fieldErrors ?? {}); return; }
      if (initial) { setSaved(true); router.refresh(); }
      else router.push(`/settings/products/${res.id}?created=1`);
    });
  }

  function toggleActive() {
    if (!initial) return;
    startTransition(async () => {
      const res = await setProductActiveAction(initial.id, !initial.active);
      if (!res.ok) { setServerError(res.error); return; }
      router.refresh();
    });
  }

  // Live "what would this charge today", from the same function the server uses.
  const preview = useMemo(() => {
    if (pricing === "none") return null;
    const idx = rates.find((r) => r.name === rate)?.currentValue ?? null;
    const m = toNum(margin) ?? 0;
    return {
      label: describePricing({ interestApplies: true, rateMode: pricing, fixedRate: toNum(fixedPct), rateMargin: m, indexName: rate || null }),
      rate: effectiveAnnualRate({ interestApplies: true, rateMode: pricing, fixedRate: toNum(fixedPct), rateMargin: m, indexValue: idx }),
    };
  }, [pricing, rates, rate, margin, fixedPct]);

  const rateOptions = rates.map((r) => ({ value: r.name, label: r.name, hint: `${r.currentValue}% now` }));

  return (
    <div className="space-y-5">
      {!canEdit ? (
        <div className="rounded-xl bg-awaiting-wash px-4 py-2.5 text-sm text-ink">
          View only. Loan products are changed by the CFO or an administrator.
        </div>
      ) : null}

      {initial && !initial.active ? (
        <div className="rounded-xl bg-awaiting-wash px-4 py-2.5 text-sm text-ink">
          This product is switched off, so staff can&apos;t apply for it. Applications already in review carry on.
        </div>
      ) : null}

      <DashboardCard title="Basics">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Product name" error={err("name")}>
            <input value={name} onChange={(e) => { setName(e.target.value); dirty(); }} disabled={disabled}
              placeholder="e.g. Development Loan" className={inputCls} />
          </Field>
          <Field label="Type" hint="Groups the product in lists and reports." error={err("kind")}>
            <OptionSelect ariaLabel="Product type" value={kind} onValueChange={(v) => { setKind(v); dirty(); }}
              options={KIND_OPTIONS} disabled={disabled} />
          </Field>
          <Field label="Longest repayment period (months)" error={err("maxTenorMonths")}>
            <input value={tenor} onChange={(e) => { setTenor(e.target.value); dirty(); }} disabled={disabled}
              inputMode="numeric" className={inputCls} />
          </Field>
        </div>
      </DashboardCard>

      <DashboardCard title="How much can staff borrow?">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Limit is based on">
            <OptionSelect ariaLabel="How the limit is worked out" value={capMethod}
              onValueChange={(v) => { setCapMethod(v); dirty(); }} disabled={disabled}
              options={[
                { value: "salary_multiple", label: "A multiple of salary" },
                { value: "takehome_factor", label: "A share of take-home pay" },
              ]} />
          </Field>

          {capMethod === "salary_multiple" ? (
            <>
              <Field label="Salary measured as">
                <OptionSelect ariaLabel="Salary basis" value={capBasis}
                  onValueChange={(v) => { setCapBasis(v); dirty(); }} disabled={disabled}
                  options={[{ value: "gross", label: "Gross salary" }, { value: "net", label: "Net (take-home) salary" }]} />
              </Field>
              <Field label="Times salary" hint="e.g. 3 means up to three months' salary." error={err("capMultiple")}>
                <input value={capMultiple} onChange={(e) => { setCapMultiple(e.target.value); dirty(); }}
                  disabled={disabled} inputMode="decimal" className={inputCls} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Share of take-home pay (%)" hint="After existing deductions. e.g. 40." error={err("takehomeFactor")}>
                <input value={thPct} onChange={(e) => { setThPct(e.target.value); dirty(); }}
                  disabled={disabled} inputMode="decimal" className={inputCls} />
              </Field>
              <Field label="Over this many months" hint="e.g. 30: the limit is that share × 30 months." error={err("takehomeMultiplier")}>
                <input value={thMonths} onChange={(e) => { setThMonths(e.target.value); dirty(); }}
                  disabled={disabled} inputMode="decimal" className={inputCls} />
              </Field>
            </>
          )}
        </div>
      </DashboardCard>

      <DashboardCard title="Interest">
        <div className="space-y-4">
          <Field label="How is interest charged?" error={err("rateMode")}>
            <OptionSelect ariaLabel="How interest is charged" value={pricing}
              onValueChange={(v) => { setPricing(v as "none" | "index" | "fixed"); dirty(); }} disabled={disabled}
              options={[
                { value: "none", label: "No interest", hint: "e.g. a plain salary advance" },
                { value: "index", label: "Follows a rate", hint: "e.g. the BoU CBR, plus a margin" },
                { value: "fixed", label: "A fixed rate", hint: "the same whatever the market does" },
              ]} />
          </Field>

          {pricing === "index" ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Follows" error={err("rateIndexName")}>
                {rates.length === 0 ? (
                  <p className="rounded-xl bg-rejected-wash px-3 py-2 text-xs text-rejected">
                    No rates are set up yet. <Link href="/settings" className="font-medium underline">Set one in Settings → Rate indices</Link> first.
                  </p>
                ) : (
                  <OptionSelect ariaLabel="Rate this product follows" value={rate}
                    onValueChange={(v) => { setRate(v); dirty(); }} disabled={disabled} options={rateOptions} />
                )}
              </Field>
              <Field label="Margin (percentage points)" error={err("rateMargin")}
                hint="Added to the rate. Leave empty for none; use a minus for a staff discount, e.g. -3.">
                <input value={margin} onChange={(e) => { setMargin(e.target.value); dirty(); }} disabled={disabled}
                  inputMode="decimal" placeholder="0" className={inputCls} />
              </Field>
            </div>
          ) : null}

          {pricing === "fixed" ? (
            <Field label="Interest rate per year (%)" error={err("fixedRate")}
              hint="Doesn't change when market rates do.">
              <input value={fixedPct} onChange={(e) => { setFixedPct(e.target.value); dirty(); }} disabled={disabled}
                inputMode="decimal" placeholder="e.g. 12" className={inputCls + " sm:max-w-xs"} />
            </Field>
          ) : null}

          {preview && preview.rate !== null ? (
            <p className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
              <span className="font-semibold">{preview.label}</span>
              — an application made today would be quoted <span className="font-semibold">{+(preview.rate * 100).toFixed(3)}% a year</span>.
              Staff see the rate before they apply, and it stays fixed for that loan once approved.
            </p>
          ) : null}
        </div>
      </DashboardCard>

      <DashboardCard title="Who can apply?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Check_ checked={probation} onChange={(v) => { setProbation(v); dirty(); }} disabled={disabled}
            title="Only after probation" desc="Staff still on probation can't apply." />
          <Check_ checked={warning} onChange={(v) => { setWarning(v); dirty(); }} disabled={disabled}
            title="Not while on a final warning" desc="Blocks staff with a final warning letter." />
          <Check_ checked={external} onChange={(v) => { setExternal(v); dirty(); }} disabled={disabled}
            title="Ask about loans from other lenders" desc="The applicant declares outside borrowing, which reduces their limit." />
        </div>

        {otherProducts.length > 0 ? (
          <div className="mt-5">
            <div className="mb-1.5 text-sm font-medium text-ink">Can&apos;t be held at the same time as</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {otherProducts.map((p) => (
                <Check_ key={p.id} checked={excludes.includes(p.id)} disabled={disabled}
                  onChange={(v) => { setExcludes((cur) => v ? [...cur, p.id] : cur.filter((x) => x !== p.id)); dirty(); }}
                  title={p.name} desc="Staff with this loan can't take out the other." />
              ))}
            </div>
          </div>
        ) : null}
      </DashboardCard>

      {!initial && canEdit && otherProducts.length > 0 ? (
        <DashboardCard title="Who approves it?">
          <Field label="Start from" hint="You can change the approvers afterwards under Approval routing. Without one, nobody can approve this product's applications.">
            <OptionSelect ariaLabel="Copy approval routing from" value={copyFrom} onValueChange={setCopyFrom}
              options={[{ value: "none", label: "Set up later" }, ...otherProducts.map((p) => ({ value: p.id, label: `Same as ${p.name}` }))]} />
          </Field>
        </DashboardCard>
      ) : null}

      {initial && canEdit ? (
        <p className="text-xs text-ink-soft">
          Changes apply to <strong>new</strong> applications only. Applications already submitted keep the
          terms they were quoted, and running loans are never changed
          {initial.inReview > 0 ? ` (${initial.inReview} in review now)` : ""}.
        </p>
      ) : null}

      {serverError ? (
        <div className="flex items-start gap-2 rounded-xl bg-rejected-wash px-3 py-2 text-sm text-rejected">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {serverError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <button onClick={save} disabled={pending}
            className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full text-sm">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
            {pending ? "Saving…" : saved ? "Saved" : initial ? "Save changes" : "Create product"}
          </button>
        ) : null}
        <Link href="/settings/products" className="text-sm font-medium text-ink-soft hover:text-ink">
          {canEdit ? "Cancel" : "Back to products"}
        </Link>
        {initial && canEdit ? (
          <button onClick={toggleActive} disabled={pending}
            className={"ml-auto text-sm font-medium hover:underline " + (initial.active ? "text-rejected" : "text-brand-700")}>
            {initial.active ? "Switch off" : "Switch back on"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
