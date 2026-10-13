-- 0020_stage_versioning.sql — approval stages become versioned, not mutated.
--
-- Until now the admin had no way to change a chain, so stage rows were
-- immutable by omission. Editing routing means a stage can leave a chain, but
-- approvals.stage_id points at it (and rejections/analytics/reports join
-- through it to say WHICH role decided). Deleting it would destroy history;
-- editing its role in place would silently rewrite who "approved" last year's
-- loans.
--
-- So a changed chain RETIRES its old stages and inserts new ones:
--   created_at  when the stage entered the chain
--   retired_at  when it left (NULL = live)
-- An application is routed by the stages that were live when it was SUBMITTED
-- (loadPipelines asOf), so a decided application keeps showing the chain that
-- actually decided it, whatever the chain is today.
--
-- (pipeline, position) can only be unique among LIVE stages, so the table
-- constraint becomes a partial unique index.
BEGIN;

ALTER TABLE approval_stages
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN retired_at timestamptz;

-- Every stage that exists today predates versioning: treat it as having been
-- live since before any application, so asOf lookups keep resolving old
-- applications to it.
UPDATE approval_stages SET created_at = TIMESTAMPTZ '2000-01-01 00:00:00+00';

ALTER TABLE approval_stages
  DROP CONSTRAINT approval_stages_tenant_id_pipeline_id_position_key;

CREATE UNIQUE INDEX approval_stages_live_position_key
  ON approval_stages (tenant_id, pipeline_id, position)
  WHERE retired_at IS NULL;

COMMIT;
