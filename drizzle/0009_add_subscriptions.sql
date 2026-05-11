-- Add stripeCustomerId to users table
ALTER TABLE `users` ADD COLUMN `stripeCustomerId` varchar(255);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `stripeSubscriptionId` varchar(255) NOT NULL,
  `stripeCustomerId` varchar(255) NOT NULL,
  `stripePriceId` varchar(255) NOT NULL,
  `plan` enum('starter','professional','enterprise') NOT NULL,
  `status` enum('active','canceled','past_due','incomplete','trialing','unpaid') NOT NULL DEFAULT 'active',
  `currentPeriodStart` timestamp NULL,
  `currentPeriodEnd` timestamp NULL,
  `cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
  `canceledAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
  CONSTRAINT `subscriptions_stripeSubscriptionId_unique` UNIQUE(`stripeSubscriptionId`)
);
