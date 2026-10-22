CREATE TABLE `book_ratings` (
	`owner_id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`rating` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `catalog_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_ratings_catalog_idx` ON `book_ratings` (`catalog_id`);--> statement-breakpoint
CREATE TABLE `book_reads` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`catalog_id` text NOT NULL,
	`finished_at` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_reads_owner_catalog_date_idx` ON `book_reads` (`owner_id`,`catalog_id`,`finished_at`);--> statement-breakpoint
CREATE INDEX `book_reads_catalog_owner_idx` ON `book_reads` (`catalog_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `community_books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `reading_posts` ADD `catalog_id` text;--> statement-breakpoint
CREATE INDEX `reading_posts_catalog_owner_idx` ON `reading_posts` (`catalog_id`,`owner_id`);