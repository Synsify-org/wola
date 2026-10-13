# Moving from spreadsheets to Wola: the plan

Phase 4. Goal: a customer keeps their spreadsheet **running in parallel for one
payroll cycle**, sees Wola agree with it to the shilling, and only then switches.

## What exists today

| Step | Tool | Status |
| --- | --- | --- |
| Load staff (name, department, salary, reporting line) | Employee import (CSV, Settings -> Employee directory) | Built. Re-running refreshes salaries, so it doubles as the payroll refresh. |
| Create logins | Invitations (HR or administrator) | Built. People set their own passwords. |
| Define products, limits, rates, approvers | Settings -> Loan products / Approval routing | Built. |
| Load **existing running loans** | Not built | **Gap.** Needs a loans import: borrower, product, principal, rate, start date, tenor, amount already repaid. |
| Compare Wola to the spreadsheet | Reports (loan register CSV) vs. the customer's sheet | Built; compare by employee number. |

## Plan

**Week 0, before anything:** get a copy of the live spreadsheet and one month of
payroll deductions. Decide which is the source of truth during the pilot (the
spreadsheet; Wola must match it).

1. **Staff.** Import the employee list. Check Settings -> Employee directory shows
   no "missing department head" or "missing salary" warnings.
2. **Products.** Recreate each loan type exactly as the spreadsheet treats it (limit
   rule, longest term, interest on/off, rate). A product that doesn't reproduce the
   spreadsheet's numbers is the first thing to fix.
3. **Running loans.** For each loan, record: employee number, product, principal,
   annual rate, start date, tenor, repaid to date. *This needs the loans import; build
   it only for the pilot customer, from their real file.*
4. **Reconcile the opening position.** Wola's loan register total outstanding must
   equal the spreadsheet's total to the shilling, loan by loan. Differences are
   written down and explained *before* the cycle starts, not discovered after.
5. **Run one payroll cycle in parallel.** Export Wola's expected deductions; compare
   with the spreadsheet's. After payroll, record or import what was actually
   deducted. **Success** = the two systems agree on every loan, or every difference
   has a named cause.
6. **Cut over** only after the cycle reconciles. Keep the spreadsheet read-only for
   one more cycle as a safety net.

## Risks to say out loud
- Rounding: agree up front whether instalments round to whole shillings and who
  absorbs the last-instalment difference.
- Back-dated payments: decide how a payment received after the cut-off is dated.
- People with several loans: confirm which is repaid first.
