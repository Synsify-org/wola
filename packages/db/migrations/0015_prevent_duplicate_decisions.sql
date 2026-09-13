-- 0015_prevent_duplicate_decisions.sql — close a race condition in decide().
-- decide() (approvals.ts) checks routing.state === 'pending' before INSERTing
-- a decision, then inserts. Two concurrent requests for the SAME stage (a
-- double-click, or a retry during the page-load lag users have reported) can
-- both pass that check before either INSERT lands, producing two approval
-- rows for one stage — and if it's the final stage, two loans for one
-- application. A unique constraint makes the second INSERT fail instead of
-- silently succeeding; decide() catches the resulting error (see approvals.ts)
-- and returns "already decided" rather than a raw DB error.
--
-- Safe to add: decide() only ever inserts 'approved'/'rejected' (validateDecision
-- rejects anything else), one row per stage per application — there is no
-- existing code path that legitimately writes two rows for the same
-- (application_id, stage_id).
BEGIN;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_one_decision_per_stage UNIQUE (application_id, stage_id);

COMMIT;
