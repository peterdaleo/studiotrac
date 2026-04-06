CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`type` enum('deadline_approaching','task_overdue','status_change','general') NOT NULL DEFAULT 'general',
	`title` varchar(500) NOT NULL,
	`message` text,
	`isRead` boolean NOT NULL DEFAULT false,
	`relatedProjectId` int,
	`relatedTaskId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`authorId` int,
	`content` text NOT NULL,
	`isClientVisible` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(500) NOT NULL,
	`clientName` varchar(500),
	`address` text,
	`projectManagerId` int,
	`status` enum('on_track','on_hold','delayed','completed') NOT NULL DEFAULT 'on_track',
	`phase` enum('pre_design','schematic_design','design_development','construction_documents','bidding_negotiation','construction_administration','post_occupancy') NOT NULL DEFAULT 'pre_design',
	`completionPercentage` int NOT NULL DEFAULT 0,
	`startDate` timestamp,
	`deadline` timestamp,
	`billing25` boolean NOT NULL DEFAULT false,
	`billing50` boolean NOT NULL DEFAULT false,
	`billing75` boolean NOT NULL DEFAULT false,
	`billing100` boolean NOT NULL DEFAULT false,
	`billingOk` boolean NOT NULL DEFAULT false,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`assigneeId` int,
	`title` varchar(500) NOT NULL,
	`description` text,
	`status` enum('todo','in_progress','done','overdue') NOT NULL DEFAULT 'todo',
	`priority` int NOT NULL DEFAULT 10,
	`sortOrder` int NOT NULL DEFAULT 0,
	`deadline` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`title` varchar(255),
	`avatarColor` varchar(20) DEFAULT '#6366f1',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_members_id` PRIMARY KEY(`id`)
);
