-- ─────────────────────────────────────────────────────────────────────────────
-- studioTrac: Billing Milestone Notifications — Railway SQL Migration
-- Run this in Railway's MySQL query editor before deploying the new code.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `billing_department_emails` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `emailAddress` VARCHAR(320) NOT NULL,
  `createdAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
