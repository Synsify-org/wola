
// packages/db/src/approvals.ts
// Reads approval pipelines (tenant config) and records decisions. Routing logic
// lives in @wola/engine; this file loads data and writes outcomes.
//
// FINAL APPROVAL MATERIALISES THE LOAN, here — not in the UI action. The rate
// is frozen from tenant config (rate_indices), never a literal. loan creation
// lives in createLoanFromApplication so there is ONE path, not two.
import {
  resolvePipeline, route, canAct, validateDecision, effectiveAnnualRate,
  type Pipeline, type Stage, type ApprovalRecord, type Applicant,
  type Actor, type Decision, type RoutingResult,
} from "@wola/engine";
import { createLoanFromApplication } from "./loans";
import { notifyApplicationDecision } from "./notifications";
import type { Tx } from "./client";

export interface ApplicationForApproval {
  applicationId: string;
  employeeId: string;
  applicantUserId: string | null;
  applicantRole: string;
  departmentHeadId: string | null;
  loanProductId: string;
  amount: number;
  tenorMonths: number;
  status: string;
}

export async function loadApplication(
  tx: Tx, applicationId: string,
): Promise<ApplicationForApproval | null> {
  const [row] = await tx`
    SELECT la.id AS application_id, la.loan_product_id, la.amount,
           la.tenor_months, la.status,
           e.id AS employee_id, e.user_id AS applicant_user_id,
           e.department_head_id,
           COALESCE(m.role, 'employee') AS applicant_role
    FROM loan_applications la
    JOIN employees e ON e.id = la.employee_id
    LEFT JOIN memberships m ON m.user_id = e.user_id AND m.tenant_id = la.tenant_id
    WHERE la.id = ${applicationId}`;
  if (!row) return null;
  return {
    applicationId: row.application_id as string,
    employeeId: row.employee_id as string,
    applicantUserId: row.applicant_user_id as string | null,
    applicantRole: row.applicant_role as string,
    departmentHeadId: row.department_head_id as string | null,
    loanProductId: row.loan_product_id as string,
    amount: Number(row.amount),
    tenorMonths: row.tenor_months as number,
    status: row.status as string,
  };
}

/** The approval chains for a product. With `forApplicationId`, the chains as
 *  they stood when that application was submitted (stages created by then and
 *  not yet retired) — so a decided application keeps the chain that decided it
 *  after routing is edited. Compared in SQL against the application's own
 *  timestamp (a JS Date would truncate microseconds). Without it, the live
 *  chains. Retiring a stage (see routing-admin.ts) never deletes
 *  it: approvals still point at it. */
export async function loadPipelines(
  tx: Tx, loanProductId: string, forApplicationId?: string,
): Promise<Pipeline[]> {
  const rows = await tx`
    SELECT p.id AS pipeline_id, p.applies_to,
           s.id AS stage_id, s.position, s.approver_role,
           s.sla_hours, s.allow_delegation
    FROM approval_pipelines p
    JOIN approval_stages s ON s.pipeline_id = p.id
    WHERE p.loan_product_id = ${loanProductId}
      AND ${forApplicationId
        ? tx`s.created_at <= (SELECT created_at FROM loan_applications WHERE id = ${forApplicationId})
             AND (s.retired_at IS NULL
                  OR s.retired_at > (SELECT created_at FROM loan_applications WHERE id = ${forApplicationId}))`
        : tx`s.retired_at IS NULL`}
    ORDER BY p.applies_to, s.position`;
  const byPipeline = new Map<string, Pipeline>();
  for (const r of rows) {
    const pid = r.pipeline_id as string;
    if (!byPipeline.has(pid)) {
      byPipeline.set(pid, { id: pid, appliesTo: r.applies_to as string, stages: [] });
    }
    byPipeline.get(pid)!.stages.push({
      id: r.stage_id as string,
      position: r.position as number,
      approverRole: r.approver_role as Stage["approverRole"],
      slaHours: r.sla_hours as number | null,
      allowDelegation: r.allow_delegation as boolean,
    });
  }
  return [...byPipeline.values()];
}

export async function loadApprovals(tx: Tx, applicationId: string): Promise<ApprovalRecord[]> {
  const rows = await tx`
    SELECT stage_id, decision, comment FROM approvals
    WHERE application_id = ${applicationId}
    ORDER BY created_at`;
  return rows.map((r) => ({
    stageId: r.stage_id as string,
    decision: r.decision as Decision,
    comment: r.comment as string | null,
  }));
}

export async function routeApplication(
  tx: Tx, applicationId: string,
): Promise<{ app: ApplicationForApproval; pipeline: Pipeline; routing: RoutingResult } | null> {
  const app = await loadApplication(tx, applicationId);
  if (!app) return null;
  const pipelines = await loadPipelines(tx, app.loanProductId, applicationId);
  const pipeline = resolvePipeline(pipelines, app.applicantRole);
  if (!pipeline) return null;
  const usable: Pipeline = app.departmentHeadId
    ? pipeline
    : { ...pipeline, stages: pipeline.stages.filter((s) => s.approverRole !== "dept_head") };
  const approvals = await loadApprovals(tx, applicationId);
  return { app, pipeline: usable, routing: route(usable, app.applicantRole, approvals) };
}

export type ResolvedRate =
  | { ok: true; rate: number; mode: "fixed" | "index_plus_margin" }
  | { ok: false; error: string };

// The rate a product charges RIGHT NOW. interest_applies=false -> 0; else the
// product's rate_index current value as a FRACTION (9.500 -> 0.095). Interest
// applies but no index configured -> refuse, never guess a rate.
//
// Called when an application is SUBMITTED, and the result is stored on it
// (eligibility_snapshot.annualRate): the applicant is quoted that rate and
// keeps it, whatever the index does while the application is in review. Also
// the fallback at final approval for applications submitted before quoting
// existed.
export async function resolveRate(
  tx: Tx, loanProductId: string,
): Promise<ResolvedRate> {
  const [p] = await tx`
    SELECT lp.interest_applies, lp.name, lp.rate_mode, lp.rate_margin, lp.fixed_rate,
           ri.current_value
    FROM loan_products lp
    LEFT JOIN rate_indices ri ON ri.id = lp.rate_index_id
    WHERE lp.id = ${loanProductId}`;
  if (!p) return { ok: false, error: "Loan product not found." };
  const rate = effectiveAnnualRate({
    interestApplies: p.interest_applies as boolean,
    rateMode: p.rate_mode as "index" | "fixed",
    fixedRate: p.fixed_rate === null ? null : Number(p.fixed_rate),
    rateMargin: Number(p.rate_margin),
    indexValue: p.current_value === null ? null : Number(p.current_value),
  });
  if (rate === null) {
    return {
      ok: false,
      error: p.rate_mode === "fixed"
        ? `Product "${p.name}" is fixed-rate but has no rate set.`
        : `Product "${p.name}" applies interest but has no rate index configured.`,
    };
  }
  // "fixed" = the rate does not move with an index (interest-free included).
  return { ok: true, rate, mode: !p.interest_applies || p.rate_mode === "fixed" ? "fixed" : "index_plus_margin" };
}

/** The rate quoted to the applicant at submission, if this application has
 *  one (null for applications submitted before quoting existed). */
async function quotedRate(tx: Tx, applicationId: string): Promise<ResolvedRate | null> {
  const [row] = await tx`
    SELECT eligibility_snapshot->>'annualRate' AS rate,
           eligibility_snapshot->>'rateMode' AS mode
    FROM loan_applications WHERE id = ${applicationId}`;
  if (!row || row.rate === null || row.rate === undefined) return null;
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return { ok: true, rate, mode: row.mode === "fixed" ? "fixed" : "index_plus_margin" };
}

export async function decide(
  tx: Tx,
  args: {
    tenantId: string;
    applicationId: string;
    actor: Actor;
    decision: Decision;
    comment?: string | null;
    startDate?: Date;
  },
): Promise<{ ok: true; routing: RoutingResult; loanId?: string } | { ok: false; error: string }> {
  const valid = validateDecision(args.decision, args.comment);
  if (!valid.ok) return { ok: false, error: valid.error };

  const loaded = await routeApplication(tx, args.applicationId);
  if (!loaded) return { ok: false, error: "Application not found." };
  const { app, pipeline, routing } = loaded;

  if (routing.state !== "pending" || !routing.currentStage) {
    return { ok: false, error: `Application is already ${routing.state}.` };
  }

  const applicant: Applicant = {
    employeeId: app.employeeId,
    role: app.applicantRole,
    departmentHeadId: app.departmentHeadId,
  };
  if (!canAct(routing.currentStage, args.actor, applicant)) {
    return { ok: false, error: "You are not the approver for this stage." };
  }

  const currentStageId = routing.currentStage.id;
  const wouldComplete =
    args.decision === "approved" &&
    routing.stages.filter((s) => s.id !== currentStageId).length === routing.completed.length;
  if (wouldComplete && !args.startDate) {
    return { ok: false, error: "A disbursement date is required for the final approval." };
  }

  // Every refusal must happen BEFORE the approval row is written. Returning
  // { ok: false } does not roll back the caller's transaction — a refusal
  // after the INSERT used to commit a final approval with no loan, leaving
  // the application routed "approved" but stuck at in_review forever.
  let rate: { rate: number; mode: "fixed" | "index_plus_margin" } | null = null;
  if (wouldComplete) {
    // The rate the applicant was quoted at submission wins; only applications
    // that predate quoting fall back to the product's rate today.
    const resolved = (await quotedRate(tx, args.applicationId)) ?? (await resolveRate(tx, app.loanProductId));
    if (!resolved.ok) return { ok: false, error: resolved.error };
    rate = resolved;
  }

  try {
    await tx`
      INSERT INTO approvals
        (tenant_id, application_id, stage_id, approver_user_id, decision, comment, decided_at)
      VALUES
        (${args.tenantId}, ${args.applicationId}, ${currentStageId},
         ${args.actor.userId}, ${args.decision}, ${args.comment ?? null}, now())`;
  } catch (e) {
    // 23505 = unique_violation on approvals_one_decision_per_stage (0015) —
    // a second concurrent decision for the same stage (double-click, or a
    // retry during a slow page load) lost the race. The first one already
    // went through; tell the actor rather than surfacing a raw DB error.
    if ((e as { code?: string }).code === "23505") {
      return { ok: false, error: "This stage was already decided (possibly by a duplicate click) — refresh to see the current state." };
    }
    throw e;
  }

  const after = route(pipeline, app.applicantRole, await loadApprovals(tx, args.applicationId));

  if (after.state === "rejected") {
    await tx`UPDATE loan_applications SET status='rejected', updated_at=now() WHERE id=${args.applicationId}`;
    await notifyApplicationDecision(tx, args.tenantId, args.applicationId, {
      kind: "rejected", reason: args.comment ?? "",
    });
    return { ok: true, routing: after };
  }

  if (after.state === "approved") {
    // Past the INSERT, failures must THROW so the whole transaction rolls
    // back. wouldComplete and route() agree by construction; this guards a
    // future divergence rather than committing a loan-less approval.
    if (!rate) throw new Error("Final approval reached without a resolved rate.");

    await tx`UPDATE loan_applications SET status='approved', updated_at=now() WHERE id=${args.applicationId}`;

    const loan = await createLoanFromApplication(tx, {
      tenantId: args.tenantId,
      applicationId: args.applicationId,
      startDate: args.startDate!,
      annualRate: rate.rate,
      rateMode: rate.mode,
    });
    await notifyApplicationDecision(tx, args.tenantId, args.applicationId, { kind: "approved" });
    return { ok: true, routing: after, loanId: loan.loanId };
  }

  await tx`UPDATE loan_applications SET status='in_review', updated_at=now() WHERE id=${args.applicationId}`;
  await notifyApplicationDecision(tx, args.tenantId, args.applicationId, {
    kind: "advanced", nextStageRole: after.currentStage!.approverRole,
  });
  return { ok: true, routing: after };
}

/** What is waiting for THIS person: the open applications whose current stage they may act on.
 *
 *  Three queries however many applications are open (it used to run three PER application, so
 *  a busy tenant with 50 pending made the dashboard cost 150+ queries):
 *    1. every open application with the facts routing needs and the fields the inbox shows;
 *    2. each application's approval chain AS IT STOOD when it was submitted (stages created by
 *       then and not yet retired, compared in SQL: a JS Date would truncate microseconds);
 *    3. every decision made so far.
 *  Routing itself is unchanged: the same resolvePipeline / route / canAct, now fed from memory. */
export async function inboxFor(tx: Tx, tenantId: string, actor: Actor) {
  return openApplications(tx, tenantId, (stage, applicant) => canAct(stage, actor, applicant));
}

export interface StageWaiting {
  stageRole: string;
  count: number;
  amount: number;
  /** Hours the longest-waiting application has sat at this stage. */
  oldestHours: number;
  /** Applications past the time limit the administrator set for the stage. */
  overdue: number;
}

/** Every open application grouped by the stage it is waiting at, for oversight (the CEO's
 *  overview): where applications pile up, and for how long. Same routing as inboxFor. */
export async function openApplicationsByStage(tx: Tx, tenantId: string, now = Date.now()): Promise<StageWaiting[]> {
  const open = await openApplications(tx, tenantId, () => true);
  const by = new Map<string, StageWaiting>();
  for (const a of open) {
    const s = by.get(a.stageRole) ?? { stageRole: a.stageRole, count: 0, amount: 0, oldestHours: 0, overdue: 0 };
    const hours = Math.max(0, (now - new Date(a.waitingSince).getTime()) / 3_600_000);
    s.count++;
    s.amount += a.amount;
    s.oldestHours = Math.max(s.oldestHours, hours);
    if (a.slaHours != null && hours > a.slaHours) s.overdue++;
    by.set(a.stageRole, s);
  }
  return [...by.values()].sort((x, y) => y.count - x.count || y.oldestHours - x.oldestHours);
}

async function openApplications(
  tx: Tx, tenantId: string, keep: (stage: Stage, applicant: Applicant) => boolean,
) {
  const apps = await tx`
    SELECT la.id AS application_id, la.loan_product_id, la.amount, la.tenor_months, la.status,
           e.id AS employee_id, e.user_id AS applicant_user_id, e.department_head_id, e.full_name,
           lp.name AS product_name, COALESCE(m.role, 'employee') AS applicant_role,
           COALESCE((SELECT max(a.decided_at) FROM approvals a
                     WHERE a.application_id = la.id AND a.decision = 'approved'), la.created_at) AS waiting_since
    FROM loan_applications la
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    LEFT JOIN memberships m ON m.user_id = e.user_id AND m.tenant_id = la.tenant_id
    WHERE la.tenant_id = ${tenantId} AND la.status IN ('submitted', 'in_review')
    ORDER BY la.created_at`;
  if (apps.length === 0) return [];
  const ids = apps.map((r) => r.application_id as string);

  const stageRows = await tx`
    SELECT la.id AS application_id, p.id AS pipeline_id, p.applies_to,
           s.id AS stage_id, s.position, s.approver_role, s.sla_hours, s.allow_delegation
    FROM loan_applications la
    JOIN approval_pipelines p ON p.loan_product_id = la.loan_product_id
    JOIN approval_stages s ON s.pipeline_id = p.id
    WHERE la.id = ANY(${ids}::uuid[])
      AND s.created_at <= la.created_at
      AND (s.retired_at IS NULL OR s.retired_at > la.created_at)
    ORDER BY la.id, p.applies_to, s.position`;
  const pipelinesBy = new Map<string, Map<string, Pipeline>>();
  for (const r of stageRows) {
    const appId = r.application_id as string;
    const byPipeline = pipelinesBy.get(appId) ?? pipelinesBy.set(appId, new Map()).get(appId)!;
    const pid = r.pipeline_id as string;
    if (!byPipeline.has(pid)) byPipeline.set(pid, { id: pid, appliesTo: r.applies_to as string, stages: [] });
    byPipeline.get(pid)!.stages.push({
      id: r.stage_id as string,
      position: r.position as number,
      approverRole: r.approver_role as Stage["approverRole"],
      slaHours: r.sla_hours as number | null,
      allowDelegation: r.allow_delegation as boolean,
    });
  }

  const approvalRows = await tx`
    SELECT application_id, stage_id, decision, comment FROM approvals
    WHERE application_id = ANY(${ids}::uuid[]) ORDER BY created_at`;
  const approvalsBy = new Map<string, ApprovalRecord[]>();
  for (const r of approvalRows) {
    const k = r.application_id as string;
    (approvalsBy.get(k) ?? approvalsBy.set(k, []).get(k)!).push({
      stageId: r.stage_id as string, decision: r.decision as Decision, comment: r.comment as string | null,
    });
  }

  const out = [];
  for (const r of apps) {
    const appId = r.application_id as string;
    const app: ApplicationForApproval = {
      applicationId: appId,
      employeeId: r.employee_id as string,
      applicantUserId: r.applicant_user_id as string | null,
      applicantRole: r.applicant_role as string,
      departmentHeadId: r.department_head_id as string | null,
      loanProductId: r.loan_product_id as string,
      amount: Number(r.amount),
      tenorMonths: r.tenor_months as number,
      status: r.status as string,
    };
    const pipeline = resolvePipeline([...(pipelinesBy.get(appId)?.values() ?? [])], app.applicantRole);
    if (!pipeline) continue;
    const usable: Pipeline = app.departmentHeadId
      ? pipeline
      : { ...pipeline, stages: pipeline.stages.filter((st) => st.approverRole !== "dept_head") };
    const routing = route(usable, app.applicantRole, approvalsBy.get(appId) ?? []);
    if (routing.state !== "pending" || !routing.currentStage) continue;
    const applicant: Applicant = { employeeId: app.employeeId, role: app.applicantRole, departmentHeadId: app.departmentHeadId };
    if (!keep(routing.currentStage, applicant)) continue;
    out.push({
      ...app,
      stageRole: routing.currentStage.approverRole,
      employeeName: r.full_name as string,
      productName: r.product_name as string,
      /** When it reached this approver (the previous approval, or submission),
       *  and the time limit the admin set for this stage (null = none). */
      waitingSince: new Date(r.waiting_since as string).toISOString(),
      slaHours: routing.currentStage.slaHours,
    });
  }
  return out;
}
