-- Project billing types and dated billing-phase history.
-- Existing rows are classified from contractedFee so that projects with no
-- contract sum default to hourly and stop being evaluated as $0 fixed-fee jobs.
-- Projects that already have billing history are left untouched.

ALTER TABLE `projects`
  ADD COLUMN IF NOT EXISTS `billingType` enum('fixed_fee','hourly') NOT NULL DEFAULT 'fixed_fee';

ALTER TABLE `projects`
  ADD COLUMN IF NOT EXISTS `hourlyRateCents` int NOT NULL DEFAULT 0;

ALTER TABLE `projects`
  ADD COLUMN IF NOT EXISTS `notToExceedCents` int NOT NULL DEFAULT 0;

ALTER TABLE `projects`
  ADD COLUMN IF NOT EXISTS `revenueTargetCents` int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `project_billing_phases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `organizationId` int,
  `projectId` int NOT NULL,
  `billingType` enum('fixed_fee','hourly') NOT NULL,
  `startedAt` timestamp NOT NULL,
  `endedAt` timestamp NULL,
  `contractedFee` int NOT NULL DEFAULT 0,
  `hourlyRateCents` int NOT NULL DEFAULT 0,
  `notToExceedCents` int NOT NULL DEFAULT 0,
  `revenueTargetCents` int NOT NULL DEFAULT 0,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_billing_phases_id` PRIMARY KEY(`id`)
);

CREATE INDEX IF NOT EXISTS `idx_project_billing_phases_project`
  ON `project_billing_phases` (`projectId`, `startedAt`);

-- Classify only rows that still have the column default, no contract sum,
-- and no billing history yet. Existing fee-bearing projects stay fixed fee.
UPDATE `projects`
  SET `billingType` = 'hourly'
  WHERE (`contractedFee` IS NULL OR `contractedFee` = 0)
    AND (`billingType` IS NULL OR `billingType` = 'fixed_fee')
    AND `id` NOT IN (SELECT `projectId` FROM `project_billing_phases`);

UPDATE `projects`
  SET `billingType` = 'fixed_fee'
  WHERE `contractedFee` > 0
    AND (`billingType` IS NULL OR `billingType` = '')
    AND `id` NOT IN (SELECT `projectId` FROM `project_billing_phases`);

-- Seed one open billing phase per project that does not already have history.
INSERT INTO `project_billing_phases` (
  `organizationId`,
  `projectId`,
  `billingType`,
  `startedAt`,
  `endedAt`,
  `contractedFee`,
  `hourlyRateCents`,
  `notToExceedCents`,
  `revenueTargetCents`
)
SELECT
  `organizationId`,
  `id`,
  `billingType`,
  COALESCE(`startDate`, `createdAt`, CURRENT_TIMESTAMP),
  NULL,
  `contractedFee`,
  `hourlyRateCents`,
  `notToExceedCents`,
  `revenueTargetCents`
FROM `projects`
WHERE `id` NOT IN (SELECT `projectId` FROM `project_billing_phases`);
