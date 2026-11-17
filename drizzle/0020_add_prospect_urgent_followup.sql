-- Existing prospects remain non-urgent; the marker is independent of scheduled dates.
ALTER TABLE prospects
  ADD COLUMN urgentFollowUp boolean NOT NULL DEFAULT false,
  ALGORITHM=INSTANT;

-- Application rollback: revert the release commit and leave this additive column in place.
-- Do not drop the column; retaining it preserves user choices for a later re-release.
