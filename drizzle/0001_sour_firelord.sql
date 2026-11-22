CREATE TABLE `text_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`presale_id` text NOT NULL,
	`partner_id` text,
	`email_signup_id` text,
	`phone` text NOT NULL,
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
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`email_signup_id`) REFERENCES `signups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_signups_ticket_token_unique` ON `text_signups` (`ticket_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `text_signups_presale_phone` ON `text_signups` (`presale_id`,`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `text_signups_email_signup` ON `text_signups` (`email_signup_id`);--> statement-breakpoint
CREATE INDEX `text_signups_presale_partner` ON `text_signups` (`presale_id`,`partner_id`);--> statement-breakpoint
CREATE INDEX `text_signups_delivery` ON `text_signups` (`delivery`,`next_attempt_at`);--> statement-breakpoint
CREATE VIEW `fan_signups` AS 
  SELECT e.presale_id, e.partner_id,
    (e.updates_opt_in_at IS NOT NULL OR t.updates_opt_in_at IS NOT NULL) AS updates_opted_in
  FROM signups e LEFT JOIN text_signups t ON t.email_signup_id = e.id
  UNION ALL
  SELECT presale_id, partner_id, updates_opt_in_at IS NOT NULL AS updates_opted_in
  FROM text_signups WHERE email_signup_id IS NULL
;