CREATE TABLE `public_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`shelf_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`image_ids` text NOT NULL,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_profiles_owner_idx` ON `public_profiles` (`owner_id`);