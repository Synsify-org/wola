## 2026-07 — Foundation decisions
- Shared-schema multi-tenancy with FORCED RLS; DB-per-tenant rejected (ops surface). On-prem tier serves isolation demands.
- Two-role DB security model (admin vs app). App role has no DDL, no BYPASSRLS, append-only audit.
- postgres.js over an ORM for the core client; Drizzle may wrap it later for app queries.
