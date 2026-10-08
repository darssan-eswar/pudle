PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "group_id", "user_id", "body", "created_at", "expires_at") SELECT "id", "group_id", "user_id", "body", "created_at", "expires_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_id` ON `messages` (`id`);--> statement-breakpoint
CREATE INDEX `idx_messages_group_created` ON `messages` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_user` ON `messages` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_expires_at` ON `messages` (`expires_at`);--> statement-breakpoint
ALTER TABLE `road_events` ADD `direction` text;