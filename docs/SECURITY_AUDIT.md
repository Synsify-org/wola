# Security self-audit

A plain checklist of what protects customer data today, what was checked and how, and
what is still open. This is a self-audit, not an independent one: it is the honest
starting point for a customer's security questionnaire and for a later external review.
Last reviewed: 2026-10-13.

## What is in place (and the evidence)

| Area | What protects it | Evidence |
| ---- | ---------------- | -------- |
| Tenant isolation | Every tenant table has row-level security, forced even for the table owner; each request runs inside a transaction that sets the tenant. | `packages/db/test/*isolation*`, plus per-table isolation checks (`money_loop.test.mjs` covers the three newest tables and the balance view). A write for another tenant is refused by the database, not just by app code. |
| Shared tables | Users, sessions and MFA tables are outside tenant rules but locked away from the public Supabase API roles (migration 0019). | Test that the API roles read nothing. |
| App database role | The runtime role cannot create tables, cannot delete audit rows, and cannot change or delete payroll runs. | "app role cannot create tables", "audit log is append-only", "history is append-only for the runtime role". |
| Sign-in | Argon2id password hashes; sessions stored hashed; per (email, IP) and per-IP rate limits; reset links single-use and expiring; a reset ends every session. | `auth` tests (rate limit, reset, expiry, spraying). |
| Two-step sign-in | TOTP + recovery codes; secrets encrypted at rest; policy per organisation enforced on every page and action; fails closed if the key is missing. The platform console has its own mandatory version; a platform challenge can never unlock a tenant and the reverse. | 17 DB tests (incl. platform/tenant separation), 20+ web tests. |
| Roles | One table of privileges (`apps/web/src/lib/permissions.ts`); the auditor can only look; nobody on an approval chain can edit the chains. | `permissions.test.ts`. |
| Money actions | Every money-moving action re-checks the role on the server and writes an audit entry. | `reconciliation/actions.ts`; audit rows `payroll.bulk_run`, `payroll.import`, `loan.repayment_recorded`, `loan.paused`, `repayment.early_*`. |
| Operator audit trail | Platform operators' sign-ins, two-step enrolment and every organisation they open are recorded in an append-only table, and each organisation's page shows who from Wola looked at it. | `platform.test.mjs` (recording, listing, append-only). |
| Errors | Failures are logged with a request digest, never shown with internals to the user. | `instrumentation.ts`, `error-report.ts` and their tests. |
| Deploys | Migrations run from CI against production with a protected secret; a restore drill exists. | `docs/OPERATIONS.md`, `scripts/restore-check.mjs`. |

## Open items (honest list)

1. **Platform (super) admin two-step sign-in is built (migration 0024) but only enforced
   once `MFA_ENCRYPTION_KEY` is set on the server.** After that, the platform admin must
   enrol at their next sign-in (a not-yet-verified session can reach only
   `/admin/security`) and there is no way to turn it off. Until the key is set the
   console is password-only. Set the key, then sign in once to enrol.
2. **Error tracking has no destination until you set `ERROR_WEBHOOK_URL`.** The reporter
   is built (Slack-style webhook, never blocks a request); it needs a webhook URL from
   Slack or any tracker that accepts one.
3. **Uptime monitor** is not set up (`/api/health` exists). Owner action.
4. **Automated backups**: confirm the Supabase plan's backup/PITR setting and run the
   restore drill (`npm run restore:check`) against a real backup quarterly. Owner action.
5. **Credentials**: the database password was shared in a chat and must be rotated;
   `DATABASE_ADMIN_URL` should not be present in the Vercel project environment.
6. **MFA is opt-in per organisation**: until `MFA_ENCRYPTION_KEY` is set in production and
   a policy is chosen, finance and admin roles sign in with a password only.
7. **No independent penetration test** has been done. Do one before a bank-sized customer.
8. **Data retention and deletion** (what happens to an exited employee's records, how an
   organisation's data is removed on request) is a policy decision, see
   `docs/business/POLICY_DECISIONS.md`.
9. **Email delivery** goes through an outbox; the sending provider and domain
   authentication (SPF/DKIM) are not configured for production yet.

## How to re-run the evidence

```bash
npm run test:isolation        # database rules, against the separate wola_test database
npm run test --workspace=apps/web   # web unit tests
npm run rehearse              # every page, every role, zero errors
```
