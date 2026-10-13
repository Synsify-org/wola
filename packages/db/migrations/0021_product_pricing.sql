-- 0021_product_pricing.sql — how a product's interest rate is set.
--
-- Until now interest could only follow a rate index (e.g. BoU CBR) exactly:
-- rate = index value. Real staff-loan schemes also price as
--   * index + margin   (CBR + 2%, or CBR - 3% as a staff benefit), or
--   * a fixed rate     (12% flat, whatever the central bank does).
--
-- rate_mode:   'index' (follow rate_index_id, plus rate_margin)  | 'fixed'
-- rate_margin: percentage points added to the index; may be negative (a
--              discount). The effective rate is floored at 0 — a staff loan
--              never pays negative interest — see effectiveAnnualRate().
-- fixed_rate:  annual percent, used when rate_mode = 'fixed'.
--
-- Existing products are all 'index' with margin 0, i.e. unchanged.
BEGIN;

ALTER TABLE loan_products
  ADD COLUMN rate_mode   text NOT NULL DEFAULT 'index'
    CHECK (rate_mode IN ('index', 'fixed')),
  ADD COLUMN rate_margin numeric(6,3) NOT NULL DEFAULT 0
    CHECK (rate_margin BETWEEN -50 AND 50),
  ADD COLUMN fixed_rate  numeric(6,3)
    CHECK (fixed_rate IS NULL OR (fixed_rate >= 0 AND fixed_rate <= 100)),
  -- A fixed-rate, interest-bearing product must say what the rate is.
  ADD CONSTRAINT loan_products_fixed_rate_present
    CHECK (NOT (interest_applies AND rate_mode = 'fixed') OR fixed_rate IS NOT NULL);

COMMIT;
