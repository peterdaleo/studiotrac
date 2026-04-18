CREATE TABLE `consultant_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(500) NOT NULL,
	`discipline` varchar(255) NOT NULL,
	`contractAmount` int NOT NULL DEFAULT 0,
	`status` enum('active','completed','terminated','pending') NOT NULL DEFAULT 'active',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consultant_contracts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consultant_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`consultantId` int NOT NULL,
	`amount` int NOT NULL,
	`paymentDate` timestamp NOT NULL DEFAULT (now()),
	`notes` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consultant_payments_id` PRIMARY KEY(`id`)
);
