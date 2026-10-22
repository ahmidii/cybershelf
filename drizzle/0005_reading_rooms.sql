ALTER TABLE `reading_posts` ADD `book_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `reading_posts_book_owner_date_idx` ON `reading_posts` (`book_key`,`owner_id`,`published_at`,`id`);
