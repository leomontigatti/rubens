CREATE TYPE "rubens"."appointment_type_color" AS ENUM('color1', 'color2', 'color3', 'color4', 'color5');--> statement-breakpoint
CREATE TABLE "rubens"."appointment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"color" "rubens"."appointment_type_color" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_type_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "appointment_type_duration_minutes_check" CHECK ("rubens"."appointment_type"."duration_minutes" between 1 and 720)
);
--> statement-breakpoint
ALTER TABLE "rubens"."appointment_type" ADD CONSTRAINT "appointment_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."appointment_type" ADD CONSTRAINT "appointment_type_practitioner_fk" FOREIGN KEY ("practitioner_id","organization_id") REFERENCES "rubens"."practitioner"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_type_practitioner_id_idx" ON "rubens"."appointment_type" USING btree ("practitioner_id");--> statement-breakpoint
-- Row-level security, as for `office` (0003).
ALTER TABLE "rubens"."appointment_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."appointment_type" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointment_type_tenant" ON "rubens"."appointment_type"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
