CREATE TABLE `analysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recording_id` text,
	`status` text NOT NULL,
	`frame_count` integer NOT NULL,
	`provider` text NOT NULL,
	`error_code` text,
	`started_at` integer,
	`completed_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_user_created` ON `analysis_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_status` ON `analysis_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_expires_at` ON `analysis_jobs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `analysis_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`category` text NOT NULL,
	`summary` text NOT NULL,
	`confidence` real NOT NULL,
	`observed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `analysis_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_results_job` ON `analysis_results` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_analysis_results_expires_at` ON `analysis_results` (`expires_at`);--> statement-breakpoint
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
CREATE INDEX `idx_event_ack_user` ON `event_acknowledgements` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_event_ack_expires_at` ON `event_acknowledgements` (`expires_at`);--> statement-breakpoint
CREATE TABLE `group_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_invites_token_hash` ON `group_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_group_invites_group` ON `group_invites` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_group_invites_email` ON `group_invites` (`email`);--> statement-breakpoint
CREATE INDEX `idx_group_invites_expires_at` ON `group_invites` (`expires_at`);--> statement-breakpoint
CREATE TABLE `group_memberships` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_group_memberships_user` ON `group_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_groups_owner` ON `groups` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_groups_expires_at` ON `groups` (`expires_at`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`scope` text NOT NULL,
	`key_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`resource_id` text,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key_hash`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_expires_at` ON `idempotency_records` (`expires_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_group_created` ON `messages` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_user` ON `messages` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_expires_at` ON `messages` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key_hash` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`key_hash`, `window_started_at`)
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limits_expires_at` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_recording_id` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`mime_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recordings_user_client_id` ON `recordings` (`user_id`,`client_recording_id`);--> statement-breakpoint
CREATE INDEX `idx_recordings_user_created` ON `recordings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_recordings_expires_at` ON `recordings` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `road_events` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `road_events` ADD `resolved_at` integer;--> statement-breakpoint
CREATE INDEX `idx_road_events_user` ON `road_events` (`user_id`);