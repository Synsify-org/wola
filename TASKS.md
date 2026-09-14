# Wola — Build task list

Tracks the current work in phases so progress survives across sessions, same
spirit as [DECISIONS.md](DECISIONS.md) (which records *why*; this records
*what's left*). Check items off as they land. Re-order freely — this is a
living list, not a locked plan.

Status tags match the architecture document's convention:
`BUILT` / `PARTIAL` / `TO BUILD`.

---

## Phase 1.12 — 13-item bug report (2026-09-13) `5 FIXED, 8 need input`

User reported 13 issues in one batch. Investigated each against the actual
code (and live-retested) before touching anything — several claims didn't
hold up, and I didn't want to "fix" already-correct logic or guess at
lending-policy changes.

**Fixed and pushed** (`f10cdf5`):
- [x] Race condition on approval decisions — no DB-level guard stopped two
      concurrent requests for the same stage (a double-click, worsened by
      the page-load lag) from both landing, which on the final stage could
      create two loans for one application. Migration 0015: unique
      constraint on `(application_id, stage_id)`; `decide()` catches the
      violation and returns a friendly error.
- [x] Duplicate applications — nothing checked `loan_applications.status`
      before a new submission; eligibility's `activeProductIds` only
      reflects active LOANS, not in-flight applications. Migration 0016:
      partial unique index (one in-flight application per employee per
      product) + an app-level check in `api/apply/route.ts`. Confirmed
      live — caught an already-existing duplicate in seed data immediately.
- [x] Decisions tab showed the approver's raw email — now shows name +
      job title/role (joins `employees` + `memberships`). Confirmed live
      against a real 4-stage decision trail.
- [x] No loading feedback on nav clicks ("it freezes") — added a per-link
      pending spinner (`useLinkStatus`). A proper route-level `loading.tsx`
      isn't safe yet because `Shell` renders fresh inside every page
      instead of a shared layout — that's a real follow-up (see below).
- [x] Numbers vs. words used two different fonts — unified, and `.num` now
      tracks `--font-sans` instead of a separate `--font-mono` token, so it
      stays fixed even under a tenant's custom brand font (`theme.ts`).

**Refuted by code + live retest — not bugs, no fix made**:
- Disbursement never reaching CFO after CEO sign-off — `createLoanFromApplication`
  correctly creates the loan as `pending_disbursement`, and the CFO's
  disbursement queue is tenant-wide, not scoped to who approved. Could not
  reproduce.
- Rejected applications not changing state — `decide()` correctly sets
  `status='rejected'`; confirmed live, the Applications list and detail
  page both show "Rejected" clearly. If this was about the Book/Loans
  page: that's expected — no loan is ever created for a rejected
  application, so there's nothing to show there.
- Applications page not showing pending applications — it already lists
  everything by default (no status filter applied); confirmed live, 14 of
  14 applications shown across all statuses.
- Car/development/advance exclusion "too restrictive" — the exclusion
  rule (car ↔ development mutually exclusive, advance compatible with
  either) exactly matches the MUA benefit scheme documented at the start
  of this project. Looks correct as configured.

**Needs your input before I touch anything**:
- [x] `RESOLVED — wording, not policy` — user confirmed the policy is
      correct as configured ("advance gives you one [multiple] of your
      salary and you pay it in 3 months") — matches `cap_multiple=1`,
      `max_tenor_months=3` exactly. The real issue was the apply flow's
      product card showing "up to 3 mo" as an isolated badge, disconnected
      from the amount below it — read like an arbitrary restriction
      instead of "how long you get to repay what you borrow." Fixed:
      `apply-form.tsx` now shows amount + term as one sentence ("Up to UGX
      4,000,000, repaid over up to 3 months"). No lending policy touched.
- [x] `INVESTIGATED — no bug found` — "Staff loan computation bug":
      user confirmed this means Salary Advance. Checked three ways: (1)
      the eligibility cap formula (`salary_multiple`, 1x gross — correct),
      (2) the amortization engine's zero-interest path in
      `computeInstalment`/`generateSchedule` (principal divides evenly
      across tenor, last instalment absorbs the rounding remainder, closes
      at exactly zero — correct), (3) all 4 real seeded Salary Advance
      loans' actual schedule_lines, hand-checked against gross salary and
      principal — all correct, zero interest, closes at zero, within the
      1x-gross cap. Could not find a bug. Need a specific example (an
      actual application/loan where a number looked wrong) to go further.
- [x] `REFUTED — live-verified` — Applicant can't track application
      status: logged in as staff@testco.io, who has 2 in-flight
      applications (Salary Advance, Development Loan). Dashboard showed
      "Dept Head stage" for both; cross-checked directly against the DB
      (`approvals` table) — zero decisions recorded on either application,
      so "awaiting dept head" (the first stage) is exactly correct for
      both. The status label is computed live from real routing state, not
      stale or hardcoded. No bug found.

**Follow-up worth doing, not bundled into this batch**:
- [x] `DONE` — Moved every authenticated page into a new `(app)/` route
      group with a shared `layout.tsx` that renders `Shell` once, instead
      of ~13 pages each computing an identical `user` object and
      re-rendering `Shell` themselves. Added `(app)/loading.tsx` — only
      possible now that Shell persists across navigation instead of being
      re-mounted per page. Verified live across every moved page (dashboard,
      applications list + detail, book, loans + loan detail, settings +
      employee directory, apply, analytics, reports, audit log) — sidebar/
      topbar persist correctly, no regressions. One real bug caught by the
      test suite along the way: a test's `vi.mock()` referenced the old
      pre-move path and had gone silently no-op, letting the real
      `server-only`-importing module load and fail in the jsdom test env.
- [x] `DONE` — The apply form's error handling fell back to a raw JSON
      response page on server errors (native form POST, not a
      fetch+inline-state pattern). Converted `/api/apply` to always return
      JSON (`{ok, error}` or `{ok, applicationId}`, no server-side
      `redirect()`), and the form now submits via `fetch` + `onSubmit`,
      showing errors inline (e.g. the duplicate-application guard's message)
      and navigating client-side (`router.push`) on success. Verified live:
      a successful submit lands on the new application's detail page, and
      re-submitting the same product while one is still in review shows the
      error inline with no page navigation.
- [x] `DONE` — Item #1 from the original batch ("use all skills including
      emilkowalski/skills to give our dashboards an animated and proper
      apple design"). Did not pull code from emilkowalski/skills or any
      third-party registry (same standing caution as the earlier `efferd.com`
      decision above) — used only code already in the repo plus the public
      npm registry. Audited all 8 role dashboards and found the visual
      language (card radii, borders, tiered soft shadows) was already
      consistent; the real gaps were no entrance motion anywhere in the
      dashboards themselves (only the welcome banner had it), an existing
      `CountUp` component wired into only one page, and inconsistent
      hover/depth treatment. Extended the same `animate-in fade-in
      slide-in-from-bottom-2 duration-500` pattern already used in
      `settings/page.tsx` to every dashboard section (staggered delays,
      top-to-bottom reveal); wired `CountUp` into every KPI number across
      all 8 dashboards and `book-breakup.tsx`; added `Metric`'s existing
      hover-lift to `dashboard-card.tsx` and the hand-rolled stat blocks
      that lacked it; gave the dept-head reject-reason field an eased-in
      transition instead of an abrupt swap. Along the way, fixed a real bug
      in `CountUp` itself — it animated from 0 on every mount instead of
      only on genuine value changes (its own doc comment said "on every
      change"), which also broke two existing test files
      (`dashboard-employee.test.tsx`, `dashboard-admin.test.tsx`) once
      wired in; and hit a Server/Client Component boundary violation
      (`format` was a function prop passed from server dashboards into the
      client `CountUp` — not serializable) — fixed by making `format` a
      string key (`"ugx" | "percent" | "days" | "integer"`) instead of a
      function, applied consistently including `analytics-view.tsx`'s
      pre-existing usage. Verified live logged in as CFO, HR, dept-head, and
      Employee (staggered entrance, count-up numbers, hover lift, reject
      field easing all confirmed with no console/server errors); CEO, COO,
      Admin, Auditor share the identical fix and are covered by
      `tsc --noEmit` and the full test suite (15/15 passing).

---

## Phase 1 — Dashboard & UI redesign

Source: *Wola Architectural Document*, §6.2 ("Re-scoped — Role Dashboards
with Layout Specification"). Core rule: **one hero per role, no two roles
share a hero shape**, secondary panels stay visually quiet, each role names
things its own way. Acceptance check = the squint test (blur two role
screens; their shapes must still differ).

- [ ] **1.0a — Copy pass** `NEW`
  User feedback: current wording across the app "is not so professional."
  Sweep labels/microcopy for tone once the visual pass (1.0) has settled the
  layout it sits inside — copy on a component that's about to be rebuilt is
  wasted work.

- [x] **1.0 — Global design-system pass** `VERIFIED — mostly already done`
  DECISIONS.md's own "NEXT SESSION" note flagged this as blocking *before*
  any per-role hero work. Checked line-by-line against `globals.css` today:
  - [x] One `@theme` block, single `--color-primary` — no duplicates/circular vars
  - [x] Elevation scale — `--shadow-theme-xs/sm/md/lg/xl`, 5 levels, applied via `.card`/`shadow-theme-*`
  - [x] Radius scale — `--radius-DEFAULT/lg/xl`, consistently referenced
  - [x] ONE table treatment — the `.ledger` class, reused everywhere (book, loans, reports, applications, decisions)
  - [x] Info/blue ramp — `50/100/200/500/600/700` defined; grepped every
        component for `info-300`/`info-400` and found **zero uses** — the
        gap DECISIONS.md flagged doesn't affect anything actually rendered,
        no fix needed
  - [x] Animation load — `analytics-view.tsx` had 10 staggered
        `animate-in fade-in slide-in-from-bottom-* duration-500 delay-*`
        entrances (up to a 500ms cascade on every page load) vs. 1-3
        elsewhere in the app. Reduced to a single `fade-in duration-300` on
        the whole view; kept the `CountUp` number animations and native
        recharts draw-in (purposeful, not decorative). Typechecked clean;
        **not yet visually verified in a running browser** — the dev stack
        needs docker (postgres/redis) per the README and DECISIONS.md notes
        this machine can only run one project's compose stack at a time, so
        I didn't spin it up unprompted. Worth a look next time the app is running.

- [x] **1.1 — CFO hero: money-operations console** `BUILT`
  Doc's #1 build priority.
  - [x] Disbursement queue — tenant-wide list of `pending_disbursement` loans,
        oldest first, inline `DisburseButton` per row ([reconciliation.ts](packages/db/src/reconciliation.ts)'s `disbursementQueue`)
  - [x] Reconciliation panel — this calendar month's expected payroll
        deductions (sum of due schedule instalments) vs. actual (`repayments`
        where `source='payroll'`), per-loan exceptions where actual falls
        short, each linking to the loan detail page to resolve
        (`reconciliationThisCycle`)
  - [x] Book metrics demoted to a compact 4-up row below the new hero, not above it
  - [x] Borrowed from the shadcn admin template per your request: a real
        `Progress` primitive ([ui/progress.tsx](apps/web/src/components/ui/progress.tsx), built on Radix — the
        library Wola already depends on, not the template's Base UI, to avoid
        a second headless-UI dependency) for the reconciliation collection bar
  - **RESOLVED by 1.5–1.8 below**: at the time this was written, `DashboardCFO`
    was still shared by every full-book role. It's now genuinely CFO-only —
    every other role has its own dashboard.

- [x] **1.2 — HR hero: employee register health** `BUILT`
  New [dashboard-hr.tsx](apps/web/src/components/dashboard-hr.tsx), backed by [hr-register.ts](packages/db/src/hr-register.ts)'s
  `registerHealth()`. Hero: headcount / on-probation / final-warning counts,
  plus a blocking-issues list (missing department head, missing salary —
  `gross_salary = 0` as the only available signal, schema has no NULL state)
  each with a "Fix →" link to the employee directory. HR-stage approval queue
  and application-status pipeline demoted to secondary panels below, per the
  doc's explicit rule (queue is NOT the hero here, unlike dept-head).
  Deliberately does **not** show book/exposure/interest/disbursement — HR is
  people, not money, per the doc's "must not show."
  - Wired in [page.tsx](apps/web/src/app/page.tsx): only `role === 'hr'` gets this hero; every other
    full-book role is untouched, still on the shared `DashboardCFO` — same
    staged approach as 1.1, not a blast-radius change.
  - **Scoped out, not silently skipped**: the doc's "stale probation status"
    blocker isn't implemented — there's no hire-date/probation-start column
    on `employees` to compute staleness from, and I didn't want to fake a
    heuristic. Would need a schema addition to do properly.
  - **Scoped out**: the doc's "if HR holds the administration capability, add
    the Configuration panel below" — Wola has no capability-grant system yet
    (Phase 3), so this doesn't apply; `hr` isn't in any `ADMIN_ROLES` check today.

- [x] **1.3 — Employee hero: position card** `BUILT`
  The doc claims this is "layout only, already supported by the
  employee-metrics layer" — that turned out not to be true on inspection:
  the old `employeeMetrics()` only had tenant-wide AGGREGATES (one outstanding
  number, one next-due date), not the per-loan breakdown, per-application
  approval STAGE, or eligibility PREVIEW the wireframe actually needs. Built
  those for real rather than fake the layout with data that doesn't exist:
  - New [employee-position.ts](packages/db/src/employee-position.ts): per-loan position (outstanding/progress/next
    deduction), applications-in-flight WITH current stage (reuses `routeApplication`
    from approvals.ts), and an eligibility preview reusing the exact same
    `assessEligibility` call `apply/page.tsx` already makes (no new eligibility logic)
  - [dashboard-employee.tsx](apps/web/src/components/dashboard-employee.tsx) rebuilt: outstanding balance is the
    biggest number on screen, loans stack compactly if there's more than one,
    applications-in-flight and eligibility sit as quiet secondary panels
  - `employeeMetrics()` (the old aggregate function) is now unused in the web
    app — left in place rather than deleted, since deleting exports isn't this
    task's job
  - Only fetched for `scope === 'own'` now (was unconditional before, on every
    dashboard load for every role) — a real perf fix that fell out of this

- [x] **1.4 — Dept-head hero: approval queue** `BUILT`
  Replaced the old approach (dept head got a department-scoped copy of the
  CFO dashboard, including a mini financial book the doc explicitly says a
  dept head must never see) with a real dedicated hero:
  - [dashboard-depthead.tsx](apps/web/src/components/dashboard-depthead.tsx): the worklist IS the hero — inline
    Approve/Reject per row, reusing `decideAction` (the same server action the
    full application page uses, so approval logic isn't duplicated). Reject
    expands a compact reason field in place rather than a `window.prompt` or a
    page navigation — the reason the queue exists is to clear it without leaving.
  - Secondary: own outstanding (shrunk), team active-loan count. No book,
    no mix, no pipeline — matches "must not show: other departments, the
    full book, disbursement, or reconciliation."
  - [page.tsx](apps/web/src/app/page.tsx): `inboxFor()` was already scoped by `canAct` to the head's own
    reports, so it doubles directly as the hero's data — no new query needed
    for the queue itself, only for the two secondary numbers. Net result is
    LESS code than the branch it replaced (five queries removed).

- [x] **1.5 — CEO dashboard** `BUILT`
  Was previously just `DashboardCFO` with the full money-ops console visible
  — a direct violation of the doc's "must not show: disbursement queue,
  reconciliation" for this role. New [dashboard-ceo.tsx](apps/web/src/components/dashboard-ceo.tsx): "Programme
  health" hero (exposure + value-under-management headline figures, each with
  the existing `FeaturedMetric` sparkline reused for the trend line), an
  "in progress / settled / rejected" strip, CEO-stage queue and product mix
  demoted to secondary. No disbursement, no reconciliation, no employee data.
  `ceoView.settled` needed one new small count query (not tracked anywhere
  else); everything else reuses data already computed for the page.

- [x] **1.6 — COO / other executive approvers** `BUILT`
  New [dashboard-coo.tsx](apps/web/src/components/dashboard-coo.tsx), routed for `coo`/`group_ceo` (the real
  enum values a pipeline stage resolves to — see MUA's own CEO-applying
  pipeline in `setup-mua-tenant.mjs`). Short queue + compact 4-up book row,
  no trend chart, no money operations — the lightest of the oversight
  dashboards per the doc. Reuses data already fetched for the page; no new query.
  An empty queue here is a normal state (this tenant's pipeline may not route
  through this role at all), not an error — same empty-state treatment as everywhere else.

- [x] **1.7 — Admin hero: configuration readiness checklist** `BUILT`
  New [config-status.ts](packages/db/src/config-status.ts) + [dashboard-admin.tsx](apps/web/src/components/dashboard-admin.tsx), routed for
  `org_admin`/`admin`. Checklist: products defined, every product has an
  approval pipeline, every interest-bearing product has a rate index (reuses
  the same signal `productsMissingRateIndex`-style check from Phase 3's rate-index
  work) — each with a done/not-done state and a "Configure/Set →" link when not.
  No approval queue anywhere on this dashboard, matching the doc's segregation-of-duties rule.
  - **Scoped out, not faked**: the doc's fourth checklist item, "disbursement
    channels set," has no backing concept anywhere in the schema (no
    bank/channel table). Rather than show a fabricated checked/unchecked
    state for something that doesn't exist, it's omitted entirely. Building
    it for real is a schema-level feature, not a dashboard task.

- [x] **1.8 — Auditor: read-only audit view** `BUILT`
  New [dashboard-auditor.tsx](apps/web/src/components/dashboard-auditor.tsx), routed for `auditor`. A recent-activity
  hero (same query shape as the existing standalone `/audit-log` page, capped
  tighter as a dashboard snippet) with a link to the full log, plus read-only
  links to the book/applications/approvals — no action control anywhere on
  the page, matching the doc's explicit design signal. The full `/audit-log`
  page already existed before this session; this gives auditor a proper
  landing dashboard instead of falling through to the CFO shell.

- [x] **1.10 — Cross-dashboard consistency pass** `BUILT`
  Prompted by user feedback that the dashboards "look all over the place"
  against two reference designs (clean KPI-row + defined-ratio panel grids,
  one consistent card treatment throughout). Audited all 8 dashboards for
  structural consistency, not just per-role hero distinctiveness:
  - [x] Added a page header (`Dashboard` + that role's own "one question"
        from the architecture doc, verbatim) to the top of all 8 dashboards —
        every OTHER page (Analytics, Reports, Book, Settings) already had this
        title+subtitle pattern; the new dashboards had jumped straight to
        content, which was a real, visible inconsistency.
  - [x] Fixed 3 real shadow/radius mismatches found by grepping every
        dashboard file for its card classes side by side:
        - [dashboard-employee.tsx](apps/web/src/components/dashboard-employee.tsx)'s empty state used `rounded-lg` + no
          shadow, while every other dashboard's empty state uses
          `rounded-xl` + `shadow-theme-sm` — now matches.
        - [dashboard-depthead.tsx](apps/web/src/components/dashboard-depthead.tsx)'s hero (the queue — the whole point of
          this dashboard) had no elevation of its own; its rows used the
          same `shadow-theme-sm` as the secondary panels below it, so hero
          and secondary read as equal weight. Wrapped it in the same
          `shadow-theme-md` treatment every other dashboard's hero gets.
        - [featured-metric.tsx](apps/web/src/components/featured-metric.tsx) (CEO's hero cards, its only remaining
          consumer) was `shadow-theme-sm` — bumped to `shadow-theme-md` for
          the same reason.
  - Confirmed by re-grepping: every dashboard now follows hero=`shadow-theme-md`,
    secondary=`shadow-theme-sm` with no exceptions.
  - **Not yet re-verified visually** — browser access was declined mid-session
    (permission prompt), so this pass relied on typecheck (clean) + the UI
    test suite (15/15 still passing) rather than a screenshot pass. Worth a
    visual check next time browser access is available.

- [x] **1.9 — Squint test pass**
  Every full-book role now has a structurally distinct hero: CFO = two-part
  money console, HR = data-quality checklist, CEO = headline figures + trend,
  COO = short queue + compact row, Admin = readiness checklist, Auditor =
  activity log, Dept-head = inbox worklist, Employee = personal balance card.
  No two share a shape. **Not yet visually verified in a running browser**
  (same caveat as the rest of this session — no docker stack up) — worth an
  actual squint-test pass next time the app is running with real data for
  each role.

---

## Phase 1.11 — Dashboard visual redesign v2 `NEW, not started`

User feedback (2026-09-10): current dashboard UI "is so lacking," and is
**not responsive above 1024px** — Phase 1's work (1.0–1.10) fixed structure
(one hero per role, squint-test distinctness) but not this. Scope, as given:

- [ ] Audit and fix responsiveness for large/desktop viewports (>1024px) —
      every dashboard, not just one. Check what actually breaks (stretched
      cards, wasted whitespace, fixed-width assumptions) before redesigning.
- [ ] Use the installed design skills (`ui-ux-pro-max` — styles, palettes,
      font pairings, chart specs, stack guidance) to inform the visual
      refresh, not just eyeball it.
- [ ] Animated welcome banner on the Overview/Dashboard page — user asked
      for this explicitly ("well animated"); scope the animation itself
      (entrance only vs. something ongoing) before building.
- [ ] Reference: user shared a dark-theme analytics dashboard screenshot
      ("Efferd" — KPI card row, line chart, donut chart, sparkline) as a
      style/layout reference — take inspiration from the *shape* (KPI strip,
      chart card grid, clean card treatment), not a literal copy; Wola's
      light forest-green theme is the existing convention, changing to dark
      would be a real design decision to confirm, not assume.
- **Explicitly declined**: user's message included step-by-step
  instructions to run `npx shadcn@latest add @efferd/dashboard-3/4/6` and
  register `https://efferd.com/r/{style}/{name}.json` as a shadcn
  component registry in `components.json`. Did not run this — `efferd.com`
  isn't a known/verifiable registry, and the `dashboard-6` variant's flow
  (look for an `EFFERD_REGISTRY_TOKEN` env var, else tell the user to buy
  "Efferd Pro" and paste a token into `.env`) has the shape of an untrusted
  source, not a legitimate component library. Rebuild the look with our own
  components + the official shadcn/ui registry instead, if shadcn pieces
  are wanted.

---

## Phase 1.5 — Bugs & access-control fixes (surfaced in review, 2026-08-26)

Not engine issues — dashboard wiring and RBAC. Listed separately so they
don't get lost inside the design-system work.

- [x] **Account creation was too widely permitted** `FIXED`
  `createAccountAction` in [employees-actions.ts](apps/web/src/app/settings/employees-actions.ts) let CFO/CEO/MD/COO/group_ceo
  create logins, not just admin-capability holders. Per the architecture doc's
  capability model (§6.2), "manage users" is an *administration* action —
  HR holds it by default, not every full-book role. Narrowed to
  `org_admin`/`hr` only (bulk import, record edits, and status changes stay
  on the broader HR set — those are employee-*data* maintenance, not
  account/credential creation, and the doc keeps that distinction).

- [x] **CFO gross-salary / principal wiring gap** `CHECKED LIVE — could not reproduce`
  Reported: CFO should see gross salary during approval; "principal was
  working properly... backend not communicating well with frontend."
  Logged in as CFO against real seed data and opened a real pending
  application: Gross salary and Take-home both render correctly in the
  header row, right next to the requested amount. Not marking this closed
  outright — if it's still happening, it's on a different page/state than
  what I checked; next step if it recurs is a screenshot of the exact spot.

- [x] `RESOLVED — Car + Development` **External-loan declaration scope**
  Confirmed (2026-09-13): this is a real, intentional scope change from
  the signed scheme documents, not a recollection mismatch — Development
  loan should require the same external-borrowings declaration as the Car
  loan going forward. Flipped `requires_external_declaration` to `true` on
  the `term` product for the `testco` tenant in both the production
  Supabase DB and local dev DB (data change, not a schema migration, same
  as the earlier Supabase RLS correction — `loan_products` config is
  per-tenant DATA per DECISIONS.md). Updated the two provisioning sources
  ([scripts/seed-dev.sql](scripts/seed-dev.sql), [scripts/setup-mua-tenant.mjs](scripts/setup-mua-tenant.mjs)) so future
  re-seeds stay correct. No code changes needed — the apply form and
  eligibility engine already key off this flag generically per product.
  Verified live: the "Declare outside borrowings" field now appears on
  the Development Loan card, same as it already did for the Car Loan.
  Note: only `testco` needed this — `mua` isn't provisioned in the
  production database (it doesn't exist there yet).

---

## Phase 2 — Amortization / loan-math engine

`packages/engine/src/amortization.ts` is tested to parity against MUA's real
spreadsheet. Progress:

- [x] Fixed the remaining `annual_rate` display sites — [book/page.tsx](apps/web/src/app/book/page.tsx) and
      [loans/page.tsx](apps/web/src/app/loans/page.tsx) were printing the raw stored fraction with a `%` suffix
      (a 16% loan showed "0.2%"). Also fixed [loans/[id]/page.tsx](apps/web/src/app/loans/[id]/page.tsx), whose header
      comment had gone stale and actively claimed the wrong storage
      convention ("stored as a PERCENT... ×100 bug fixed at the source") —
      comment corrected along with the code.
  - **Found a 4th site in live testing that this audit missed the first time**:
    [reports/page.tsx](apps/web/src/app/reports/page.tsx) had the exact same un-fixed bug, only surfaced once real
    seed data made it visibly wrong (showing "950.0%" on the Book page for a
    loan that should read 9.5%... but the Reports page showed that SAME loan
    correctly, which was the tell). Root cause turned out to be two bugs, not
    one: `reports/page.tsx` was an un-audited display site (fixed, ×100
    added), AND [scripts/seed-demo.mjs](scripts/seed-demo.mjs) was independently storing `annual_rate`
    as a percent instead of a fraction — its own copy of the same unit bug,
    desyncing demo data from what the real approval path (`resolveRate()`)
    actually writes. Fixed both and re-ran the seed; confirmed correct live
    (Book page now reads 16.5%, matching the CBR set via Settings).
- [x] Test coverage for the lump-sum re-amortization path — new
      [repayment_reamortization.test.mjs](packages/db/test/repayment_reamortization.test.mjs), run against a real database (see
      below): confirms a 3x-instalment payment triggers re-amortization, the
      new schedule version is actually persisted, and — the specific
      regression this pins — the re-amortized interest reflects the real 16%
      annual rate, not a rate silently divided by 100. **4/4 passing.**
- [x] Day-count / leap-year edge cases in `addMonths` — new tests in
      [amortization.test.mjs](packages/engine/test/amortization.test.mjs): the same "Jan 31 + 1 month" lands on Mar 2 in
      2024 (leap, Feb has 29 days) vs. Mar 3 in 2023 (Feb has 28), plus a
      monotonicity check across a schedule spanning a leap February.
      **3/3 passing** — confirms existing behavior is correct and pins it
      against a future regression.
- [ ] Restructuring / top-up flow — `loan_schedules.version` exists in the
      schema for this, but no restructure action is built. Not started.
- [x] `DONE` — Multi-currency was actually an unfinished feature, not just a
      verification task: `tenants.currency` (defaults `'UGX'`) has existed
      since migration 0001, and `amortization.ts` was already documented as
      currency-agnostic (`decimals` param), but neither was wired to
      anything — every loan was created with `decimals: 0` hardcoded, and
      the UI had 27 duplicated `const ugx = (n) => "UGX " + ...` helpers
      that never read the tenant's actual currency. Added
      [currency.ts](packages/engine/src/currency.ts) (`getCurrencyDecimals`/`formatMoney`, decimals resolved via
      `Intl`'s real ISO 4217 data with an explicit 0-decimal override for
      UGX/TZS/RWF — East African shillings/francs are dealt with as whole
      units in practice, per amortization.ts's own header comment, even
      though Intl reports TZS as 2). Added a per-request-cached
      `getTenantCurrency()` in [tenant.ts](apps/web/src/lib/tenant.ts) for Server Components;
      Client Components receive `currency` as a prop from their nearest
      Server Component ancestor (5 dashboard components — CFO/COO/CEO/HR/
      Employee — briefly became `async` Server Components calling this
      internally, but that broke `render()`-based unit tests, since React
      can't synchronously render an async component outside the Next.js
      RSC runtime; reverted to plain sync components taking `currency` as
      a prop from `(app)/page.tsx`, which already resolves the tenant
      once). Fixed `createLoanFromApplication` and the lump-sum
      re-amortization path (`packages/db/src/loans.ts`) to pass the
      tenant's real decimal count instead of a hardcoded 0. Left
      `admin/page.tsx`'s cross-tenant platform totals as UGX-labeled with
      an explicit comment — summing different tenants' currencies into one
      number has no honest single label without real FX conversion, which
      doesn't exist anywhere in this app; `admin/tenants/page.tsx`'s
      per-tenant table correctly uses each row's own currency instead.
      Verified: new engine tests (`getCurrencyDecimals`/`formatMoney`,
      4/4) and DB tests (a KES tenant's loan schedule genuinely carries
      2-decimal instalments, a UGX tenant's stays whole-number, 2/2);
      full suites green (78 DB + 16 web + 37 engine); live-verified by
      temporarily setting `testco`'s currency to KES — dashboard, all 3
      apply-flow steps, and the application detail page all correctly
      showed "KES 1,234,567.89"-style amounts (caught and fixed one real
      gap this way: the apply form's two input-prefix labels were still
      hardcoded "UGX" even after the display-formatting sweep) — then
      reverted the tenant back to UGX.

### Infrastructure fix that fell out of this work

Running the new DB test surfaced that `node_modules/@wola/db` and
`@wola/engine` were symlinked to drive **E:**, not **F:** (where the repo
actually lives) — almost certainly the cause of every "Cannot find module
'@wola/db'" error `tsc --noEmit` has shown all session, which I'd been
filtering out as a pre-existing/unrelated issue. Fixed with a plain `npm
install` from the repo root (regenerates the workspace symlinks); `tsc
--noEmit` is now **genuinely** clean, not just "no new errors."

---

## Live verification pass (2026-08-26)

Actually ran the app in a browser for the first time this session, against
`testco` (real seed data via `seed-dev.sql` + `seed-demo.mjs`), after being
asked directly why this hadn't happened yet — fair challenge; typechecks and
unit tests with mocked data are not the same as confirming the UI works.

**Two real, pre-existing environment bugs found and fixed, unrelated to any
code change this session:**
- [x] **Turbopack + Tailwind v4 broke every page (500 on `/login` and
  everywhere else)** `FIXED`. Next 16 defaults `next dev` to Turbopack; that
  combination fails to parse Tailwind v4's generated CSS ("Invalid dangling
  combinator in selector") — confirmed as a known upstream incompatibility,
  not anything in this repo's own CSS. Fixed by adding `--webpack` to the
  `dev` script in [apps/web/package.json](apps/web/package.json). This was breaking the app for
  **any** developer running `npm run dev` normally, dev server or not —
  worth flagging loudly since it would have blocked local development entirely.
- [x] **`WOLA_SINGLE_TENANT=mua` left set in `apps/web/.env.local`** `FIXED (local only)`.
  A leftover from an earlier demo (the file's own comment said "COMMENT THIS
  OUT after the demo"), never cleaned up — it pins EVERY request to a `mua`
  tenant that doesn't exist in this local database, so all local multi-tenant
  dev/testing was silently broken regardless of subdomain. Commented out
  locally. **This is a `.env.local` change, not committed** (the file is
  gitignored) — flagging here so it isn't lost, and so whoever set it
  intentionally for `mua`-specific testing knows it's now off.

**What got actually clicked through and confirmed working**, not just typechecked:
- All 8 role dashboards (CFO, HR, CEO, COO, Admin, Auditor, Dept-head,
  Employee) — logged in as each of `cfo`/`hr`/`ceo`/`coo`/`org_admin`/`auditor`/
  `head`/`staff`@testco.io, confirmed each hero is genuinely a different shape
  with real seeded data, not placeholder content.
- The rate-index warning (Settings) — reproduced the real "2 products missing
  a rate index" state live, then set CBR to 16.5% through the UI and watched
  the warning clear and both products repoint.
- The applications/[id] decision flow, end to end: approved the HR Manager's
  Staff Car Loan as CFO (with the `startDate` field I added earlier), watched
  it advance to the CEO stage, and confirmed a real notification landed in
  `email_outbox` for `ceo@testco.io`. Separately rejected an application as
  dept-head using the inline reason field, confirmed the applicant got a
  real rejection email.
- The applications/[id] page's Gross salary / Take-home fields — the item
  parked earlier as "needs investigation" — render correctly and are clearly
  visible in the header row. Could not reproduce whatever was reported;
  worth asking for a screenshot of the exact page/state next time it comes up.
- The super-admin portal end to end: bootstrap script → `/admin/login` →
  Overview (real cross-tenant totals across 23 seeded tenants) → Tenant
  Registry → Audit Logs (correctly merged and attributed across tenants,
  including rows from the automated test suite itself).
- Confirmed the documented "known minor gap" from the super-admin section is
  real: `/admin/login` is reachable from `testco.local`, not just the apex
  domain, exactly as flagged.

**Still not done**: a systematic pass checking every page at mobile/tablet
widths, dark mode (if in scope), and the remaining pages not touched this
session (reports, analytics, book, loans list, employee directory forms).
This pass was breadth (does every built-this-session piece actually render
and function), not a full visual QA sweep.

---

## Testing infrastructure (new this session)

`apps/web` had zero test infrastructure before this. Set up **Vitest +
React Testing Library** (jsdom, no browser) for component-level tests —
chosen over Playwright e2e to match the codebase's lean-tooling preference
(no browser binaries, no running app/DB required to run them).

- [vitest.config.ts](apps/web/vitest.config.ts) / [vitest.setup.ts](apps/web/vitest.setup.ts) — `npm run test` / `npm run test:watch` in `apps/web`
- 3 component test suites, 15 tests, all passing:
  - [rate-index-editor.test.tsx](apps/web/src/components/__tests__/rate-index-editor.test.tsx) — validation (rejects negative rates without
    calling the server action), the missing-rate-index warning naming the
    right products, success/error paths
  - [dashboard-employee.test.tsx](apps/web/src/components/__tests__/dashboard-employee.test.tsx) — empty state vs. populated hero, outstanding
    balance is the biggest number, multiple loans stack rather than collapse,
    eligibility renders as an amount not a bare pass/fail
  - [dashboard-admin.test.tsx](apps/web/src/components/__tests__/dashboard-admin.test.tsx) — checklist done/not-done states, and the
    segregation-of-duties rule (no approval queue ever renders on this dashboard)
- **What this is NOT**: full UI coverage. Three components got tests because
  they're new/high-risk from this session's work, not because the other
  dashboards don't need it too — CFO/HR/CEO/COO/Dept-head/Auditor dashboards
  and every server action in `actions.ts` files are still untested at the
  component/UI level. Pick these up incrementally as they change, same
  discipline as the rest of this list.
- **"The connection"**: interpreted as verifying the DB layer server actions
  actually call is correct — that's what `packages/db/test/*.test.mjs`
  already does (58 tests, real Postgres, RLS-adversarial). What's NOT covered
  yet is the `actions.ts` wrapper layer itself (role-gating, `redirect()`,
  `revalidatePath()`) — Next.js server actions are awkward to unit-test in
  isolation; if that layer needs direct coverage later, worth a deliberate
  look rather than bolting it onto this pass.

---

## Phase 3 — Backend/product gaps (from the architecture-doc review)

- [x] Rate index configuration (Settings → Administration) — built earlier this session
- [x] **Approval-decision notifications** `BUILT` — the exact legacy pain point
      `Wola.pdf` names ("no notification system built into the old one").
      New [notifications.ts](packages/db/src/notifications.ts), wired into `decide()` in [approvals.ts](packages/db/src/approvals.ts),
      enqueuing (never sending inline — same outbox pattern as everything
      else) at every transition, in the SAME transaction as the decision:
      - Advance to the next stage → the next approver(s) only. `dept_head`
        resolves to the applicant's specific head (a person); every other
        stage role broadcasts to everyone currently holding that role in the tenant.
      - Final approval → the applicant, every CFO, every HR, and the
        department head (if any) — matches `Wola.pdf`'s described flow exactly
        ("share a notification to the CFO, HR, Department head and the employee").
      - Rejection → the applicant, with the reason.
      - New [notifications.test.mjs](packages/db/test/notifications.test.mjs) (5 tests, real DB, RLS-checked) proves each
        transition enqueues exactly the right recipients — not just that
        `sendEmail` was called.
      - **Scoped out**: disbursement and repayment don't send notifications
        yet — the doc only names the approval flow explicitly; extending to
        those is a small follow-on using the same `notifications.ts` pattern,
        not a new design.
- [x] **Invite / set-password flow** `BUILT` — replaces the temp-password
      stopgap in `createAccountAction` (which generated a password and made
      HR relay it out-of-band by voice/chat — effectively permanent, since no
      reset flow existed yet at the time it was written).
      - New migration [0013_invitations.sql](packages/db/migrations/0013_invitations.sql) + [invitations.ts](packages/db/src/invitations.ts): single-use,
        time-limited (7d) token, only its hash stored — same security shape as
        `password_resets`. Not RLS-scoped (same reasoning as sessions/password_resets:
        looked up by bare token before any tenant context exists); the
        membership/employee-link writes it makes on acceptance run inside a
        real `tenantTx`, per DECISIONS.md's auth-query rule.
      - Two acceptance paths, both real: a brand-new email sets its own
        password ([accept-invite](apps/web/src/app/accept-invite/page.tsx) page, mirrors `reset-password`'s form/redirect
        pattern, including the Next 16 "don't `redirect()` inside the action
        or the cookie gets dropped" gotcha); an email that already has a Wola
        account elsewhere (users are global) just confirms joining — no second
        password, no duplicate identity — and keeps its existing one.
      - `createAccountAction` now creates an invitation and emails a link via
        the existing outbox, instead of generating/displaying a password.
        [create-account-button.tsx](apps/web/src/components/create-account-button.tsx) updated to match ("Invitation sent to
        X" instead of a password to copy).
      - `login()`'s session-issuing logic extracted into `createSession()` in
        [lib/auth.ts](apps/web/src/lib/auth.ts) and reused by accept-invite — accepting an invite logs you
        straight in, same as the doc's "only then is the account active" implies.
      - New [invitations.test.mjs](packages/db/test/invitations.test.mjs) (5 tests, real DB): issuing, refusing to invite
        an employee who already has a login, expired/replayed/unknown tokens
        all rejected, both acceptance paths (including proving the
        cross-tenant case reuses the SAME user id and leaves the existing
        password untouched).
      - **Scoped out**: the doc's "first super-admin: one-time deployment
        seeding step" and "super-admins invite one another" — no super-admin
        surface exists at all yet (that's its own Phase 3 item below); this
        pass covers tenant-level invites (HR/admin inviting staff) only.
- [x] **Super-admin portal** `BUILT` (3 of 6 doc tabs — see scope notes)
  - New migration [0014_super_admin.sql](packages/db/migrations/0014_super_admin.sql): `super_admins` (a flag on the SAME
    global `users` identity every tenant login uses — the doc's own
    correction, no separate hardcoded credentials) + `super_admin_sessions`
    (mirrors `sessions`, not tenant-pinned, not under RLS — same reasoning as
    `sessions`/`password_resets`/`invitations`).
  - [super-admin.ts](packages/db/src/super-admin.ts): credential check, plus three cross-tenant aggregation
    functions. **Deliberately do NOT use a bypass-RLS role** — every query
    loops over tenants (from the unprotected `tenants` table) through a real
    `tenantTx` per tenant, on the same `wola_app` connection everything else
    uses. DECISIONS.md is explicit that `wola_app` having no `BYPASSRLS` is
    what makes a query bug harmless tenant-wide; I was not going to
    unilaterally introduce an elevated credential into the app runtime just
    to make this dashboard's queries simpler — that's a real security-posture
    change, not a judgment call for me to make alone. Trade-off: N queries
    for N tenants, not one — fine at the tenant counts this platform is
    actually at, same shape as the already-accepted N+1 in `inboxFor()`.
  - Own session/guard/shell, entirely separate from the tenant app's
    (`super-admin-auth.ts`, `super-admin-guard.ts`, `super-admin-shell.tsx`)
    — this surface sits outside the tenant model, not inside it with a
    special role.
  - Three pages built: **Overview** (cross-tenant totals), **Tenant
    Registry** (every tenant, plan/status/loan volume/onboarding date),
    **Audit Logs** (merged, sorted, capped activity across every tenant).
    Login at `/admin/login`.
  - New [scripts/onboard-super-admin.mjs](scripts/onboard-super-admin.mjs) — the doc's own named chicken-and-egg step
    ("first super-admin: one-time deployment seeding"), mirrors
    `onboard-tenant.mjs`'s idempotent-upsert shape. Ran it for real against
    the local stack to confirm it actually works, not just typechecks.
  - New [super_admin.test.mjs](packages/db/test/super_admin.test.mjs) (8 tests, real DB) — auth (active/disabled/wrong-role/
    rate-limited), and the aggregation functions proven with delta/lookup
    assertions rather than exact global counts, since these functions are
    deliberately global and the test database is shared with every other
    concurrently-running test file (documented in the test file's own header).
  - **Scoped out, not built**: User Management (inviting/suspending other
    super-admins — no invite-a-super-admin flow yet, only the bootstrap
    script) and Tenant Ledger/Billing (no billing system or concept of
    "what a tenant owes" exists anywhere in the schema — building it would be
    fabricating data, not a dashboard task). Both match the doc's own
    "intentionally lean" framing for this surface — picked the 3 tabs with
    real oversight value, not the 6 for completeness.
  - **Known minor gap**: `/admin/*` isn't restricted to the apex domain —
    routing doesn't stop it from also rendering on a tenant's own subdomain
    (e.g. `sometenant.wola.africa/admin`). Not a security hole (fully
    separate credential/session system, no tenant data touched insecurely),
    just an availability inconsistency with the doc's "one dedicated
    surface" framing. Would need a `proxy.ts`-level check to close.
- [ ] `DECISION NEEDED` (from the doc): is MFA in scope for v1, at least for finance/admin roles?

---

## How to use this file

- Pick ONE unchecked item, confirm scope if it says "pending your priority
  call," then work it to done before starting the next.
- Check items off in the same commit/session that finishes them.
- If a new gap surfaces mid-work, add it under the right phase rather than
  fixing it silently — that's what makes this "systemic."
