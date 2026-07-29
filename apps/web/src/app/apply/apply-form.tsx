"use client";
import { useState, useMemo } from "react";
import {
  assessEligibility,
  type ProductRules,
  type EmployeeFinancials,
} from "@wola/engine";
import {
  Check,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Car,
  Wallet,
  TrendingUp,
  Info,
  AlertCircle,
  ShieldCheck,
  Clock,
  Receipt,
  X,
} from "lucide-react";

type Identity = {
  fullName: string;
  employeeNo: string;
  title: string | null;
  department: string | null;
  departmentHead: string | null;
};

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();
const DOT = " \u00B7 ";

const STEPS = [
  { n: 1, title: "Loan type",     desc: "Choose what you need",       bar: "bg-brand",        text: "text-brand",        border: "border-brand",        soft: "bg-brand-50" },
  { n: 2, title: "Amount & term", desc: "How much and how long",      bar: "bg-info-500",     text: "text-info-700",     border: "border-info-500",     soft: "bg-info-50" },
  { n: 3, title: "Review & submit", desc: "Confirm your request",      bar: "bg-warning-500",  text: "text-warning-600",  border: "border-warning-500",  soft: "bg-warning-50" },
];

function ProductIcon({ name, className }: { name: string; className?: string }) {
  const n = name.toLowerCase();
  let Icon = Banknote;
  if (n.includes("car")) Icon = Car;
  else if (n.includes("advance") || n.includes("salary")) Icon = Wallet;
  else if (n.includes("development") || n.includes("dev")) Icon = TrendingUp;
  return <Icon className={className} />;
}

export default function ApplyForm({
  products,
  employee,
  identity,
}: {
  products: ProductRules[];
  employee: EmployeeFinancials;
  identity: Identity;
}) {
  const [step, setStep] = useState(0);
  const [productId, setProductId] = useState(products[0]?.productId ?? "");
  const [external, setExternal] = useState(0);
  const [amount, setAmount] = useState(0);
  const [tenor, setTenor] = useState(1);

  const rules = products.find((p) => p.productId === productId) ?? null;

  const result = useMemo(() => {
    if (!rules) return null;
    return assessEligibility(rules, {
      ...employee,
      externalRecoveries: rules.requiresExternalDeclaration ? external : 0,
    });
  }, [rules, employee, external]);

  // Pre-compute eligibility per product so cards can show "Up to UGX …" upfront
  const productEligibility = useMemo(() => {
    const map = new Map<string, { eligible: boolean; maxAmount: number; maxTenorMonths: number }>();
    for (const p of products) {
      const r = assessEligibility(p, {
        ...employee,
        externalRecoveries: p.requiresExternalDeclaration ? external : 0,
      });
      map.set(p.productId, {
        eligible: r.eligible,
        maxAmount: r.maxAmount,
        maxTenorMonths: r.maxTenorMonths,
      });
    }
    return map;
  }, [products, employee, external]);

  const overCap = !!result && amount > result.maxAmount;
  const canSubmit = !!result && result.eligible && amount > 0 && !overCap;
  const monthly = amount > 0 && tenor > 0 ? amount / tenor : 0;
  const selectedProduct = products.find((p) => p.productId === productId);

  const tenorOptions = useMemo(() => {
    const max = result?.maxTenorMonths ?? rules?.maxTenorMonths ?? 1;
    const base = [1, 3, 6, 12, 18, 24, 36, 48, 60];
    const opts = base.filter((m) => m <= max);
    if (!opts.includes(max)) opts.push(max);
    return opts;
  }, [result, rules]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Apply for a loan</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {identity.fullName}{DOT}<span className="num">{identity.employeeNo}</span>
            {identity.title ? DOT + identity.title : ""}
            {identity.department ? DOT + identity.department : ""}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-lg border border-rule bg-surface px-3 py-1.5 text-xs text-ink-soft">
          <ShieldCheck className="h-3.5 w-3.5 text-brand" />
          Live eligibility check
        </div>
      </div>

      {/* Numbered stepper */}
      <ol className="mb-8 flex items-center gap-2 sm:gap-3">
        {STEPS.map((s, i) => {
          const active = i === step;
          const done = i < step;
          const reached = i <= step;
          return (
            <li key={i} className="flex flex-1 items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all " +
                    (done
                      ? s.bar + " border-transparent text-white"
                      : active
                      ? s.border + " " + s.text + " bg-surface"
                      : "border-rule text-ink-faint bg-surface")
                  }
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : s.n}
                </div>
                <div className="hidden min-w-0 sm:block">
                  <div className={"truncate text-sm font-semibold " + (reached ? "text-ink" : "text-ink-faint")}>
                    {s.title}
                  </div>
                  <div className="truncate text-xs text-ink-soft">{s.desc}</div>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="hidden h-px flex-1 bg-rule sm:block" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Two-column layout: form + sticky summary */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* MAIN FORM */}
        <div className="lg:col-span-2">
          <div
            key={step}
            className="rounded-2xl border border-rule bg-surface p-5 shadow-theme-sm sm:p-8 animate-in fade-in slide-in-from-right-4 duration-300"
          >
            {/* ───────── STEP 1 ───────── */}
            {step === 0 ? (
              <div>
                <h2 className="text-lg font-semibold text-ink">Choose a loan type</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Pick the product that fits your need. We&apos;ll check your eligibility instantly.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((p) => {
                    const on = p.productId === productId;
                    const elig = productEligibility.get(p.productId);
                    return (
                      <button
                        key={p.productId}
                        type="button"
                        onClick={() => {
                          setProductId(p.productId);
                          setAmount(0);
                          setTenor(1);
                        }}
                        className={
                          "group relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all active:scale-[0.98] " +
                          (on
                            ? "border-brand bg-brand-50 ring-2 ring-brand-200"
                            : "border-rule bg-surface hover:border-brand-300 hover:-translate-y-0.5 hover:shadow-theme-sm")
                        }
                      >
                        <div className="flex items-start justify-between">
                          <div
                            className={
                              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors " +
                              (on ? "bg-brand text-white" : "bg-brand-50 text-brand")
                            }
                          >
                            <ProductIcon name={p.name} className="h-5 w-5" />
                          </div>
                          {on && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </span>
                          )}
                        </div>

                        <div>
                          <div className="font-semibold leading-tight text-ink">{p.name}</div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span
                              className={
                                "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium " +
                                (p.interestApplies
                                  ? "bg-warning-50 text-warning-700"
                                  : "bg-brand-50 text-brand")
                              }
                            >
                              {p.interestApplies ? "Interest" : "Interest-free"}
                            </span>
                            <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                              up to {p.maxTenorMonths} mo
                            </span>
                          </div>
                        </div>

                        {elig && (
                          <div className="mt-auto border-t border-rule pt-2.5">
                            {elig.eligible ? (
                              <div className="text-[11px] text-ink-soft">
                                Up to{" "}
                                <span className="num font-semibold text-ink">{ugx(elig.maxAmount)}</span>
                              </div>
                            ) : (
                              <div className="text-[11px] font-medium text-rejected">Not eligible</div>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* External declaration */}
                {rules?.requiresExternalDeclaration && (
                  <div className="mt-5 rounded-xl border border-info-200 bg-info-50 p-4">
                    <label htmlFor="ext" className="caps flex items-center gap-1.5 text-info-700">
                      <Info className="h-3.5 w-3.5" /> Declare outside borrowings
                    </label>
                    <p className="mb-2.5 mt-1 text-xs text-info-700">
                      Monthly recovery on any bank or SACCO loan. This reduces what you qualify for.
                    </p>
                    <div className="flex items-center rounded-lg border border-info-200 bg-paper focus-within:ring-2 focus-within:ring-info-500">
                      <span className="pl-3 text-sm font-medium text-ink-soft">UGX</span>
                      <input
                        id="ext"
                        type="number"
                        min={0}
                        value={external || ""}
                        onChange={(e) => setExternal(Number(e.target.value) || 0)}
                        placeholder="0"
                        className="num w-full bg-transparent px-2 py-2.5 text-sm font-semibold text-ink outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* Ineligibility notice */}
                {result && !result.eligible && (
                  <div className="mt-5 rounded-xl border border-error-200 bg-rejected-wash p-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rejected" />
                      <div className="text-sm text-rejected">
                        <div className="font-semibold">You&apos;re not eligible for this loan</div>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {result.reasons.map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    disabled={!result?.eligible}
                    className="btn btn--primary rounded-lg"
                  >
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}

            {/* ───────── STEP 2 ───────── */}
            {step === 1 && result?.eligible && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-ink">How much do you need?</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    You qualify for up to{" "}
                    <span className="num font-semibold text-info-700">{ugx(result.maxAmount)}</span>{" "}
                    on the {selectedProduct?.name}.
                  </p>
                </div>

                <div>
                  <label htmlFor="amt" className="caps">Loan amount</label>
                  <div className="mt-2 flex items-center rounded-xl border border-rule bg-paper focus-within:border-info-500 focus-within:ring-4 focus-within:ring-info-500/10">
                    <span className="pl-4 text-sm font-medium text-ink-soft">UGX</span>
                    <input
                      id="amt"
                      inputMode="numeric"
                      value={amount ? amount.toLocaleString() : ""}
                      onChange={(e) => setAmount(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
                      placeholder="0"
                      className="num w-full bg-transparent px-2 py-4 text-2xl font-bold text-ink outline-none"
                    />
                    {amount > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(0)}
                        aria-label="Clear amount"
                        className="mr-3 flex h-6 w-6 items-center justify-center rounded-full text-ink-faint hover:bg-rule hover:text-ink"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-rule">
                    <div
                      className={
                        "h-full rounded-full transition-all duration-300 " +
                        (overCap ? "bg-rejected" : "bg-info-500")
                      }
                      style={{ width: Math.min(100, (amount / result.maxAmount) * 100) + "%" }}
                    />
                  </div>

                  {overCap ? (
                    <p className="mt-2 flex items-center gap-1 text-xs font-medium text-rejected">
                      <AlertCircle className="h-3.5 w-3.5" /> Above your limit of {ugx(result.maxAmount)}
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[0.25, 0.5, 0.75, 1].map((f) => {
                        const v = Math.round((result.maxAmount * f) / 100000) * 100000;
                        const on = amount === v;
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setAmount(v)}
                            className={
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 " +
                              (on
                                ? "border-brand bg-brand text-white"
                                : "border-rule bg-surface text-ink hover:border-brand-300 hover:bg-brand-50")
                            }
                          >
                            {f === 1 ? "Max" : Math.round(f * 100) + "%"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="caps">Repayment period</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {tenorOptions.map((m) => {
                      const on = tenor === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTenor(m)}
                          className={
                            "rounded-lg border px-3 py-2.5 text-sm font-medium transition-all active:scale-95 " +
                            (on
                              ? "border-brand bg-brand text-white shadow-sm"
                              : "border-rule bg-surface text-ink hover:border-info-500 hover:bg-info-50 hover:text-info-700")
                          }
                        >
                          {m} mo
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setStep(0)} className="btn btn--ghost rounded-lg">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={amount <= 0 || overCap}
                    className="btn btn--primary rounded-lg"
                  >
                    Review <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ───────── STEP 3 ───────── */}
            {step === 2 && result?.eligible && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Review your application</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    Please confirm the details below before submitting.
                  </p>
                </div>

                {/* Hero number */}
                <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
                  <div className="caps text-brand-700">Approx. monthly deduction</div>
                  <div className="num mt-1 text-4xl font-bold text-brand-700">{ugx(monthly)}</div>
                  <div className="mt-1 text-xs text-ink-soft">
                    before interest{DOT}{tenor} months{DOT}{selectedProduct?.name}
                  </div>
                </div>

                {/* Details */}
                <dl className="divide-y divide-rule overflow-hidden rounded-xl border border-rule">
                  {([
                    ["Loan type", selectedProduct?.name ?? "-"],
                    ["Amount requested", ugx(amount)],
                    ["Repayment period", tenor + " months"],
                    ["Applicant", identity.fullName + DOT + identity.employeeNo],
                    identity.department ? ["Department", identity.department] : null,
                    rules?.requiresExternalDeclaration && external > 0
                      ? ["External recoveries", ugx(external) + "/mo"]
                      : null,
                  ].filter(Boolean) as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between bg-surface px-4 py-3">
                      <dt className="text-sm text-ink-soft">{k}</dt>
                      <dd className="num text-sm font-semibold text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>

                <form action="/api/apply" method="post">
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="amount" value={amount} />
                  <input type="hidden" name="tenor" value={tenor} />
                  <input
                    type="hidden"
                    name="externalRecoveries"
                    value={rules?.requiresExternalDeclaration ? external : 0}
                  />
                  <div className="flex justify-between">
                    <button type="button" onClick={() => setStep(1)} className="btn btn--ghost rounded-lg">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                    <button type="submit" disabled={!canSubmit} className="btn btn--primary rounded-lg">
                      Submit application <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* STICKY SUMMARY PANEL */}
        <aside className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-6">
            {/* Eligibility summary */}
            {result && result.eligible ? (
              <div className="rounded-2xl border border-rule bg-surface p-5 shadow-theme-sm">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50">
                    <Check className="h-4 w-4 text-brand" strokeWidth={3} />
                  </span>
                  <div className="caps text-ink-soft">Your eligibility</div>
                </div>
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-ink-soft">Max amount</span>
                    <span className="num text-sm font-bold text-ink">{ugx(result.maxAmount)}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-ink-soft">Max term</span>
                    <span className="num text-sm font-bold text-ink">{result.maxTenorMonths} months</span>
                  </div>
                  {amount > 0 && !overCap && (
                    <>
                      <div className="my-2 border-t border-rule" />
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-ink-soft">You&apos;re requesting</span>
                        <span className="num text-sm font-bold text-info-700">{ugx(amount)}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-ink-soft">Est. monthly</span>
                        <span className="num text-sm font-bold text-info-700">{ugx(monthly)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {/* How it works */}
            <div className="rounded-2xl border border-rule bg-paper p-5">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-ink-soft" />
                <div className="caps text-ink-soft">How it works</div>
              </div>
              <ol className="mt-3 space-y-2 text-xs text-ink-soft">
                <li className="flex gap-2"><span className="font-semibold text-ink">1.</span> Pick a loan product</li>
                <li className="flex gap-2"><span className="font-semibold text-ink">2.</span> Enter amount and term</li>
                <li className="flex gap-2"><span className="font-semibold text-ink">3.</span> Submit for HR approval</li>
              </ol>
            </div>

            {/* Approval chain */}
            {identity.departmentHead ? (
              <div className="rounded-2xl border border-rule bg-surface p-5">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-ink-soft" />
                  <div className="caps text-ink-soft">Approval chain</div>
                </div>
                <div className="mt-3 text-xs text-ink-soft">
                  Routed to{" "}
                  <span className="font-semibold text-ink">{identity.departmentHead}</span>
                  <div className="mt-0.5 text-ink-faint">Department head</div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}