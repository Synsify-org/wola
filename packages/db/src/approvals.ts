// packages/db/src/approvals.ts
// Reads approval pipelines (tenant config) and records decisions. All logic
// lives in @wola/engine; this file only loads data and writes outcomes.
import {
  resolvePipeline, route, canAct, validateDecision,
  type Pipeline, type Stage, type ApprovalRecord, type Applicant,
  type Actor, type Decision, type RoutingResult,
} from "@wola/engine";
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

/** Load an application plus everything the routing engine needs. */
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

/** Load every pipeline configured for this product (default + role-specific). */
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

/** Approvals recorded so far on an application. */
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

/** Where does this application stand right now? */
export async function routeApplication(
  tx: Tx, applicationId: string,
): Promise<{ app: ApplicationForApproval; pipeline: Pipeline; routing: RoutingResult } | null> {
  const app = await loadApplication(tx, applicationId);
  if (!app) return null;
  const pipelines = await loadPipelines(tx, app.loanProductId);
  const pipeline = resolvePipeline(pipelines, app.applicantRole);
  if (!pipeline) return null;

  // An employee with NO department head cannot clear a dept_head stage, so
  // that stage is dropped for them (same as the self-approval rule). The CEO
  // naturally has no head — this is why their pipeline has no dept_head stage.
  const usable: Pipeline = app.departmentHeadId
    ? pipeline
    : { ...pipeline, stages: pipeline.stages.filter((s) => s.approverRole !== "dept_head") };

  const approvals = await loadApprovals(tx, applicationId);
  return { app, pipeline: usable, routing: route(usable, app.applicantRole, approvals) };
}

/** Record a decision. Returns the NEW routing state, or an error. */
export async function decide(
  tx: Tx,
  args: {
    tenantId: string;
    applicationId: string;
    actor: Actor;
    decision: Decision;
    comment?: string | null;
  },
): Promise<{ ok: true; routing: RoutingResult } | { ok: false; error: string }> {
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

  // AUTHORIZATION: only the right person, at the right stage, may decide.
  if (!canAct(routing.currentStage, args.actor, applicant)) {
    return { ok: false, error: "You are not the approver for this stage." };
  }

  await tx`
    INSERT INTO approvals
      (tenant_id, application_id, stage_id, approver_user_id, decision, comment, decided_at)
    VALUES
      (${args.tenantId}, ${args.applicationId}, ${routing.currentStage.id},
       ${args.actor.userId}, ${args.decision}, ${args.comment ?? null}, now())`;

  const after = route(
    pipeline,
    app.applicantRole,
    await loadApprovals(tx, args.applicationId),
  );

  // Reflect terminal states on the application itself.
  if (after.state === "rejected") {
    await tx`UPDATE loan_applications SET status='rejected', updated_at=now()
             WHERE id=${args.applicationId}`;
  } else if (after.state === "approved") {
    await tx`UPDATE loan_applications SET status='approved', updated_at=now()
             WHERE id=${args.applicationId}`;
  } else {
    await tx`UPDATE loan_applications SET status='in_review', updated_at=now()
             WHERE id=${args.applicationId}`;
  }

  return { ok: true, routing: after };
}

/** Applications awaiting THIS actor's decision — their approval inbox. */
export async function inboxFor(
  tx: Tx, actor: Actor,
): Promise<Array<ApplicationForApproval & { stageRole: string; employeeName: string; productName: string }>> {
  const rows = await tx`
    SELECT la.id
    FROM loan_applications la
    WHERE la.status IN ('submitted','in_review')`;

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