CREATE TABLE `road_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_road_events_expires_at` ON `road_events` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_road_events_location` ON `road_events` (`latitude`,`longitude`);