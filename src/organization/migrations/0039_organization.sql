PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_closure` (
	`id` text PRIMARY KEY NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`tell_patients` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "closure_span_check" CHECK("__new_closure"."starts_at" < "__new_closure"."ends_at")
);
--> statement-breakpoint
INSERT INTO `__new_closure`("id", "starts_at", "ends_at", "tell_patients", "created_at", "updated_at") SELECT "id", "starts_at", "ends_at", "tell_patients", "created_at", "updated_at" FROM `closure`;--> statement-breakpoint
DROP TABLE `closure`;--> statement-breakpoint
ALTER TABLE `__new_closure` RENAME TO `closure`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `closure_starts_at_idx` ON `closure` (`starts_at`);