// packages/db/src/access-admin.ts
// Administration of WHO HAS ACCESS and AS WHAT: list the people with a login to
// this organisation, change a person's role, remove their access, and invite
// someone (including accounts that aren't employees, e.g. an auditor).
//
// Roles live on `memberships` and are read FRESH on every request
// (requireSession in apps/web/src/lib/guard.ts), so a role change or removal
// takes effect on the person's very next click — no waiting for a session to
// expire. Removal also deletes their sessions for this organisation.
//
// Invariants enforced here (not just in the UI):
//   * You cannot change your own role or remove yourself — an administrator
//     can't quietly promote themselves or lock themselves out mid-session.
//   * An organisation always keeps at least one administrator (org_admin).
//   * Roles are one of MEMBERSHIP_ROLES.
//   * Role changes collapse to exactly ONE membership row per person — the
//     table allows several, but the guard only ever reads one, and an
//     ambiguous second role would be a silent privilege problem.
import { MEMBERSHIP_ROLES } from "@wola/engine";
import type { Tx } from "./client";
import { createInvitation } from "./invitations";

export interface AccessPerson {
  userId: string;
  email: string;
  /** Employee name when linked, else the account's own name, else the email. */
  name: string;
  role: string;
  userStatus: string;
  employeeId: string | null;
  employeeNo: string | null;
  department: string | null;
  title: string | null;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AccessOverview {
  people: AccessPerson[];
  invites: PendingInvite[];
  /** Employees with no login yet — candidates for an invite. */
  employeesWithoutLogin: { id: string; name: string; employeeNo: string }[];
}

export async function listAccess(tx: Tx, tenantId: string): Promise<AccessOverview> {
  const people = await tx`
    SELECT m.user_id, m.role, u.email, u.name AS user_name, u.status AS user_status,
           e.id AS employee_id, e.full_name, e.employee_no, e.department, e.title
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN employees e ON e.user_id = m.user_id AND e.tenant_id = m.tenant_id
    WHERE m.tenant_id = ${tenantId}
    ORDER BY
      array_position(ARRAY['org_admin','ceo','group_ceo','coo','cfo','hr','dept_head','auditor','employee'], m.role),
      COALESCE(e.full_name, u.name, u.email)`;

  // `invitations` is not under RLS (looked up by bare token), so scope it here.
  const invites = await tx`
    SELECT id, email, role, expires_at, created_at FROM invitations
    WHERE tenant_id = ${tenantId} AND accepted_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC`;

  const noLogin = await tx`
    SELECT id, full_name, employee_no FROM employees
    WHERE tenant_id = ${tenantId} AND user_id IS NULL AND status = 'active'
    ORDER BY full_name`;

  return {
    people: people.map((r) => ({
      userId: r.user_id as string,
      email: r.email as string,
      name: ((r.full_name ?? r.user_name ?? r.email) as string) || (r.email as string),
      role: r.role as string,
      userStatus: r.user_status as string,
      employeeId: (r.employee_id as string | null) ?? null,
      employeeNo: (r.employee_no as string | null) ?? null,
      department: (r.department as string | null) ?? null,
      title: (r.title as string | null) ?? null,
    })),
    invites: invites.map((r) => ({
      id: r.id as string,
      email: r.email as string,
      role: r.role as string,
      expiresAt: r.expires_at as Date,
      createdAt: r.created_at as Date,
    })),
    employeesWithoutLogin: noLogin.map((r) => ({
      id: r.id as string,
      name: r.full_name as string,
      employeeNo: r.employee_no as string,
    })),
  };
}

export type AccessResult = { ok: true; before?: string } | { ok: false; error: string };

async function otherAdminsRemain(tx: Tx, tenantId: string, excludingUserId: string): Promise<boolean> {
  const [{ n }] = await tx`
    SELECT count(*)::int AS n FROM memberships
    WHERE tenant_id = ${tenantId} AND role = 'org_admin' AND user_id <> ${excludingUserId}`;
  return Number(n) > 0;
}

/** Set a person's role (replacing whatever they had). */
export async function changeRole(
  tx: Tx,
  args: { tenantId: string; actorUserId: string; targetUserId: string; newRole: string },
): Promise<AccessResult> {
  const { tenantId, actorUserId, targetUserId, newRole } = args;
  if (!(MEMBERSHIP_ROLES as readonly string[]).includes(newRole)) return { ok: false, error: "Pick a valid role." };
  if (actorUserId === targetUserId) return { ok: false, error: "You can't change your own role. Ask another administrator." };

  const current = await tx`
    SELECT role FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  if (current.length === 0) return { ok: false, error: "That person doesn't have access to this organisation." };

  const roles = current.map((r) => r.role as string);
  if (roles.length === 1 && roles[0] === newRole) return { ok: true, before: newRole };

  if (roles.includes("org_admin") && newRole !== "org_admin" && !(await otherAdminsRemain(tx, tenantId, targetUserId))) {
    return { ok: false, error: "This is the organisation's only administrator. Make someone else an administrator first." };
  }

  await tx`DELETE FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  await tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${targetUserId}, ${newRole})`;
  return { ok: true, before: roles.join(",") };
}

/** Take away a person's access to this organisation. Their account (which may
 *  belong to other organisations too) and all history stay; they can no longer
 *  sign in here, and any open sessions end now. Their employee record is
 *  unlinked from the login so HR can invite them again later. */
export async function removeAccess(
  tx: Tx,
  args: { tenantId: string; actorUserId: string; targetUserId: string },
): Promise<AccessResult> {
  const { tenantId, actorUserId, targetUserId } = args;
  if (actorUserId === targetUserId) return { ok: false, error: "You can't remove your own access." };

  const current = await tx`
    SELECT role FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  if (current.length === 0) return { ok: false, error: "That person doesn't have access to this organisation." };

  const roles = current.map((r) => r.role as string);
  if (roles.includes("org_admin") && !(await otherAdminsRemain(tx, tenantId, targetUserId))) {
    return { ok: false, error: "This is the organisation's only administrator and can't be removed." };
  }

  await tx`DELETE FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  // sessions aren't RLS-scoped; pin to this tenant so other organisations' sessions are untouched.
  await tx`DELETE FROM sessions WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  await tx`UPDATE employees SET user_id = NULL WHERE tenant_id = ${tenantId} AND user_id = ${targetUserId}`;
  return { ok: true, before: roles.join(",") };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite a person to this organisation in a given role. The invitee sets
 *  their own password (or, if their email already has a Wola account, just
 *  accepts) — nobody ever sees a password. Optionally ties the invite to an
 *  employee record that has no login yet. A newer invite for the same email
 *  replaces any older pending one, so only one live link exists. */
export async function inviteToOrganisation(
  tx: Tx,
  args: { tenantId: string; invitedById: string; email: string; role: string; employeeId?: string | null },
): Promise<{ ok: true; token: string; expires: Date; email: string } | { ok: false; error: string }> {
  const email = args.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!(MEMBERSHIP_ROLES as readonly string[]).includes(args.role)) return { ok: false, error: "Pick a valid role." };

  const [already] = await tx`
    SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${args.tenantId} AND u.email = ${email}`;
  if (already) return { ok: false, error: "That person already has access. Change their role in the list instead." };

  // wola_app can't DELETE invitations (least privilege); expiring one is
  // equivalent — the link stops working and it drops out of the pending list.
  await tx`UPDATE invitations SET expires_at = now() - interval '1 second'
           WHERE tenant_id = ${args.tenantId} AND email = ${email} AND accepted_at IS NULL AND expires_at > now()`;
  try {
    const issued = await createInvitation(tx, {
      tenantId: args.tenantId, email, role: args.role,
      employeeId: args.employeeId ?? null, invitedById: args.invitedById,
    });
    return { ok: true, ...issued, email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the invitation." };
  }
}

/** Cancel a pending invitation (the link stops working). */
export async function revokeInvite(
  tx: Tx, args: { tenantId: string; inviteId: string },
): Promise<AccessResult> {
  const res = await tx`
    UPDATE invitations SET expires_at = now() - interval '1 second'
    WHERE id = ${args.inviteId} AND tenant_id = ${args.tenantId}
      AND accepted_at IS NULL AND expires_at > now() RETURNING id`;
  return res.length ? { ok: true } : { ok: false, error: "That invitation is no longer pending." };
}
