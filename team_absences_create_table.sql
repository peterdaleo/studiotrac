CREATE TABLE `team_absences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `teamMemberId` int NOT NULL,
  `absenceType` enum('full_day','partial_day','work_from_home') NOT NULL,
  `startDate` timestamp NOT NULL,
  `endDate` timestamp NOT NULL,
  `startTimeMinutes` int,
  `endTimeMinutes` int,
  `notes` text,
  `createdById` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `team_absences_id` PRIMARY KEY(`id`)
);
