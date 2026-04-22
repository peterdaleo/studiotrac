ALTER TABLE `users`
MODIFY COLUMN `role` ENUM('user', 'pm', 'admin') NOT NULL DEFAULT 'user';
