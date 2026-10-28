CREATE TABLE "rubens"."guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"document_type" "rubens"."document_type",
	"document_number" text,
	"phone" text NOT NULL,
	"email" text,
	"message_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_document_check" CHECK (("rubens"."guardian"."document_type" is null) = ("rubens"."guardian"."document_number" is null))
);
--> statement-breakpoint
ALTER TABLE "rubens"."guardian" ADD CONSTRAINT "guardian_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."guardian" ADD CONSTRAINT "guardian_patient_fk" FOREIGN KEY ("patient_id","organization_id") REFERENCES "rubens"."patient"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_patient_id_idx" ON "rubens"."guardian" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_message_contact_unique" ON "rubens"."guardian" USING btree ("patient_id") WHERE "rubens"."guardian"."message_contact";--> statement-breakpoint
-- Row-level security, as for `office` (0003).
ALTER TABLE "rubens"."guardian" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."guardian" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "guardian_tenant" ON "rubens"."guardian"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
