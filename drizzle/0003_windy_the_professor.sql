ALTER TABLE `analysis_results` ADD `observations_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_results` ADD `uncertainty` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_results` ADD `source` text DEFAULT 'cloud-ai' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_results` ADD `model` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_results` ADD `captured_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_results` ADD `analyzed_at` integer DEFAULT 0 NOT NULL;