// packages/engine/src/approval.ts
// Config-driven approval routing. Pure logic — no DB, no UI.
//
// Pipelines and stages are TENANT DATA (approval_pipelines / approval_stages),
// never code. MUA's chain is one configuration; a SACCO with a 2-stage chain
// is another. Never hardcode a customer's approval chain here.
//
// Three rules encoded:
//  1. Pipeline selection: use the pipeline whose `applies_to` matches the
//     applicant's role, else the 'default' pipeline.
//  2. NO SELF-APPROVAL: any stage whose approver_role equals the applicant's
//     role is removed from THEIR pipeline — the decision escalates upward.
//     (MUA's special CEO pipeline is this same rule applied at the top.)
//  3. Rejection terminates the application. A reason is mandatory.

export type ApproverRole =
  | "dept_head" | "hr" | "cfo" | "ceo" | "coo" | "group_ceo" | "org_admin";

export type Decision = "pending" | "approved" | "rejected" | "delegated";

export interface Stage {
  id: string;
  position: number;
  approverRole: ApproverRole;
  slaHours: number | null;
  allowDelegation: boolean;
}

export interface Pipeline {
  id: string;
  appliesTo: string;        // 'default' | a role name
  stages: Stage[];
}

export interface ApprovalRecord {
  stageId: string;
  decision: Decision;
  comment?: string | null;
}

export interface Applicant {
  employeeId: string;
  role: string;                       // membership role
  departmentHeadId: string | null;    // employees.department_head_id
}

export interface Actor {
  userId: string;
  employeeId: string | null;
  role: string;
}

export type ApplicationState = "pending" | "approved" | "rejected";

export interface RoutingResult {
  state: ApplicationState;
  stages: Stage[];              // the EFFECTIVE stages (self-approval removed)
  currentStage: Stage | null;   // null when approved or rejected
  completed: Stage[];
  rejectedAt: Stage | null;
}

/** Pick the pipeline for this applicant: their role's pipeline, else default. */
export function resolvePipeline(
  pipelines: Pipeline[],
  applicantRole: string,
): Pipeline | null {
  return (
    pipelines.find((p) => p.appliesTo === applicantRole) ??
    pipelines.find((p) => p.appliesTo === "default") ??
    null
  );
}

/** Remove any stage the applicant would approve themselves (rule 2).
 *  Stages stay in position order. */
export function effectiveStages(pipeline: Pipeline, applicantRole: string): Stage[] {
  return [...pipeline.stages]
    .sort((a, b) => a.position - b.position)
    .filter((s) => s.approverRole !== applicantRole);
}

/** Where does this application stand? */
export function route(
  pipeline: Pipeline,
  applicantRole: string,
  approvals: ApprovalRecord[],
): RoutingResult {
  const stages = effectiveStages(pipeline, applicantRole);

  const rejected = approvals.find((a) => a.decision === "rejected");
  if (rejected) {
    const at = stages.find((s) => s.id === rejected.stageId) ?? null;
    return { state: "rejected", stages, currentStage: null, completed: [], rejectedAt: at };
  }

  const approvedIds = new Set(
    approvals.filter((a) => a.decision === "approved").map((a) => a.stageId),
  );
  const completed = stages.filter((s) => approvedIds.has(s.id));
  const current = stages.find((s) => !approvedIds.has(s.id)) ?? null;

  return {
    state: current ? "pending" : "approved",
    stages,
    currentStage: current,
    completed,
    rejectedAt: null,
  };
}

/** May this actor decide on this stage for this applicant?
 *  dept_head resolves to the APPLICANT'S department head (a person),
 *  every other role matches on the actor's membership role. */
export function canAct(stage: Stage, actor: Actor, applicant: Applicant): boolean {
  // An applicant can never act on their own application, belt-and-braces:
  // effectiveStages already removed their role's stage, but guard anyway.
  if (actor.employeeId && actor.employeeId === applicant.employeeId) return false;

  if (stage.approverRole === "dept_head") {
    return (
      applicant.departmentHeadId !== null &&
      actor.employeeId === applicant.departmentHeadId
    );
  }
  return actor.role === stage.approverRole;
}

/** The CFO stage is where the schedule is produced (spec step 5): the CEO must
 *  see a schedule before signing off. */
export function stageCanGenerateSchedule(stage: Stage): boolean {
  return stage.approverRole === "cfo";
}

/** Validate a decision before it is recorded. Rejections need a reason. */
export function validateDecision(
  decision: Decision,
  comment: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (decision === "rejected" && (!comment || comment.trim().length === 0)) {
    return { ok: false, error: "A rejection must include a reason." };
  }
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, error: `Unsupported decision: ${decision}` };
  }
  return { ok: true };
}