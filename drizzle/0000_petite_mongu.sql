CREATE TABLE `bands` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`accent` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bands_slug_unique` ON `bands` (`slug`);--> statement-breakpoint
CREATE INDEX `bands_owner` ON `bands` (`owner_id`);--> statement-breakpoint
CREATE TABLE `clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`presale_id` text NOT NULL,
	`partner_id` text,
	`clicked_at` integer NOT NULL,
	FOREIGN KEY (`presale_id`) REFERENCES `presales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clicks_presale_partner` ON `clicks` (`presale_id`,`partner_id`);--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`presale_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`presale_id`) REFERENCES `presales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partners_presale_code` ON `partners` (`presale_id`,`code`);--> statement-breakpoint
CREATE TABLE `presales` (
	`id` text PRIMARY KEY NOT NULL,
	`band_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`venue` text NOT NULL,
	`description` text NOT NULL,
	`event_at` integer NOT NULL,
	`opens_at` integer NOT NULL,
	`timezone` text NOT NULL,
	`ticket_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`band_id`) REFERENCES `bands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presales_band_slug` ON `presales` (`band_id`,`slug`);--> statement-breakpoint
CREATE INDEX `presales_opening` ON `presales` (`published_at`,`opens_at`);--> statement-breakpoint
CREATE TABLE `signups` (
	`id` text PRIMARY KEY NOT NULL,
	`presale_id` text NOT NULL,
	`partner_id` text,
	`email` text NOT NULL,
	`consented_at` integer NOT NULL,
	`updates_opt_in_at` integer,
	`ticket_token` text NOT NULL,
	`delivery` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`first_attempt_at` integer,
	`lease_id` text,
	`sent_at` integer,
	FOREIGN KEY (`presale_id`) REFERENCES `presales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signups_ticket_token_unique` ON `signups` (`ticket_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `signups_presale_email` ON `signups` (`presale_id`,`email`);--> statement-breakpoint
CREATE INDEX `signups_presale_partner` ON `signups` (`presale_id`,`partner_id`);--> statement-breakpoint
CREATE INDEX `signups_delivery` ON `signups` (`delivery`,`next_attempt_at`);