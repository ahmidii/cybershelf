CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followed_owner_id` text NOT NULL,
	`followed_profile_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`follower_id`, `followed_owner_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followed_owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `follows_followed_idx` ON `follows` (`followed_owner_id`);--> statement-breakpoint
CREATE TABLE `reader_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`book_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reader_activity_owner_date_idx` ON `reader_activity` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reader_activity_profile_date_idx` ON `reader_activity` (`profile_id`,`created_at`);