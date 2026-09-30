CREATE TABLE `blobs` (
	`sha256` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`project_id` text NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`original_name` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `sha256`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sha256`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE no action
);
