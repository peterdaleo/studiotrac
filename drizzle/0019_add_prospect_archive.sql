-- Reversible prospect archiving. Existing rows remain active with archivedAt = NULL.
ALTER TABLE prospects
  ADD COLUMN archivedAt timestamp NULL DEFAULT NULL,
  ALGORITHM=INSTANT;
-- Application rollback: revert the release commit and leave this additive column in place.
-- Do not drop the column; retaining it preserves archive state for a later re-release.
