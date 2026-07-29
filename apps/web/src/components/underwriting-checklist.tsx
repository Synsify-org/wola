"use client";
import { Check, X, Minus } from "lucide-react";

const ugx = (n: number) => "UGX " + Math.round(n).toLocaleString();

type Profile = {
  grossSalary: number;
  netSalary: number;
  isPostProbation: boolean;
  onFinalWarning: boolean;
};
type Rules = {
  capMethod: string;
  capBasis: string | null;
  capMultiple: number | null;
  takehomeFactor: number | null;
  takehomeMultiplier: number | null;
  maxTenorMonths: number;
  requiresPostProbation: boolean;
  blockedByFinalWarning: boolean;
  requiresExternalDeclaration: boolean;
};

type Check = {
  label: string;
  state: "pass" | "fail" | "na";
  detail: string;
};

function computeCap(profile: Profile, rules: Rules): number | null {
  if (rules.capMethod === "salary_multiple" && rules.capMultiple != null) {
    const basis = rules.capBasis === "net" ? profile.netSalary : profile.grossSalary;
    return basis * rules.capMultiple;
  }
  if (
    rules.capMethod === "takehome_factor" &&
    rules.takehomeFactor != null &&
    rules.takehomeMultiplier != null
  ) {
    return profile.netSalary * rules.takehomeFactor * rules.takehomeMultiplier;
  }
  return null;
}

export default function UnderwritingChecklist({
  profile,
  rules,
  amount,
  tenorMonths,
  externalDeclared,
}: {
  profile: Profile;
  rules: Rules;
  amount: number;
  tenorMonths: number;
  externalDeclared: boolean;
}) {
  const cap = computeCap(profile, rules);
  const checks: Check[] = [];

  // Probation
  if (rules.requiresPostProbation) {
    checks.push({
      label: "Past probation",
      state: profile.isPostProbation ? "pass" : "fail",
      detail: profile.isPostProbation ? "Confirmed" : "Still on probation",
    });
  }

  // Final warning
  if (rules.blockedByFinalWarning) {
    checks.push({
      label: "No active final warning",
      state: profile.onFinalWarning ? "fail" : "pass",
      detail: profile.onFinalWarning ? "On final warning" : "Clear",
    });
  }

  // Within cap
  if (cap != null) {
    checks.push({
      label: "Within eligibility cap",
      state: amount <= cap ? "pass" : "fail",
      detail: (amount <= cap ? "Cap " : "Exceeds cap ") + ugx(cap),
    });
  }

  // Tenor
  checks.push({
    label: "Tenor within limit",
    state: tenorMonths <= rules.maxTenorMonths ? "pass" : "fail",
    detail: tenorMonths + " of " + rules.maxTenorMonths + " months max",
  });

  // External declaration
  if (rules.requiresExternalDeclaration) {
    checks.push({
      label: "External loans declared",
      state: externalDeclared ? "pass" : "fail",
      detail: externalDeclared ? "Provided" : "Not declared",
    });
  }

  const allPass = checks.every((c) => c.state === "pass");

  return (
    <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="caps">Underwriting checklist</div>
        <span
          className={
            "chip " + (allPass ? "chip--approved" : "chip--awaiting")
          }
        >
          {allPass ? "All clear" : "Needs review"}
        </span>
      </div>
      <ul className="space-y-3">
        {checks.map((c) => {
          const Icon = c.state === "pass" ? Check : c.state === "fail" ? X : Minus;
          const ring =
            c.state === "pass"
              ? "bg-success-100 text-success-700"
              : c.state === "fail"
              ? "bg-error-100 text-error-700"
              : "bg-gray-100 text-gray-500";
          return (
            <li key={c.label} className="flex items-start gap-3">
              <span className={"mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full " + ring}>
                <Icon className="h-3 w-3" strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{c.label}</div>
                <div className="num text-xs text-ink-soft">{c.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
