PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `__new_road_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_road_events`
	(`id`, `user_id`, `type`, `latitude`, `longitude`, `confidence`, `source`, `resolved_at`, `created_at`, `expires_at`)
	SELECT `id`, `user_id`, `type`, `latitude`, `longitude`, `confidence`, `source`, `resolved_at`, `created_at`, `expires_at`
	FROM `road_events`;
--> statement-breakpoint
CREATE TABLE `__event_acknowledgements_backup` AS
	SELECT `event_id`, `user_id`, `status`, `created_at`, `updated_at`, `expires_at`
	FROM `event_acknowledgements`;
--> statement-breakpoint
DROP TABLE `event_acknowledgements`;
--> statement-breakpoint
DROP TABLE `road_events`;
--> statement-breakpoint
ALTER TABLE `__new_road_events` RENAME TO `road_events`;
--> statement-breakpoint
CREATE INDEX `idx_road_events_user` ON `road_events` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_road_events_expires_at` ON `road_events` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_road_events_location` ON `road_events` (`latitude`,`longitude`);
--> statement-breakpoint
CREATE TABLE `event_acknowledgements` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `road_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `event_acknowledgements`
	(`event_id`, `user_id`, `status`, `created_at`, `updated_at`, `expires_at`)
	SELECT `event_id`, `user_id`, `status`, `created_at`, `updated_at`, `expires_at`
	FROM `__event_acknowledgements_backup`;
--> statement-breakpoint
DROP TABLE `__event_acknowledgements_backup`;
--> statement-breakpoint
CREATE INDEX `idx_event_ack_user` ON `event_acknowledgements` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_ack_expires_at` ON `event_acknowledgements` (`expires_at`);
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
