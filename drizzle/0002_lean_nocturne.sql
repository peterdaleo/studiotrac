CREATE TABLE `email_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientEmail` varchar(320) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`body` text,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`relatedProjectId` int,
	`relatedTaskId` int,
	CONSTRAINT `email_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`emailAddress` varchar(320) NOT NULL,
	`deadlineAlerts` boolean NOT NULL DEFAULT true,
	`overdueAlerts` boolean NOT NULL DEFAULT true,
	`statusChangeAlerts` boolean NOT NULL DEFAULT false,
	`alertDaysBefore` int NOT NULL DEFAULT 3,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_preferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`uploadedById` int,
	`fileName` varchar(500) NOT NULL,
	`fileKey` varchar(1000) NOT NULL,
	`url` text NOT NULL,
	`mimeType` varchar(255),
	`fileSize` int,
	`category` enum('drawing','specification','correspondence','photo','contract','other') NOT NULL DEFAULT 'other',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_files_id` PRIMARY KEY(`id`)
);
