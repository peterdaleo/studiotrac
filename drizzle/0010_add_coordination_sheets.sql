-- Coordination Sheets: shared, no-login-required pages for project coordination with external consultants

CREATE TABLE IF NOT EXISTS `coordination_sheets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `organizationId` int,
  `projectId` int NOT NULL,
  `token` varchar(128) NOT NULL,
  `projectName` varchar(500) NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdById` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `coordination_sheets_id` PRIMARY KEY(`id`),
  CONSTRAINT `coordination_sheets_token_unique` UNIQUE(`token`)
);

CREATE TABLE IF NOT EXISTS `coordination_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sheetId` int NOT NULL,
  `parentId` int,
  `authorName` varchar(255) NOT NULL,
  `authorType` enum('project_lead','architectural','structural','civil','mechanical','plumbing','landscaping','other') NOT NULL DEFAULT 'other',
  `content` text NOT NULL,
  `isUrgent` boolean NOT NULL DEFAULT false,
  `isAddressed` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `editedAt` timestamp NULL,
  CONSTRAINT `coordination_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `coordination_attachments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `itemId` int NOT NULL,
  `type` enum('image','link') NOT NULL DEFAULT 'link',
  `url` varchar(2048) NOT NULL,
  `fileName` varchar(500),
  `fileKey` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `coordination_attachments_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `coordination_subscribers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sheetId` int NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(255),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `coordination_subscribers_id` PRIMARY KEY(`id`),
  CONSTRAINT `coordination_subscribers_sheet_email_unique` UNIQUE(`sheetId`, `email`)
);
