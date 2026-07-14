"use client";
import { useState, useMemo } from "react";
import {
  assessEligibility,
  type ProductRules,
  type EmployeeFinancials,
} from "@wola/engine";

type Identity = {
  fullName: string;
  employeeNo: string;
  title: string | null;
  department: string | null;
  departmentHead: string | null;
};

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

export default function ApplyForm({
  products,
  employee,
  identity,
}: {
  products: ProductRules[];
  employee: EmployeeFinancials;
  identity: Identity;
}) {
  const [productId, setProductId] = useState(products[0]?.productId ?? "");
  const [external, setExternal] = useState(0);
  const [amount, setAmount] = useState(0);
  const [tenor, setTenor] = useState(1);

  const rules = products.find((p) => p.productId === productId) ?? null;

  // Live eligibility, computed from CONFIGURATION. No product is special-cased.
  const result = useMemo(() => {
    if (!rules) return null;
    return assessEligibility(rules, {
      ...employee,
      externalRecoveries: rules.requiresExternalDeclaration ? external : 0,
    });
  }, [rules, employee, external]);

  const step = 100000;
  const canSubmit =
    !!result && result.eligible && amount > 0 && amount <= result.maxAmount;

  return (
    <>
      <h1 className="text-2xl">Apply for a loan</h1>
      <p className="text-ink-soft mt-1 mb-6">
        {identity.fullName} - {identity.employeeNo}
        {identity.title ? " - " + identity.title : ""}
        {identity.department ? " - " + identity.department : ""}
      </p>

      <div className="grid gap-3 mb-6">
        {products.map((p) => {
          const on = p.productId === productId;
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
                on
                  ? "card rounded-xl text-left border-brand ring-1 ring-brand"
                  : "card rounded-xl text-left hover:border-brand"
              }
            >
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-ink-soft mt-1">
                {p.interestApplies ? "Interest applies" : "Interest-free"}
                {" - up to " + p.maxTenorMonths + " months"}
              </div>
            </button>
          );
        })}
      </div>

      {rules?.requiresExternalDeclaration && (
        <div className="card rounded-xl mb-6">
          <label className="block">
            <span className="caps">Declare outside borrowings</span>
            <p className="text-sm text-ink-soft mt-1 mb-3">
              Monthly recovery on any bank or SACCO loan. This reduces what you
              qualify for.
            </p>
            <input
              type="number"
              min={0}
              value={external}
              onChange={(e) => setExternal(Number(e.target.value) || 0)}
              className="field num"
            />
          </label>
        </div>
      )}

      {result && !result.eligible && (
        <div className="notice mb-6">
          {result.reasons.map((r, i) => (
            <div key={i}>{r}</div>
          ))}
        </div>
      )}

      {result && result.eligible && (
        <div className="card rounded-xl mb-6">
          <div className="caps">You qualify for up to</div>
          <div className="num text-2xl font-bold text-approved mt-1">
            {ugx(result.maxAmount)}
          </div>

          <label className="block mt-6">
            <div className="flex justify-between items-baseline">
              <span className="caps">Amount</span>
              <span className="num font-bold">{ugx(amount)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={result.maxAmount}
              step={step}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full mt-2"
            />
          </label>

          <label className="block mt-5">
            <div className="flex justify-between items-baseline">
              <span className="caps">Repayment period</span>
              <span className="num font-bold">{tenor} months</span>
            </div>
            <input
              type="range"
              min={1}
              max={result.maxTenorMonths}
              step={1}
              value={tenor}
              onChange={(e) => setTenor(Number(e.target.value))}
              className="w-full mt-2"
            />
          </label>
        </div>
      )}

      <form action="/api/apply" method="post">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="amount" value={amount} />
        <input type="hidden" name="tenor" value={tenor} />
        <input
          type="hidden"
          name="externalRecoveries"
          value={rules?.requiresExternalDeclaration ? external : 0}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn btn--primary rounded-full"
        >
          Submit application
        </button>
      </form>
    </>
  );
}
