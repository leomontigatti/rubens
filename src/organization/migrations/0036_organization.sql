-- The last statement is added by hand: until now only the clinical check held a
-- reply, so every reply held before this one was held by it.
ALTER TABLE `handoff` ADD `held_because` text;--> statement-breakpoint
UPDATE `handoff` SET `held_because` = 'clinical' WHERE `held_reply` IS NOT NULL;
