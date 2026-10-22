CREATE TABLE `reading_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`progress` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `reading_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_comments_post_date_idx` ON `reading_comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reading_comments_owner_date_idx` ON `reading_comments` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reading_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reading_events_owner_kind_date_idx` ON `reading_events` (`owner_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `reading_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`image_ids` text NOT NULL,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_posts_owner_entry_idx` ON `reading_posts` (`owner_id`,`entry_id`);--> statement-breakpoint
CREATE INDEX `reading_posts_profile_date_idx` ON `reading_posts` (`profile_id`,`published_at`);