CREATE TABLE `account_action_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_action_limits_window_idx` ON `account_action_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `account_recovery_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `auth_user` ADD `username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_username_unique` ON `auth_user` (`username`);