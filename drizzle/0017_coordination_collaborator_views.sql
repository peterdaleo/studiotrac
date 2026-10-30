-- Additive, reversible coordination-sharing fields for isolated client/collaborator audiences.
-- Existing rows default to collaborator; known firm email addresses are resolved as team at send time.
ALTER TABLE coordination_sheets
  ADD COLUMN collaboratorToken varchar(128) NULL,
  ALGORITHM=INSTANT;

ALTER TABLE coordination_items
  ADD COLUMN isCollaboratorVisible boolean NOT NULL DEFAULT false,
  ALGORITHM=INSTANT;

ALTER TABLE coordination_subscribers
  ADD COLUMN audience enum('client','collaborator','team') NOT NULL DEFAULT 'collaborator',
  ALGORITHM=INSTANT;

-- Application rollback: revert the release commit and leave these additive columns in place.
-- Do not drop columns; retaining them preserves any collaborator settings for a later re-release.
