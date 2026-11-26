DROP INDEX `coverage_patient_id_idx`;--> statement-breakpoint
DROP INDEX `coverage_primary_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_patient_unique` ON `coverage` (`patient_id`);--> statement-breakpoint
ALTER TABLE `coverage` DROP COLUMN `primary`;