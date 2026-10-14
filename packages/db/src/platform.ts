// packages/db/src/platform.ts
// What the PLATFORM CONSOLE (Wola operators) needs: how every organisation is doing, what
// needs attention, who the operators are, and a record of what operators do.
//
// Read-only over organisations' data, by design: the console shows and explains, it never
// changes a tenant's records. Per-organisation figures are read inside that organisation's
// own tenant context (tenantTx), exactly as the app would, so the database's tenant rules
// still apply; the cross-organisation view is assembled here, not by bypassing them.
import { tenantTx, type Sql } from "./client";
import { arrearsByLoan } from "./payroll";

// ------------------------------------------------------------ operator audit trail

export interface PlatformEventInput {
  actorId: string | null;
  action: string;
  tenantId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Record something an operator did. Never throws: failing to write the trail must not
 *  stop the operator's own sign-in or page; it is logged for the platform's error report. */
export async function recordPlatformEvent(sql: Sql, e: PlatformEventInput): Promise<void> {
  try {
    const [u] = e.actorId ? await sql`SELECT email FROM users WHERE id = ${e.actorId}` : [];
    await sql`
      INSERT INTO platform_audit_log (actor_id, actor_email, action, tenant_id, detail, ip)
      VALUES (${e.actorId}, ${(u?.email as string | undefined) ?? null}, ${e.action}, ${e.tenantId ?? null},
              ${e.detail ? sql.json(e.detail as never) : null}, ${e.ip ?? null})`;
  } catch (err) {
    console.error(JSON.stringify({ level: "error", kind: "platform_audit_write_failed", message: err instanceof Error ? err.message : String(err) }));
  }
}

export interface PlatformEvent {
  id: string;
  at: string;
  action: string;
  actorEmail: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export async function listPlatformEvents(
  sql: Sql, opts: { limit?: number; tenantId?: string | null } = {},
): Promise<PlatformEvent[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const rows = await sql`
    SELECT e.id, e.at, e.action, e.actor_email, e.detail, e.ip, t.name AS tenant_name, t.slug AS tenant_slug
    FROM platform_audit_log e LEFT JOIN tenants t ON t.id = e.tenant_id
    WHERE (${opts.tenantId ?? null}::uuid IS NULL OR e.tenant_id = ${opts.tenantId ?? null}::uuid)
    ORDER BY e.at DESC, e.id DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    at: new Date(r.at as string).toISOString(),
    action: r.action as string,
    actorEmail: (r.actor_email as string | null) ?? null,
    tenantName: (r.tenant_name as string | null) ?? null,
    tenantSlug: (r.tenant_slug as string | null) ?? null,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    ip: (r.ip as string | null) ?? null,
  }));
}

// ------------------------------------------------------------------ the console

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  currency: string;
  createdAt: string;
  people: number;
  employees: number;
  activeLoans: number;
  principal: number;
  outstanding: number;
  arrearsLoans: number;
  arrears: number;
  inFlight: number;
  emailsPending: number;
  emailsFailed: number;
  /** Emails delivered in the last 7 days, and when the oldest still-waiting one was queued. */
  emailsSent7d: number;
  oldestPendingAt: string | null;
  admins: number;
  mfaRoles: number;
  lastActivityAt: string | null;
  lastSignInAt: string | null;
}

export interface Attention {
  tenantId: string;
  tenantName: string;
  severity: "warn" | "info";
  text: string;
}

export interface Operator {
  id: string;
  email: string;
  name: string;
  status: string;
  mfaEnrolled: boolean;
  lastSignInAt: string | null;
}

export interface PlatformConsole {
  generatedAt: string;
  totals: { orgs: number; activeOrgs: number; people: number; employees: number; activeLoans: number; inFlight: number; arrearsLoans: number; newOrgs30d: number };
  /** Money, per currency: organisations may not all lend in the same one. */
  money: { currency: string; principal: number; outstanding: number; arrears: number }[];
  orgs: OrgSummary[];
  attention: Attention[];
  operators: Operator[];
  health: { failedSignIns24h: number; activeSessions: number; emailsPending: number; emailsFailed: number; emailsSent7d: number; oldestPendingAt: string | null };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const daysSince = (isoStr: string | null, now: Date) => (isoStr ? Math.floor((now.getTime() - new Date(isoStr).getTime()) / 86_400_000) : null);

/** One organisation's headline numbers, read in its own tenant context. */
async function summarise(sql: Sql, t: Record<string, unknown>): Promise<OrgSummary> {
  const id = t.id as string;
  return tenantTx(sql, id, async (tx) => {
    const [c] = await tx`
      SELECT
        (SELECT count(DISTINCT user_id)::int FROM memberships WHERE tenant_id = ${id}) AS people,
        (SELECT count(*)::int FROM memberships WHERE tenant_id = ${id} AND role IN ('admin', 'org_admin')) AS admins,
        (SELECT count(*)::int FROM employees WHERE tenant_id = ${id} AND status = 'active') AS employees,
        (SELECT count(*)::int FROM loan_applications WHERE tenant_id = ${id} AND status IN ('submitted', 'in_review')) AS in_flight,
        (SELECT count(*)::int FROM email_outbox WHERE tenant_id = ${id} AND status = 'pending') AS pending,
        (SELECT count(*)::int FROM email_outbox WHERE tenant_id = ${id} AND status = 'failed') AS failed,
        (SELECT count(*)::int FROM email_outbox WHERE tenant_id = ${id} AND status = 'sent' AND sent_at > now() - interval '7 days') AS sent7d,
        (SELECT min(created_at) FROM email_outbox WHERE tenant_id = ${id} AND status = 'pending') AS oldest_pending,
        (SELECT max(at) FROM audit_log WHERE tenant_id = ${id}) AS last_activity,
        (SELECT max(la.created_at) FROM login_attempts la
           JOIN users u ON u.email = la.email JOIN memberships m ON m.user_id = u.id
          WHERE la.succeeded AND m.tenant_id = ${id}) AS last_sign_in`;
    const [b] = await tx`
      SELECT count(*)::int AS n, COALESCE(sum(l.principal), 0) AS principal,
             COALESCE(sum(COALESCE((SELECT lb.outstanding FROM loan_balances lb WHERE lb.loan_id = l.id), l.principal)), 0) AS outstanding
      FROM loans l WHERE l.tenant_id = ${id} AND l.status = 'active'`;
    const arrearsMap = await arrearsByLoan(tx, id);
    let arrearsLoans = 0, arrears = 0;
    for (const v of arrearsMap.values()) if (v > 0.5) { arrearsLoans++; arrears += v; }
    const settings = (t.settings ?? {}) as { security?: { mfaRequiredRoles?: string[] } };
    return {
      id,
      slug: t.slug as string,
      name: t.name as string,
      plan: t.plan as string,
      status: t.status as string,
      currency: t.currency as string,
      createdAt: iso(t.created_at)!,
      people: Number(c.people),
      employees: Number(c.employees),
      activeLoans: Number(b.n),
      principal: Number(b.principal),
      outstanding: Number(b.outstanding),
      arrearsLoans,
      arrears: Math.round(arrears * 100) / 100,
      inFlight: Number(c.in_flight),
      emailsPending: Number(c.pending),
      emailsFailed: Number(c.failed),
      emailsSent7d: Number(c.sent7d),
      oldestPendingAt: iso(c.oldest_pending),
      admins: Number(c.admins),
      mfaRoles: settings.security?.mfaRequiredRoles?.length ?? 0,
      lastActivityAt: iso(c.last_activity),
      lastSignInAt: iso(c.last_sign_in),
    };
  });
}


/** What is worth an operator's attention about ONE organisation (used by the Overview and by
 *  the organisation's own page, so they always agree). */
export function orgAttention(o: OrgSummary, now: Date = new Date()): { severity: "warn" | "info"; text: string }[] {
  const out: { severity: "warn" | "info"; text: string }[] = [];
  const add = (severity: "warn" | "info", text: string) => out.push({ severity, text });
  if (o.status !== "active") add("warn", `This organisation is ${o.status}.`);
  if (o.status === "active" && o.admins === 0) add("warn", "Nobody holds an administrator role, so nobody can manage access.");
  if (o.emailsFailed > 0) add("warn", `${o.emailsFailed} email${o.emailsFailed === 1 ? "" : "s"} could not be sent and gave up.`);
  if (o.emailsPending > 0) {
    const waitedMin = o.oldestPendingAt ? Math.floor((now.getTime() - new Date(o.oldestPendingAt).getTime()) / 60_000) : 0;
    add(waitedMin >= 30 ? "warn" : "info", `${o.emailsPending} email${o.emailsPending === 1 ? " is" : "s are"} waiting to be sent${waitedMin >= 30 ? ` (the oldest for ${waitedMin >= 120 ? Math.floor(waitedMin / 60) + " hours" : waitedMin + " minutes"}): nothing is sending them` : ""}.`);
  }
  if (o.arrearsLoans > 0) add("info", `${o.arrearsLoans} loan${o.arrearsLoans === 1 ? " is" : "s are"} behind on payments.`);
  const quiet = daysSince(o.lastSignInAt, now);
  if (o.status === "active" && o.people > 1 && (quiet === null || quiet >= 14)) {
    add("info", quiet === null ? "Nobody has signed in yet." : `Nobody has signed in for ${quiet} days.`);
  }
  return out;
}

/** Everything the console's Overview needs, in one pass. */
export async function platformConsole(sql: Sql, now: Date = new Date()): Promise<PlatformConsole> {
  const tenants = await sql`SELECT id, slug, name, plan, status, currency, created_at, settings FROM tenants ORDER BY created_at DESC`;
  const orgs: OrgSummary[] = [];
  for (const t of tenants) orgs.push(await summarise(sql, t));

  const money = new Map<string, { principal: number; outstanding: number; arrears: number }>();
  for (const o of orgs) {
    const m = money.get(o.currency) ?? { principal: 0, outstanding: 0, arrears: 0 };
    m.principal += o.principal; m.outstanding += o.outstanding; m.arrears += o.arrears;
    money.set(o.currency, m);
  }

  const attention: Attention[] = [];
  for (const o of orgs) for (const a of orgAttention(o, now)) attention.push({ tenantId: o.id, tenantName: o.name, ...a });
  attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));

  const operatorRows = await sql`
    SELECT u.id, u.email, u.name, sa.status,
           (SELECT enabled_at IS NOT NULL FROM user_mfa WHERE user_id = u.id) AS mfa,
           (SELECT max(created_at) FROM super_admin_sessions WHERE user_id = u.id) AS last_in
    FROM super_admins sa JOIN users u ON u.id = sa.user_id ORDER BY u.email`;
  const operators: Operator[] = operatorRows.map((r) => ({
    id: r.id as string, email: r.email as string, name: r.name as string, status: r.status as string,
    mfaEnrolled: Boolean(r.mfa), lastSignInAt: iso(r.last_in),
  }));

  const [h] = await sql`
    SELECT
      (SELECT count(*)::int FROM login_attempts WHERE NOT succeeded AND created_at > now() - interval '24 hours') AS failed,
      (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions`;

  return {
    generatedAt: now.toISOString(),
    totals: {
      orgs: orgs.length,
      activeOrgs: orgs.filter((o) => o.status === "active").length,
      people: orgs.reduce((s, o) => s + o.people, 0),
      employees: orgs.reduce((s, o) => s + o.employees, 0),
      activeLoans: orgs.reduce((s, o) => s + o.activeLoans, 0),
      inFlight: orgs.reduce((s, o) => s + o.inFlight, 0),
      arrearsLoans: orgs.reduce((s, o) => s + o.arrearsLoans, 0),
      newOrgs30d: orgs.filter((o) => now.getTime() - new Date(o.createdAt).getTime() < 30 * 86_400_000).length,
    },
    money: [...money.entries()].map(([currency, m]) => ({ currency, ...m })),
    orgs, attention, operators,
    health: {
      failedSignIns24h: Number(h.failed),
      activeSessions: Number(h.sessions),
      emailsPending: orgs.reduce((s, o) => s + o.emailsPending, 0),
      emailsFailed: orgs.reduce((s, o) => s + o.emailsFailed, 0),
      emailsSent7d: orgs.reduce((s, o) => s + o.emailsSent7d, 0),
      oldestPendingAt: orgs.map((o) => o.oldestPendingAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null,
    },
  };
}

// --------------------------------------------------------------- one organisation

export interface OrgPerson { name: string; email: string; role: string; status: string; mfa: boolean }
export interface OrgDetail {
  org: OrgSummary;
  people: OrgPerson[];
  roles: { role: string; n: number }[];
  loansByStatus: { status: string; n: number; principal: number }[];
  applicationsByStatus: { status: string; n: number }[];
  mfaRequiredRoles: string[];
  loanExitPolicy: string;
  recent: { at: string; action: string; entity: string; actorEmail: string | null }[];
  operatorViews: PlatformEvent[];
}

/** One organisation in full, or null if it does not exist. */
export async function orgDetail(sql: Sql, tenantId: string): Promise<OrgDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return null;
  const [t] = await sql`SELECT id, slug, name, plan, status, currency, created_at, settings FROM tenants WHERE id = ${tenantId}`;
  if (!t) return null;
  const org = await summarise(sql, t);
  const settings = (t.settings ?? {}) as { security?: { mfaRequiredRoles?: string[] }; loanExit?: { policy?: string } };

  const d = await tenantTx(sql, tenantId, async (tx) => {
    const people = await tx`
      SELECT u.name, u.email, m.role, u.status, EXISTS (SELECT 1 FROM user_mfa x WHERE x.user_id = u.id AND x.enabled_at IS NOT NULL) AS mfa
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId}
      ORDER BY m.role, u.name LIMIT 200`;
    const loans = await tx`SELECT status, count(*)::int AS n, COALESCE(sum(principal), 0) AS principal FROM loans WHERE tenant_id = ${tenantId} GROUP BY status ORDER BY status`;
    const apps = await tx`SELECT status, count(*)::int AS n FROM loan_applications WHERE tenant_id = ${tenantId} GROUP BY status ORDER BY status`;
    const recent = await tx`
      SELECT a.at, a.action, a.entity, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.tenant_id = ${tenantId} ORDER BY a.at DESC LIMIT 15`;
    return { people, loans, apps, recent };
  });

  const roleCount = new Map<string, number>();
  for (const p of d.people) roleCount.set(p.role as string, (roleCount.get(p.role as string) ?? 0) + 1);

  return {
    org,
    people: d.people.map((p) => ({ name: p.name as string, email: p.email as string, role: p.role as string, status: p.status as string, mfa: Boolean(p.mfa) })),
    roles: [...roleCount.entries()].map(([role, n]) => ({ role, n })),
    loansByStatus: d.loans.map((l) => ({ status: l.status as string, n: Number(l.n), principal: Number(l.principal) })),
    applicationsByStatus: d.apps.map((a) => ({ status: a.status as string, n: Number(a.n) })),
    mfaRequiredRoles: settings.security?.mfaRequiredRoles ?? [],
    loanExitPolicy: settings.loanExit?.policy === "manual" ? "manual" : "recover_balance",
    recent: d.recent.map((r) => ({ at: iso(r.at)!, action: r.action as string, entity: r.entity as string, actorEmail: (r.actor_email as string | null) ?? null })),
    operatorViews: await listPlatformEvents(sql, { tenantId, limit: 10 }),
  };
}
