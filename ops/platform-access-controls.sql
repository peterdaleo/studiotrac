-- Reviewed additive schema artifact for approved platform access backend.
-- Apply manually only after backup verification; not run from this task.
-- Keep standalone: do not add to the auto journal or automatic startup path.
CREATE TABLE `firm_owner_invitations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenHash` varchar(64) NOT NULL,
  `email` varchar(320) NOT NULL,
  `firmName` varchar(255) NOT NULL,
  `createdById` int NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `acceptedAt` timestamp NULL,
  `revokedAt` timestamp NULL,
  `acceptedOrganizationId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `firm_owner_invitations_tokenHash_unique` (`tokenHash`),
  KEY `idx_firm_owner_invitations_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `organization_access_controls` (
  `organizationId` int NOT NULL,
  `state` enum('pending','active','suspended') NOT NULL,
  `complimentaryPlan` enum('starter','professional','enterprise') NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`organizationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `platform_access_audit` (
  `id` int NOT NULL AUTO_INCREMENT,
  `action` varchar(100) NOT NULL,
  `actorUserId` int NOT NULL,
  `organizationId` int NULL,
  `invitationId` int NULL,
  `reason` text NULL,
  `details` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_platform_access_audit_org_created` (`organizationId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
