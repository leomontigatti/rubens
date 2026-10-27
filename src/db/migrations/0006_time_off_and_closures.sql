CREATE TABLE "rubens"."closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"office_id" uuid,
	"during" "tstzrange" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_during_check" CHECK (not isempty("rubens"."closure"."during") and not lower_inf("rubens"."closure"."during") and not upper_inf("rubens"."closure"."during"))
);
--> statement-breakpoint
CREATE TABLE "rubens"."time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"during" "tstzrange" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_during_check" CHECK (not isempty("rubens"."time_off"."during") and not lower_inf("rubens"."time_off"."during") and not upper_inf("rubens"."time_off"."during"))
);
--> statement-breakpoint
ALTER TABLE "rubens"."closure" ADD CONSTRAINT "closure_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."closure" ADD CONSTRAINT "closure_office_fk" FOREIGN KEY ("office_id","organization_id") REFERENCES "rubens"."office"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."time_off" ADD CONSTRAINT "time_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."time_off" ADD CONSTRAINT "time_off_practitioner_fk" FOREIGN KEY ("practitioner_id","organization_id") REFERENCES "rubens"."practitioner"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closure_office_id_idx" ON "rubens"."closure" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "time_off_practitioner_id_idx" ON "rubens"."time_off" USING btree ("practitioner_id");--> statement-breakpoint
-- Row-level security, as for `schedule` (0005).
ALTER TABLE "rubens"."time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."time_off" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "time_off_tenant" ON "rubens"."time_off"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));--> statement-breakpoint
ALTER TABLE "rubens"."closure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."closure" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "closure_tenant" ON "rubens"."closure"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
