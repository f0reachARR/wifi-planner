CREATE TABLE `ap_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`vendor` text,
	`definition` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
