// packages/db/src/invitations.ts — invite-based account provisioning (spec
// §7.4). Replaces the temp-password stopgap: an authorised role issues an
// invitation (single-use, time-limited token, only its hash stored — same
// security shape as password_resets), the invitee follows the link and
// either sets a password (new identity) or just accepts (their email
// already has an account elsewhere — users are global), and only then does
// membership actually exist.
import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "./auth";
import { tenantTx, type Tx, type Sql } from "./client";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface InvitationIssued {
  token: string; // RAW token — only ever returned here, never stored
  expires: Date;
}

export interface CreateInvitationArgs {
  tenantId: string;
  email: string;
  role: string;
  employeeId?: string | null;
  invitedById: string;
}

/** Issue an invitation. Guards the one thing that would make acceptance
 *  ambiguous: the target employee already has a login. Does NOT guard on
 *  the email already having a global user account — that's the normal,
 *  expected "invited into a second tenant" case, handled at acceptance. */
export async function createInvitation(
  tx: Tx, args: CreateInvitationArgs,
): Promise<InvitationIssued> {
  const email = args.email.trim().toLowerCase();

  if (args.employeeId) {
    const [emp] = await tx`
      SELECT user_id FROM employees WHERE tenant_id = ${args.tenantId} AND id = ${args.employeeId}`;
    if (emp?.user_id) throw new Error("This employee already has a login.");
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_MS);
  await tx`
    INSERT INTO invitations (tenant_id, employee_id, email, role, token_hash, invited_by, expires_at)
    VALUES (${args.tenantId}, ${args.employeeId ?? null}, ${email}, ${args.role}, ${sha256(token)}, ${args.invitedById}, ${expires})`;

  return { token, expires };
}

export interface PendingInvitation {
  id: string;
  tenantId: string;
  employeeId: string | null;
  email: string;
  role: string;
  /** Set when a user with this email already exists (global identity,
   *  possibly from another tenant) — acceptance just adds a membership,
   *  no password step. */
  existingUserId: string | null;
}

/** Look up a still-valid (not accepted, not expired) invitation by its raw
 *  token. Runs on the plain connection — `invitations` isn't tenant-scoped,
 *  same reasoning as sessions/password_resets: the tenant isn't known yet at
 *  the moment this is called (a bare accept-invite link), only the token is. */
export async function loadInvitation(sql: Sql, token: string): Promise<PendingInvitation | null> {
  const [row] = await sql`
    SELECT i.id, i.tenant_id, i.employee_id, i.email, i.role, i.expires_at, i.accepted_at,
           u.id AS existing_user_id
    FROM invitations i
    LEFT JOIN users u ON u.email = i.email
    WHERE i.token_hash = ${sha256(token)}`;
  if (!row) return null;
  if (row.accepted_at) return null;
  if (new Date(row.expires_at as string) < new Date()) return null;

  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    employeeId: row.employee_id as string | null,
    email: row.email as string,
    role: row.role as string,
    existingUserId: row.existing_user_id as string | null,
  };
}

export type AcceptInvitationResult =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; error: string };

/** Consume an invitation. `password` is required unless the email already
 *  has an account (existingUserId set) — that identity keeps its own
 *  password, this call only grants the new tenant's membership. The
 *  membership + employee-link writes run inside tenantTx (memberships and
 *  employees are RLS-protected — see DECISIONS.md's auth-query rule); the
 *  invitation lookup and user creation don't need a tenant context. */
export async function acceptInvitation(
  sql: Sql, token: string, password: string | null,
): Promise<AcceptInvitationResult> {
  const inv = await loadInvitation(sql, token);
  if (!inv) return { ok: false, error: "This invitation is invalid, already used, or has expired." };

  let userId: string;
  if (inv.existingUserId) {
    userId = inv.existingUserId;
  } else {
    if (!password || password.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters." };
    }
    const hash = await hashPassword(password);
    const [u] = await sql`
      INSERT INTO users (email, name, status, password_hash)
      VALUES (${inv.email}, ${inv.email}, 'active', ${hash})
      RETURNING id`;
    userId = u.id as string;
  }

  await tenantTx(sql, inv.tenantId, async (tx) => {
    await tx`
      INSERT INTO memberships (tenant_id, user_id, role)
      VALUES (${inv.tenantId}, ${userId}, ${inv.role})
      ON CONFLICT (tenant_id, user_id, role) DO NOTHING`;

    if (inv.employeeId) {
      await tx`
        UPDATE employees SET user_id = ${userId}
        WHERE tenant_id = ${inv.tenantId} AND id = ${inv.employeeId} AND user_id IS NULL`;
    }
  });

  // Outside the tenantTx — invitations isn't RLS-scoped, same as its lookup.
  await sql`UPDATE invitations SET accepted_at = now() WHERE id = ${inv.id}`;

  return { ok: true, userId, tenantId: inv.tenantId };
}
