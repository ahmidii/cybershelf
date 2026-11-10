CREATE TABLE `community_asset_editions` (
	`asset_id` text NOT NULL,
	`edition_key` text NOT NULL,
	PRIMARY KEY(`asset_id`, `edition_key`),
	FOREIGN KEY (`asset_id`) REFERENCES `community_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `community_asset_editions_key_idx` ON `community_asset_editions` (`edition_key`);--> statement-breakpoint
CREATE TABLE `community_asset_erasures` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`storage_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `community_asset_erasures_expiry_idx` ON `community_asset_erasures` (`expires_at`);--> statement-breakpoint
CREATE TABLE `community_asset_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`moderator_id` text,
	`action` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `community_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `community_asset_reviews_asset_idx` ON `community_asset_reviews` (`asset_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`contributor_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`storage_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`edition_key` text DEFAULT '' NOT NULL,
	`metadata` text NOT NULL,
	`consent_version` text NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`contributor_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_assets_storage_id_unique` ON `community_assets` (`storage_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `community_assets_object_key_unique` ON `community_assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `community_assets_status_kind_idx` ON `community_assets` (`status`,`kind`,`id`);--> statement-breakpoint
CREATE INDEX `community_assets_contributor_idx` ON `community_assets` (`contributor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_assets_contributor_content_idx` ON `community_assets` (`contributor_id`,`content_hash`,`kind`,`edition_key`);