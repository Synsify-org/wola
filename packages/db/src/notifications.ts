// packages/db/src/notifications.ts
// Approval-decision notifications (Phase 3 — TASKS.md, and the exact legacy
// pain point Wola.pdf names: "There was no notification system built into
// the old one"). Wired into decide() so every stage transition enqueues the
// right emails in the SAME transaction as the mutation that caused them —
// same pattern email.ts documents (commit/rollback together).
//
// Wola.pdf's described flow: each stage advance notifies whoever's turn it
// is next; a final approval notifies the CFO, HR, the applicant's department
// head, and the applicant; a rejection notifies the applicant with the reason.
import { sendEmail, type EmailTemplate } from "./email";
import type { Tx } from "./client";

const STAGE_AWAITING: EmailTemplate = {
  subject: "Awaiting your decision: {{applicantName}}'s {{productName}} application",
  html:
    "<p>{{applicantName}} has applied for a {{productName}} of {{currency}} {{amount}}.</p>" +
    "<p>It is now awaiting your decision in Wola.</p>",
};

const APPLICATION_REJECTED: EmailTemplate = {
  subject: "Your {{productName}} application was not approved",
  html:
    "<p>Your application for a {{productName}} of {{currency}} {{amount}} was not approved.</p>" +
    "<p>Reason: {{reason}}</p>",
};

const LOAN_APPROVED_APPLICANT: EmailTemplate = {
  subject: "Your {{productName}} loan has been approved",
  html:
    "<p>Your application for a {{productName}} of {{currency}} {{amount}} has been fully approved.</p>" +
    "<p>Your repayment schedule is available in Wola. Disbursement is handled separately by finance.</p>",
};

const LOAN_APPROVED_STAFF: EmailTemplate = {
  subject: "{{applicantName}}'s {{productName}} loan has been approved",
  html:
    "<p>{{applicantName}}'s application for a {{productName}} of {{currency}} {{amount}} has been fully approved.</p>",
};

interface ApplicationContext {
  applicantUserId: string | null;
  applicantName: string;
  departmentHeadId: string | null; // employee id, not user id
  productName: string;
  amount: number;
  currency: string;
}

async function loadContext(
  tx: Tx, applicationId: string,
): Promise<ApplicationContext | null> {
  const [row] = await tx`
    SELECT e.user_id AS applicant_user_id, e.full_name AS applicant_name,
           e.department_head_id, lp.name AS product_name, la.amount,
           t.currency
    FROM loan_applications la
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    JOIN tenants t ON t.id = la.tenant_id
    WHERE la.id = ${applicationId}`;
  if (!row) return null;
  return {
    applicantUserId: row.applicant_user_id as string | null,
    applicantName: row.applicant_name as string,
    departmentHeadId: row.department_head_id as string | null,
    productName: row.product_name as string,
    amount: Number(row.amount),
    currency: row.currency as string,
  };
}

async function emailForUserId(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx`SELECT email FROM users WHERE id = ${userId}`;
  return (row?.email as string) ?? null;
}

async function emailForEmployeeId(tx: Tx, employeeId: string): Promise<string | null> {
  const [row] = await tx`
    SELECT u.email FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = ${employeeId}`;
  return (row?.email as string) ?? null;
}

/** Every active user holding `role` as a membership in this tenant. Used for
 *  role-based stages (hr, cfo, ceo, ...) where "the approver" isn't one
 *  named person the way a department head is. */
async function emailsForRole(tx: Tx, tenantId: string, role: string): Promise<string[]> {
  const rows = await tx`
    SELECT u.email FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId} AND m.role = ${role} AND u.status = 'active'`;
  return rows.map((r) => r.email as string);
}

const amountStr = (n: number) => Math.round(n).toLocaleString();

export type DecisionOutcome =
  | { kind: "advanced"; nextStageRole: string }
  | { kind: "approved" }
  | { kind: "rejected"; reason: string };

/** Enqueue the notification(s) for one decide() outcome, in the SAME
 *  transaction as the decision itself — see email.ts's header note: send and
 *  the mutation it's about commit or roll back together, by design. A
 *  missing/unlinked applicant context is a no-op (nothing to notify), not an
 *  error. */
export async function notifyApplicationDecision(
  tx: Tx,
  tenantId: string,
  applicationId: string,
  outcome: DecisionOutcome,
): Promise<void> {
  const ctx = await loadContext(tx, applicationId);
  if (!ctx) return;

  const data = {
    applicantName: ctx.applicantName,
    productName: ctx.productName,
    amount: amountStr(ctx.amount),
    currency: ctx.currency,
  };

  if (outcome.kind === "rejected") {
    const to = ctx.applicantUserId ? await emailForUserId(tx, ctx.applicantUserId) : null;
    if (to) await sendEmail(tx, { tenantId, to, template: APPLICATION_REJECTED, data: { ...data, reason: outcome.reason } });
    return;
  }

  if (outcome.kind === "approved") {
    const recipients = new Set<string>();
    if (ctx.applicantUserId) {
      const to = await emailForUserId(tx, ctx.applicantUserId);
      if (to) await sendEmail(tx, { tenantId, to, template: LOAN_APPROVED_APPLICANT, data });
    }
    for (const email of await emailsForRole(tx, tenantId, "cfo")) recipients.add(email);
    for (const email of await emailsForRole(tx, tenantId, "hr")) recipients.add(email);
    if (ctx.departmentHeadId) {
      const headEmail = await emailForEmployeeId(tx, ctx.departmentHeadId);
      if (headEmail) recipients.add(headEmail);
    }
    for (const to of recipients) {
      await sendEmail(tx, { tenantId, to, template: LOAN_APPROVED_STAFF, data });
    }
    return;
  }

  // Advanced to the next stage: tell whoever acts on it now. dept_head
  // resolves to the applicant's SPECIFIC head (a person); every other stage
  // role is broadcast to everyone currently holding that role in the tenant.
  const recipients =
    outcome.nextStageRole === "dept_head"
      ? (ctx.departmentHeadId ? [await emailForEmployeeId(tx, ctx.departmentHeadId)].filter((e): e is string => Boolean(e)) : [])
      : await emailsForRole(tx, tenantId, outcome.nextStageRole);

  for (const to of recipients) {
    await sendEmail(tx, { tenantId, to, template: STAGE_AWAITING, data });
  }
}
