CREATE TABLE `account_deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_jobs_owner_id_unique` ON `account_deletion_jobs` (`owner_id`);--> statement-breakpoint
CREATE INDEX `account_deletion_jobs_pending_idx` ON `account_deletion_jobs` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `account_erasure_ledger` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_erasure_ledger_expiry_idx` ON `account_erasure_ledger` (`expires_at`);--> statement-breakpoint
CREATE TABLE `account_suspensions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`moderator_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `asset_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`state` text DEFAULT 'uploading' NOT NULL,
	`writer_done` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_transfers_object_key_unique` ON `asset_transfers` (`object_key`);--> statement-breakpoint
CREATE INDEX `asset_transfers_owner_idx` ON `asset_transfers` (`owner_id`);--> statement-breakpoint
CREATE INDEX `asset_transfers_cleanup_idx` ON `asset_transfers` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `asset_transfers_expiry_idx` ON `asset_transfers` (`expires_at`);--> statement-breakpoint
CREATE TABLE `maintenance_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text,
	`moderator_id` text,
	`target_owner_id` text,
	`action` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `moderation_reports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`moderator_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_date_idx` ON `moderation_actions` (`created_at`);--> statement-breakpoint
CREATE INDEX `moderation_actions_report_date_idx` ON `moderation_actions` (`report_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `moderation_hidden` (
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`owner_id` text,
	`moderator_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`target_kind`, `target_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moderator_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_hidden_owner_idx` ON `moderation_hidden` (`owner_id`);--> statement-breakpoint
CREATE TABLE `moderation_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_owner_id` text,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`public_snapshot` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_reports_reporter_target_idx` ON `moderation_reports` (`reporter_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `moderation_reports_status_date_idx` ON `moderation_reports` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `reader_blocks` (
	`id` text NOT NULL,
	`blocker_id` text NOT NULL,
	`blocked_owner_id` text NOT NULL,
	`blocked_profile_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_owner_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_owner_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reader_blocks_id_unique` ON `reader_blocks` (`id`);--> statement-breakpoint
CREATE INDEX `reader_blocks_reverse_idx` ON `reader_blocks` (`blocked_owner_id`);
--> statement-breakpoint
CREATE TRIGGER `libraries_require_account_insert` BEFORE INSERT ON `libraries`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `libraries_require_account_update` BEFORE UPDATE OF owner_id ON `libraries`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `assets_require_account_insert` BEFORE INSERT ON `assets`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `assets_require_account_update` BEFORE UPDATE OF owner_id ON `assets`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `publications_require_account_insert` BEFORE INSERT ON `publications`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `publications_require_account_update` BEFORE UPDATE OF owner_id ON `publications`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `public_profiles_require_account_insert` BEFORE INSERT ON `public_profiles`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `public_profiles_require_account_update` BEFORE UPDATE OF owner_id ON `public_profiles`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_posts_require_account_insert` BEFORE INSERT ON `reading_posts`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_posts_require_account_update` BEFORE UPDATE OF owner_id ON `reading_posts`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_comments_require_account_insert` BEFORE INSERT ON `reading_comments`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_comments_require_account_update` BEFORE UPDATE OF owner_id ON `reading_comments`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_events_require_account_insert` BEFORE INSERT ON `reading_events`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_events_require_account_update` BEFORE UPDATE OF owner_id ON `reading_events`
WHEN NOT EXISTS (SELECT 1 FROM auth_user WHERE id = NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `public_profiles_suspension_insert` BEFORE INSERT ON `public_profiles` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `public_profiles_suspension_update` BEFORE UPDATE ON `public_profiles` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `publications_suspension_insert` BEFORE INSERT ON `publications` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `publications_suspension_update` BEFORE UPDATE ON `publications` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_posts_suspension_insert` BEFORE INSERT ON `reading_posts` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_posts_suspension_update` BEFORE UPDATE ON `reading_posts` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_comments_suspension_insert` BEFORE INSERT ON `reading_comments` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_comments_suspension_update` BEFORE UPDATE ON `reading_comments` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `reader_activity_suspension_insert` BEFORE INSERT ON `reader_activity` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `reader_activity_suspension_update` BEFORE UPDATE ON `reader_activity` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `book_ratings_suspension_insert` BEFORE INSERT ON `book_ratings` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `book_ratings_suspension_update` BEFORE UPDATE ON `book_ratings` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `book_reads_suspension_insert` BEFORE INSERT ON `book_reads` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `book_reads_suspension_update` BEFORE UPDATE ON `book_reads` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT, 'PUBLIC_PARTICIPATION_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER `follows_safety_insert` BEFORE INSERT ON `follows` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id IN (NEW.follower_id,NEW.followed_owner_id)) OR EXISTS (SELECT 1 FROM reader_blocks WHERE (blocker_id=NEW.follower_id AND blocked_owner_id=NEW.followed_owner_id) OR (blocker_id=NEW.followed_owner_id AND blocked_owner_id=NEW.follower_id)) BEGIN SELECT RAISE(ABORT, 'READER_INTERACTION_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_comments_block_insert` BEFORE INSERT ON `reading_comments` WHEN EXISTS (SELECT 1 FROM reading_posts p JOIN reader_blocks b ON (b.blocker_id=NEW.owner_id AND b.blocked_owner_id=p.owner_id) OR (b.blocker_id=p.owner_id AND b.blocked_owner_id=NEW.owner_id) WHERE p.id=NEW.post_id) OR EXISTS (SELECT 1 FROM reading_posts p JOIN account_suspensions s ON s.user_id=p.owner_id WHERE p.id=NEW.post_id) OR EXISTS (SELECT 1 FROM reading_posts p JOIN moderation_hidden h ON (h.target_kind='post' AND h.target_id=p.id) OR (h.target_kind='profile' AND h.target_id=p.profile_id) WHERE p.id=NEW.post_id) BEGIN SELECT RAISE(ABORT, 'READER_INTERACTION_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `follows_safety_update` BEFORE UPDATE ON `follows` WHEN EXISTS (SELECT 1 FROM account_suspensions WHERE user_id IN (NEW.follower_id,NEW.followed_owner_id)) OR EXISTS (SELECT 1 FROM reader_blocks WHERE (blocker_id=NEW.follower_id AND blocked_owner_id=NEW.followed_owner_id) OR (blocker_id=NEW.followed_owner_id AND blocked_owner_id=NEW.follower_id)) BEGIN SELECT RAISE(ABORT, 'READER_INTERACTION_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `reading_comments_block_update` BEFORE UPDATE ON `reading_comments` WHEN EXISTS (SELECT 1 FROM reading_posts p JOIN reader_blocks b ON (b.blocker_id=NEW.owner_id AND b.blocked_owner_id=p.owner_id) OR (b.blocker_id=p.owner_id AND b.blocked_owner_id=NEW.owner_id) WHERE p.id=NEW.post_id) OR EXISTS (SELECT 1 FROM reading_posts p JOIN account_suspensions s ON s.user_id=p.owner_id WHERE p.id=NEW.post_id) OR EXISTS (SELECT 1 FROM reading_posts p JOIN moderation_hidden h ON (h.target_kind='post' AND h.target_id=p.id) OR (h.target_kind='profile' AND h.target_id=p.profile_id) WHERE p.id=NEW.post_id) BEGIN SELECT RAISE(ABORT, 'READER_INTERACTION_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `auth_verification_reset_owner_insert` BEFORE INSERT ON `auth_verification` WHEN NEW.identifier LIKE 'reset-password:%' AND NOT EXISTS (SELECT 1 FROM auth_user WHERE id=NEW.value) BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER `auth_verification_reset_owner_update` BEFORE UPDATE ON `auth_verification` WHEN NEW.identifier LIKE 'reset-password:%' AND NOT EXISTS (SELECT 1 FROM auth_user WHERE id=NEW.value) BEGIN SELECT RAISE(ABORT, 'Account is unavailable'); END;
