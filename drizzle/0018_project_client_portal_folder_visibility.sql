-- Add per-project client-portal folder visibility.
-- New projects default to hidden; preserve existing behavior for projects that
-- already have a shared folder URL.
ALTER TABLE projects
  ADD COLUMN clientPortalFolderVisible boolean NOT NULL DEFAULT false,
  ALGORITHM=INSTANT;

UPDATE projects
SET clientPortalFolderVisible = true
WHERE driveFolderUrl IS NOT NULL AND driveFolderUrl <> '';
