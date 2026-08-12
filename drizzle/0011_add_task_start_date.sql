-- Add a nullable, date-only task start date. The task create service defaults new rows to today.
ALTER TABLE `tasks`
  ADD COLUMN IF NOT EXISTS `startDate` date NULL;

-- Preserve sensible timing for existing tasks while retaining nullable support for future edits.
UPDATE `tasks`
  SET `startDate` = DATE(`createdAt`)
  WHERE `startDate` IS NULL;
