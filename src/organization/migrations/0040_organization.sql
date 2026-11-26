-- The first statement is added by hand: a patient keeps one coverage, the
-- primary one (or, should there be none, the oldest), before the unique index
-- allows only one.
DELETE FROM `coverage` WHERE `rowid` NOT IN (
	SELECT (
		SELECT `kept`.`rowid` FROM `coverage` AS `kept`
		WHERE `kept`.`patient_id` = `patients`.`patient_id`
		ORDER BY `kept`.`primary` DESC, `kept`.`created_at`, `kept`.`rowid`
		LIMIT 1
	) FROM (SELECT DISTINCT `patient_id` FROM `coverage`) AS `patients`
);--> statement-breakpoint
DROP INDEX `coverage_patient_id_idx`;--> statement-breakpoint
DROP INDEX `coverage_primary_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_patient_unique` ON `coverage` (`patient_id`);--> statement-breakpoint
ALTER TABLE `coverage` DROP COLUMN `primary`;