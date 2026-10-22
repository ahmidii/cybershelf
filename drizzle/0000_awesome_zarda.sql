CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_owner_idx` ON `assets` (`owner_id`);--> statement-breakpoint
CREATE TABLE `libraries` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`shelf_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`image_ids` text NOT NULL,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_owner_shelf_idx` ON `publications` (`owner_id`,`shelf_id`);--> statement-breakpoint
CREATE INDEX `publications_latest_idx` ON `publications` (`updated_at`);