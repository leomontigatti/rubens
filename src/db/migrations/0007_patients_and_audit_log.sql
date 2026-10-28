CREATE TYPE "rubens"."document_type" AS ENUM('dni', 'passport', 'other');--> statement-breakpoint
CREATE TABLE "rubens"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"patient_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubens"."patient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"chosen_name" text,
	"document_type" "rubens"."document_type",
	"document_number" text,
	"birth_date" date,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"whatsapp_consent" boolean DEFAULT true NOT NULL,
	"whatsapp_consent_at" timestamp with time zone NOT NULL,
	"whatsapp_consent_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "patient_document_check" CHECK (("rubens"."patient"."document_type" is null) = ("rubens"."patient"."document_number" is null))
);
--> statement-breakpoint
ALTER TABLE "rubens"."audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."audit_log" ADD CONSTRAINT "audit_log_patient_fk" FOREIGN KEY ("patient_id","organization_id") REFERENCES "rubens"."patient"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."patient" ADD CONSTRAINT "patient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_patient_id_idx" ON "rubens"."audit_log" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "patient_organization_id_idx" ON "rubens"."patient" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_document_unique" ON "rubens"."patient" USING btree ("organization_id","document_type","document_number") WHERE "rubens"."patient"."document_number" is not null;--> statement-breakpoint
-- Row-level security, as for `office` (0003).
ALTER TABLE "rubens"."patient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."patient" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "patient_tenant" ON "rubens"."patient"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));--> statement-breakpoint
ALTER TABLE "rubens"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_tenant" ON "rubens"."audit_log"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));--> statement-breakpoint
-- The audit log is append-only (ADR-0003): the default privileges (0001) gave
-- the app role UPDATE and DELETE on it, so they are taken back.
REVOKE UPDATE, DELETE ON "rubens"."audit_log" FROM rubens_app;
