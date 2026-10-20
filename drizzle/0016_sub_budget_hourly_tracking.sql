-- Additive sub-budget accounting: existing budgets remain fixed_amount and keep budgetCents unchanged.
-- Existing status values and defaults are preserved. The API explicitly approves new records.
ALTER TABLE project_sub_budgets
  ADD COLUMN trackingMode enum('fixed_amount','hourly') NOT NULL DEFAULT 'fixed_amount',
  ADD COLUMN notToExceedCents int NULL;

-- Application rollback: revert the release commit and leave both columns intact.
-- Do not drop columns: they preserve hourly/NTE data for a later re-release.
