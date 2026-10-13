# Decisions only you (and your pilot customer) can make

Phase 4 of the roadmap. Each row says what Wola does **today** (read from the
code, so you can trust it), the options, a recommendation, and a box to record
the decision. Nothing here is legal advice; items tagged **[verify]** need a
Ugandan lawyer.

## 1. Who sees an applicant's amount?

**Today.** An approval stage sees the application when it is that stage's turn.
Beyond that, visibility follows role scope (`apps/web/src/lib/guard.ts`):

| Role | Sees applications and loans of |
| --- | --- |
| Employee | themselves only |
| Department head | their direct reports (and themselves) |
| HR, CFO, CEO, COO, group CEO, administrator, auditor | the whole organisation |

So a department head sees amounts for their own team (they are an approver);
HR sees every amount (they verify employment and eligibility).

**Decide:** is it acceptable that a department head sees how much each report
borrowed, including *after* they approved it? **Options:** (a) as today; (b) hide
amounts from department heads once their stage is done; (c) show the department
head only a yes/no eligibility, never the amount.
**Recommendation:** (a) for the pilot (it is how paper approval already works), then
ask staff.
**Decision:** ______________________  **Date:** ________

## 2. Interest-rate disclosure

**Today.** The apply form shows each product's current yearly rate *before* the
person applies; the rate is fixed at submission and frozen for the life of the loan
(`eligibility_snapshot.annualRate`, `loans.annual_rate`). A later CBR change never
reprices a running loan or an application already in review.
**Decide:** is a rate shown to staff as "x% a year" enough, or does your policy
require a full repayment schedule or total cost of credit before they apply?
**[verify]** whether consumer-credit disclosure rules apply to staff loans.
**Recommendation:** add "total repayable" to the apply form (the engine already
computes the schedule), regardless of the legal answer; it prevents arguments later.
**Decision:** ______________________  **Date:** ________

## 3. A person leaves mid-loan

**Today.** Marking an employee "exited" never changes or writes off a loan. By
default (policy `recover_balance`) it opens a request to pay off the whole balance for
each running loan; finance sees it on the Payroll screen and records the money when it
arrives (option (a) below, as a request, nothing automatic). An organisation that wants
to handle exits by hand can set `loanExit.policy` to `manual` (no settings screen yet;
set in the database). Options (b)-(d) are not built: they need your decision first.
**Options:** (a) recover the full balance from final pay; (b) recover what final pay
covers and keep the rest running under a written agreement; (c) write off small
balances below a threshold; (d) the employer decides case by case.
**Recommendation:** (a) with (b) as the exception, approved by the CFO, recorded in
the loan's history. **[verify]** that deducting a loan balance from final pay is
lawful under the Employment Act and your contracts.
**Decision:** ______________________  **Date:** ________

## 4. Where does the loan capital come from?

Wola records and calculates; it does not hold or move money.
- Who funds the loans: the employer's own cash, a staff SACCO, a bank line?
- Who carries a default: the employer, the fund, or is it recovered from the borrower
  only (payroll deduction is the security)?
- What is the maximum total exposure at any time (the CFO will ask for the number)?
- What is the approval limit per person and in total?

**Decision / numbers:** ______________________  **Date:** ________

## 5. Identity checks (KYC) on borrowers

**Today.** Wola holds no identity data: no national ID, no documents. An employee is
known to the lender by their payroll record (HR vouches for them), plus an optional
phone number and location they add themselves (Settings -> Your details).
**Why it is a decision, not a form.** Storing national IDs or document images makes
Wola a holder of sensitive personal data: it changes the DPA, retention, breach duties
and the answer to "who can see this". For salary-deducted staff loans the employer's
record is usually the identity check; KYC matters more if you lend to non-employees or
the regulator for your customer's licence requires it.
**Options:** (a) none: payroll record is the check (today); (b) HR confirms identity
once and the system records only "verified by HR on <date>", no document stored;
(c) full capture: ID number and document upload, with retention and access rules.
**Recommendation:** (a) now, (b) if a customer asks for an audit trail of the check.
Do (c) only for a customer who requires it in writing. **[verify]** the data-protection
rules for your pilot's country (Uganda: Data Protection and Privacy Act, 2019).
**Decision:** ______________________  **Date:** ________
