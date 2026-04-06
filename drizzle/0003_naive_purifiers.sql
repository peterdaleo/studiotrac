CREATE TABLE `client_share_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`token` varchar(128) NOT NULL,
	`label` varchar(255),
	`isActive` boolean NOT NULL DEFAULT true,
	`expiresAt` timestamp,
	`createdById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_share_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_share_tokens_token_unique` UNIQUE(`token`)
);
