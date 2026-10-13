// One-line, plain-language descriptions of a product's rules, for the admin
// lists. Mirrors assessEligibility() in the engine.
import type { ProductConfigInput } from "@wola/engine";

export const KIND_LABEL: Record<string, string> = {
  advance: "Advance",
  term: "Term loan",
  asset: "Asset finance",
};

export function limitSummary(p: Pick<ProductConfigInput, "capMethod" | "capBasis" | "capMultiple" | "takehomeFactor" | "takehomeMultiplier">): string {
  if (p.capMethod === "salary_multiple") {
    const basis = p.capBasis === "net" ? "net" : "gross";
    return `Up to ${p.capMultiple ?? "?"}× ${basis} salary`;
  }
  const pct = p.takehomeFactor == null ? "?" : +(p.takehomeFactor * 100).toFixed(2);
  return `${pct}% of take-home × ${p.takehomeMultiplier ?? "?"} months`;
}

export const ROLE_LABEL: Record<string, string> = {
  dept_head: "Department head",
  hr: "HR",
  cfo: "CFO",
  coo: "COO",
  ceo: "CEO",
  group_ceo: "Group CEO",
  md: "MD",
  org_admin: "Administrator",
};

export const roleLabel = (r: string) =>
  ROLE_LABEL[r] ?? r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
