ALTER TABLE `analysis_jobs` ADD `lease_expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_lease` ON `analysis_jobs` (`status`,`lease_expires_at`);