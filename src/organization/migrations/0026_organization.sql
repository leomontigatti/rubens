CREATE TABLE `medical_service_template` (
	`medical_service_id` text NOT NULL,
	`template_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`medical_service_id`, `template_id`),
	FOREIGN KEY (`medical_service_id`) REFERENCES `medical_service`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `template`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `medical_service_template_template_idx` ON `medical_service_template` (`template_id`);--> statement-breakpoint
CREATE TABLE `template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timing` text,
	`timing_hours` integer,
	`draft` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_name_idx` ON `template` (`name`);--> statement-breakpoint
ALTER TABLE `notification` ADD `template_id` text;--> statement-breakpoint
ALTER TABLE `outbox_message` ADD `template_id` text REFERENCES template(id);--> statement-breakpoint
ALTER TABLE `whatsapp_template` ADD `template_id` text REFERENCES template(id);--> statement-breakpoint
-- The five event templates, each under its event's name, and the organization's four drafts (docs/operations/whatsapp-templates.md).
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES ('turno_movido', 'Turno movido', NULL, NULL, 'Hola {{paciente}}, tuvimos que mover tu turno con {{profesional}}: ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no te queda bien, respondé este mensaje y buscamos otro horario. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES ('turno_cancelado', 'Turno cancelado', NULL, NULL, 'Hola {{paciente}}, tuvimos que cancelar tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpá las molestias. Respondé este mensaje y buscamos otro horario. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES ('turno_a_reprogramar', 'Turno a reprogramar', NULL, NULL, 'Hola {{paciente}}, tuvimos que mover tu turno del {{fecha}} con {{profesional}}. Respondé este mensaje y buscamos otro horario. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES ('solicitud_no_confirmada', 'Solicitud no confirmada', NULL, NULL, 'Hola {{paciente}}, no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Respondé este mensaje y buscamos otro horario. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES ('reabrir_conversacion', 'Reabrir la conversación', NULL, NULL, 'Hola {{paciente}}, tenemos una respuesta para vos. Respondé este mensaje para verla. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Confirmación del turno', 'booking', NULL, 'Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesitás cambiarlo, respondé este mensaje. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Recordatorio con confirmación', 'before', 24, 'Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}}. ¿Nos confirmás tu asistencia? Si necesitás cancelarlo o cambiarlo, respondé este mensaje. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Recordatorio', 'before', 2, 'Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} en {{sede}} ({{direccion}}). [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT INTO `template` (`id`, `name`, `timing`, `timing_hours`, `draft`, `created_at`, `updated_at`) VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), 'Seguimiento', 'after', 24, 'Hola {{paciente}}, ¿cómo te sentís después de tu turno del {{fecha}} con {{profesional}}? Contanos respondiendo este mensaje. [firma]', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
-- The templates a medical service set before #275 have no successor: their versions and queued messages go.
UPDATE `whatsapp_template` SET `template_id` = `name` WHERE `name` IN ('turno_movido', 'turno_cancelado', 'turno_a_reprogramar', 'solicitud_no_confirmada', 'reabrir_conversacion');--> statement-breakpoint
DELETE FROM `whatsapp_template` WHERE `template_id` IS NULL;--> statement-breakpoint
UPDATE `notification` SET `template_id` = `template_name` WHERE `template_name` IN ('turno_movido', 'turno_cancelado', 'turno_a_reprogramar', 'solicitud_no_confirmada', 'reabrir_conversacion');--> statement-breakpoint
DELETE FROM `outbox_message` WHERE `kind` IN ('bookingConfirmation', 'reminder', 'reminderWithoutConfirmation', 'careInstructions', 'followUp');--> statement-breakpoint
UPDATE `outbox_message` SET `template_id` = CASE `kind` WHEN 'appointmentMoved' THEN 'turno_movido' WHEN 'appointmentCancelled' THEN 'turno_cancelado' WHEN 'appointmentToReschedule' THEN 'turno_a_reprogramar' WHEN 'reopenConversation' THEN 'reabrir_conversacion' END;
