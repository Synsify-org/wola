# MUA Insurance Uganda: what we need to settle in the meeting

Bring `onboarding-data\mua\review.md` (it has the names; this page deliberately has none). Each item says
what Wola does **today**, what we recommend, and a box to record the decision.

## 1. Who approves the CEO's own loans? (the "group CEO" question)

**Today.** Nobody may approve their own loan, so when the CEO applies, the CEO's step is replaced:
a Salary Advance goes HR -> CFO -> COO; a Development or Car loan goes HR -> CFO -> COO -> **group CEO**.
The last step needs a person who holds the `group_ceo` role in MUA's Wola. At the moment nobody does.

**What happens until it is settled.** The CEO's Salary Advance works. The CEO's Development or Car loan
would reach the last step and wait there. Nothing else is affected. Wola shows this: the administrator's
dashboard says "Nobody holds the Group CEO role, so Development Loan, Staff Car Loan (when the CEO applies)
will wait at that step", with an **Invite** button.

**Options.**
- **(a) Recommended:** invite the person who really signs off the CEO's loans (the group's CEO, the board
  chair, or a nominated director) as `group_ceo`. They do not need to be an employee: Settings -> Roles & access ->
  Invite -> role *Group CEO*, "Not an employee". Works today, no software change. Note that this role can see the
  whole organisation's loans; if that is too much for a director, say so and we will discuss a narrower role.
- **(b)** There is genuinely nobody above the CEO: end the CEO's route at the COO (Settings -> Approval routing).
  Not recommended, because the CEO's loan is then approved by people who report to the CEO. If MUA chooses it,
  record that decision here.
- **(c)** A board approval committee (several directors, any one of whom may approve). Not built; it is a new
  role and rule. Worth building only if MUA asks.

**Decision:** ______________________  **Who:** ______________________  **Date:** ________

## 2. Pay and probation status

Wola does not need the client to send pay data to us. MUA's **HR (or the administrator) types it in** inside
Wola (Settings -> Employees -> Fill in details), and every change is recorded. Agree:
- Who at MUA does it, and by when? ______________________
- Gross and net are **monthly**; net is take-home after tax and statutory deductions. Confirm the definition.
- Is "past probation" the same for everyone's contract? How is the end of probation recorded today?

## 3. Work emails

Needed so each person can be invited. Typed in by HR or an administrator (same screen), or supplied in a list.
- Do all 47 staff have a work email? Anyone who does not (drivers, support staff) needs another way, or no login.

## 4. Records the staff list left unclear (details in review.md)

| Item | What we did | Decision |
| --- | --- | --- |
| One person has **no employee number** | Loaded as `TEMP-001`; HR is warned on the dashboard until the real number is entered | Real number: ________ |
| One person's **line manager is a job title** that matches nobody on the list | No department head set; flagged on the HR dashboard | Who is it (or is the post vacant)? ________ |
| One person has **two managers and two departments** | Loaded under the first of each; flagged on the HR dashboard | Which department? Which manager approves their loans? ________ |
| The **CEO has no department** | Entered as "Executive" | Confirm ________ |
| One job title looks **misspelled** | Imported as written | Correct spelling ________ |

## 5. Interest rates

The Development and Car loans charge interest. The rate is set in Settings -> Loan products by the
administrator; Wola does not invent one.
- Follows the central bank rate (plus or minus a margin) or a fixed rate? Which number, who updates it, and how often?

**Decision:** ______________________

## 6. Running loans

If staff already have loans: send the spreadsheet (borrower, product, principal, rate, start date, term, repaid so
far). Wola's total outstanding must equal MUA's own figure to the shilling before the pilot starts. There is no
loans import yet; we build it from MUA's real file. When can they send it? ________

## 7. The pilot ([PILOT.md](PILOT.md))

Which payroll cycle runs in parallel? Who is the finance contact and the HR contact? What is the agreed number
of working days for an application to complete? The success tests are fixed in advance and do not change after the start.

## 8. Open policy questions ([POLICY_DECISIONS.md](POLICY_DECISIONS.md))

Who sees an applicant's amount; interest-rate disclosure; what happens to a loan when someone leaves; where the
loan capital comes from; identity checks. Also the data-protection agreement ([DPA_TEMPLATE.md](DPA_TEMPLATE.md)).

## 9. Who is MUA's administrator?

A named MUA person (not Wola staff) with a work email. They receive the first invitation, set up two-step
sign-in, and later invite everyone else. **Name and email:** ______________________
