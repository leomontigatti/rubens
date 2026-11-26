-- Edited by hand from drizzle-kit's output: the object's storage refuses
-- `PRAGMA foreign_keys` and migrates inside a transaction, so the rebuild
-- defers the foreign key checks instead, as in 0020 (`schedule` and
-- `appointment` rows point at the room).
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_room` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_room`("id", "office_id", "name", "active", "created_at", "updated_at") SELECT "id", "office_id", "name", "active", "created_at", "updated_at" FROM `room`;--> statement-breakpoint
DROP TABLE `room`;--> statement-breakpoint
ALTER TABLE `__new_room` RENAME TO `room`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE INDEX `room_office_id_idx` ON `room` (`office_id`);