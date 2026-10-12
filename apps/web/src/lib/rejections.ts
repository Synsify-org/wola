// Rejections the viewer is allowed to see, with the reason the approver gave.
// Scoped exactly like the applications list (scopePredicate): an employee sees
// their own, a dept head their department's, a full-book role everyone's.
import { scopePredicate, type SessionCtx } from "@/lib/guard";
import type { Tx } from "@wola/db";

export type RejectionRow = {
  applicationId: string;
  applicant: string;
  employeeNo: string;
  product: string;
  amount: number;
  tenorMonths: number;
  /** What the approver wrote. Null only for rejections recorded before a
   *  reason was mandatory. */
  reason: string | null;
  rejectedAt: string | null;
  stageRole: string | null;
  rejectedBy: string | null;
  rejectedByTitle: string | null;
};

export type Rejections = { total: number; rows: RejectionRow[] };

/** The viewer's rejection count (always — it labels the dashboard tab) and,
 *  when `withRows`, the most recent `limit` of them. One query either way. */
export async function rejectionsFor(
  tx: Tx,
  ctx: SessionCtx,
  withRows: boolean,
  limit = 100,
): Promise<Rejections> {
  const rows = await tx`
    SELECT la.id, la.amount, la.tenor_months,
           e.full_name AS applicant, e.employee_no, lp.name AS product,
           a.comment AS reason, a.decided_at, s.approver_role AS stage_role,
           COALESCE(ae.full_name, u.email) AS rejected_by, ae.title AS rejected_by_title,
           count(*) OVER ()::int AS total
    FROM approvals a
    JOIN loan_applications la ON la.id = a.application_id
    JOIN employees e ON e.id = la.employee_id
    JOIN loan_products lp ON lp.id = la.loan_product_id
    LEFT JOIN approval_stages s ON s.id = a.stage_id
    LEFT JOIN users u ON u.id = a.approver_user_id
    LEFT JOIN employees ae ON ae.user_id = a.approver_user_id
    WHERE a.decision = 'rejected' AND ${scopePredicate(tx, ctx)}
    ORDER BY COALESCE(a.decided_at, a.created_at) DESC
    LIMIT ${withRows ? limit : 1}`;

  return {
    total: Number(rows[0]?.total ?? 0),
    rows: withRows
      ? rows.map((r) => ({
          applicationId: r.id as string,
          applicant: r.applicant as string,
          employeeNo: r.employee_no as string,
          product: r.product as string,
          amount: Number(r.amount),
          tenorMonths: Number(r.tenor_months),
          reason: (r.reason as string | null)?.trim() || null,
          rejectedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
          stageRole: (r.stage_role as string | null) ?? null,
          rejectedBy: (r.rejected_by as string | null) ?? null,
          rejectedByTitle: (r.rejected_by_title as string | null) ?? null,
        }))
      : [],
  };
}
