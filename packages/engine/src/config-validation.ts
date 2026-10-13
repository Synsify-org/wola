// packages/engine/src/config-validation.ts
// Pure validation for the two things an administrator configures: a loan
// product's rules and an approval chain. No DB, no UI — the server actions
// call these before writing, and the forms call the same functions to show
// the problem inline, so there is one definition of "valid".
import type { ApproverRole } from "./approval.js";
import type { CapBasis, CapMethod } from "./eligibility.js";
import type { RateMode } from "./pricing.js";

export type ProductKind = "advance" | "term" | "asset";
export const PRODUCT_KINDS: ProductKind[] = ["advance", "term", "asset"];

export interface ProductConfigInput {
  name: string;
  kind: ProductKind;
  capMethod: CapMethod;
  capBasis: CapBasis;
  capMultiple: number | null;
  takehomeFactor: number | null;
  takehomeMultiplier: number | null;
  maxTenorMonths: number;
  interestApplies: boolean;
  /** How interest is priced: follow a rate index (plus margin) or a fixed rate. */
  rateMode: RateMode;
  /** Name of the rate index the product's interest follows (e.g. "BoU CBR"). */
  rateIndexName: string | null;
  /** Percentage points added to the index; may be negative (a discount). */
  rateMargin: number;
  /** Annual percent when rateMode is "fixed". */
  fixedRate: number | null;
  requiresPostProbation: boolean;
  blockedByFinalWarning: boolean;
  requiresExternalDeclaration: boolean;
  /** Ids of products that cannot run at the same time as this one. */
  excludes: string[];
}

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

const finitePositive = (n: number | null): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/** Returns {} when valid, else one message per offending field. */
export function validateProductConfig(
  p: ProductConfigInput,
  selfId?: string,
): FieldErrors<keyof ProductConfigInput> {
  const e: FieldErrors<keyof ProductConfigInput> = {};

  const name = p.name.trim();
  if (name.length < 2) e.name = "Give the product a name (at least 2 characters).";
  else if (name.length > 60) e.name = "Keep the name under 60 characters.";

  if (!PRODUCT_KINDS.includes(p.kind)) e.kind = "Pick a product type.";

  if (p.capMethod === "salary_multiple") {
    if (!finitePositive(p.capMultiple)) e.capMultiple = "Enter how many times salary can be borrowed (e.g. 3).";
    else if (p.capMultiple > 100) e.capMultiple = "That multiple looks too high — check it.";
  } else {
    if (!finitePositive(p.takehomeFactor)) e.takehomeFactor = "Enter the share of take-home pay, as a percentage (e.g. 40).";
    else if (p.takehomeFactor > 1) e.takehomeFactor = "A share of take-home cannot be more than 100%.";
    if (!finitePositive(p.takehomeMultiplier)) e.takehomeMultiplier = "Enter the number of months it is measured over (e.g. 30).";
    else if (p.takehomeMultiplier > 600) e.takehomeMultiplier = "That number of months looks too high — check it.";
  }

  if (!Number.isInteger(p.maxTenorMonths) || p.maxTenorMonths < 1 || p.maxTenorMonths > 360) {
    e.maxTenorMonths = "Enter a longest repayment period between 1 and 360 months.";
  }

  // resolveRate() refuses to guess a rate: an interest-bearing product with no
  // index cannot be finally approved. Catch it at setup, not at the CEO's desk.
  if (p.interestApplies) {
    if (p.rateMode === "fixed") {
      if (!finitePositive(p.fixedRate)) e.fixedRate = "Enter the yearly interest rate, as a percentage (e.g. 12).";
      else if (p.fixedRate > 100) e.fixedRate = "That rate looks too high — check it.";
    } else if (p.rateMode === "index") {
      if (!(p.rateIndexName && p.rateIndexName.trim())) {
        e.rateIndexName = "Choose the rate this product follows, or switch interest off.";
      }
      if (!Number.isFinite(p.rateMargin) || p.rateMargin < -50 || p.rateMargin > 50) {
        e.rateMargin = "Enter the margin as a number between -50 and 50 (e.g. 2, or -3 for a discount).";
      }
    } else {
      e.rateMode = "Choose how the interest rate is set.";
    }
  }

  if (selfId && p.excludes.includes(selfId)) e.excludes = "A product cannot exclude itself.";

  return e;
}

// ---------------------------------------------------------------- access

/** Every role a person can hold in an organisation (the memberships.role
 *  CHECK in migration 0001). Display order = seniority, administrators first. */
export const MEMBERSHIP_ROLES = [
  "org_admin", "ceo", "group_ceo", "coo", "cfo", "hr", "dept_head", "auditor", "employee",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

// ---------------------------------------------------------------- routing

/** Roles an administrator can put on an approval chain. Deliberately omits
 *  org_admin: administration and approval stay separate duties. */
export const ROUTABLE_ROLES: ApproverRole[] = ["dept_head", "hr", "cfo", "coo", "ceo", "group_ceo"];

/** Applicant roles that may have their OWN chain (besides "default"). */
export const EXCEPTION_APPLICANT_ROLES = ["ceo", "cfo", "coo", "hr", "dept_head", "md", "group_ceo"];

export interface StageInput {
  role: string;
  slaHours: number | null;
  allowDelegation: boolean;
}

export const MAX_STAGES = 8;

export function validateStages(
  stages: StageInput[],
  opts: { required: boolean },
): { ok: true } | { ok: false; error: string } {
  if (stages.length === 0) {
    return opts.required
      ? { ok: false, error: "The standard chain needs at least one approval stage." }
      : { ok: true };
  }
  if (stages.length > MAX_STAGES) return { ok: false, error: `A chain can have at most ${MAX_STAGES} stages.` };
  const seen = new Set<string>();
  for (const [i, s] of stages.entries()) {
    if (!(ROUTABLE_ROLES as string[]).includes(s.role)) return { ok: false, error: `Stage ${i + 1}: pick an approver.` };
    if (seen.has(s.role)) return { ok: false, error: "The same approver appears twice in the chain." };
    seen.add(s.role);
    if (s.slaHours !== null && (!Number.isInteger(s.slaHours) || s.slaHours < 1 || s.slaHours > 24 * 90)) {
      return { ok: false, error: `Stage ${i + 1}: the time limit must be a whole number of hours (1 or more).` };
    }
  }
  return { ok: true };
}

/** Same ordered approvers (ignoring SLA / delegation)? Then an edit is a
 *  tweak, not a re-route, and is safe while applications are in review. */
export function sameChain(a: { role: string }[], b: { role: string }[]): boolean {
  return a.length === b.length && a.every((s, i) => s.role === b[i].role);
}
