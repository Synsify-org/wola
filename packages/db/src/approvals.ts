
// packages/db/src/approvals.ts
// Reads approval pipelines (tenant config) and records decisions. Routing logic
// lives in @wola/engine; this file loads data and writes outcomes.
//
// FINAL APPROVAL MATERIALISES THE LOAN, here — not in the UI action. The rate
// is frozen from tenant config (rate_indices), never a literal. loan creation
// lives in createLoanFromApplication so there is ONE path, not two.
import {
  resolvePipeline, route, canAct, validateDecision,
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

export async function loadPipelines(tx: Tx, loanProductId: string): Promise<Pipeline[]> {
  const rows = await tx`
    SELECT p.id AS pipeline_id, p.applies_to,
           s.id AS stage_id, s.position, s.approver_role,
           s.sla_hours, s.allow_delegation
    FROM approval_pipelines p
    JOIN approval_stages s ON s.pipeline_id = p.id
    WHERE p.loan_product_id = ${loanProductId}
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
  const pipelines = await loadPipelines(tx, app.loanProductId);
  const pipeline = resolvePipeline(pipelines, app.applicantRole);
  if (!pipeline) return null;
  const usable: Pipeline = app.departmentHeadId
    ? pipeline
    : { ...pipeline, stages: pipeline.stages.filter((s) => s.approverRole !== "dept_head") };
  const approvals = await loadApprovals(tx, applicationId);
  return { app, pipeline: usable, routing: route(usable, app.applicantRole, approvals) };
}

// Freeze the annual rate at approval. interest_applies=false -> 0; else the
// product's rate_index current value as a FRACTION (9.500 -> 0.095). Interest
// applies but no index configured -> refuse, never guess a rate.
async function resolveRate(
  tx: Tx, loanProductId: string,
): Promise<{ ok: true; rate: number; mode: "fixed" | "index_plus_margin" } | { ok: false; error: string }> {
  const [p] = await tx`
    SELECT lp.interest_applies, lp.name, ri.current_value
    FROM loan_products lp
    LEFT JOIN rate_indices ri ON ri.id = lp.rate_index_id
    WHERE lp.id = ${loanProductId}`;
  if (!p) return { ok: false, error: "Loan product not found." };
  if (!p.interest_applies) return { ok: true, rate: 0, mode: "fixed" };
  if (p.current_value === null) {
    return { ok: false, error: `Product "${p.name}" applies interest but has no rate index configured.` };
  }
  return { ok: true, rate: Number(p.current_value) / 100, mode: "index_plus_margin" };
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

  await tx`
    INSERT INTO approvals
      (tenant_id, application_id, stage_id, approver_user_id, decision, comment, decided_at)
    VALUES
      (${args.tenantId}, ${args.applicationId}, ${currentStageId},
       ${args.actor.userId}, ${args.decision}, ${args.comment ?? null}, now())`;

  const after = route(pipeline, app.applicantRole, await loadApprovals(tx, args.applicationId));

  if (after.state === "rejected") {
    await tx`UPDATE loan_applications SET status='rejected', updated_at=now() WHERE id=${args.applicationId}`;
    await notifyApplicationDecision(tx, args.tenantId, args.applicationId, {
      kind: "rejected", reason: args.comment ?? "",
    });
    return { ok: true, routing: after };
  }

  if (after.state === "approved") {
    const rate = await resolveRate(tx, app.loanProductId);
    if (!rate.ok) return { ok: false, error: rate.error };

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

export async function inboxFor(tx: Tx, tenantId: string, actor: Actor) {
  const rows = await tx`
    SELECT la.id FROM loan_applications la
    WHERE la.tenant_id = ${tenantId}
      AND la.status IN ('submitted','in_review')`;
  const out = [];
  for (const r of rows) {
    const loaded = await routeApplication(tx, r.id as string);
    if (!loaded || loaded.routing.state !== "pending" || !loaded.routing.currentStage) continue;
    const applicant: Applicant = {
      employeeId: loaded.app.employeeId,
      role: loaded.app.applicantRole,
      departmentHeadId: loaded.app.departmentHeadId,
    };
    if (!canAct(loaded.routing.currentStage, actor, applicant)) continue;
    const [meta] = await tx`
      SELECT e.full_name, lp.name AS product_name
      FROM loan_applications la
      JOIN employees e ON e.id = la.employee_id
      JOIN loan_products lp ON lp.id = la.loan_product_id
      WHERE la.id = ${r.id}`;
    out.push({
      ...loaded.app,
      stageRole: loaded.routing.currentStage.approverRole,
      employeeName: meta.full_name as string,
      productName: meta.product_name as string,
    });
  }
  return out;
}
