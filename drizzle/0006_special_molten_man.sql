CREATE TABLE `time_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`taskId` int,
	`description` varchar(500),
	`startTime` timestamp NOT NULL,
	`endTime` timestamp,
	`durationMinutes` int NOT NULL DEFAULT 0,
	`billable` boolean NOT NULL DEFAULT true,
	`phase` enum('pre_design','schematic_design','design_development','construction_documents','bidding_negotiation','construction_administration','post_occupancy'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `time_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `estimatedHours` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_members` ADD `billingRate` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_members` ADD `weeklyCapacityHours` int DEFAULT 40 NOT NULL;