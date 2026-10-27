CREATE TABLE "rubens"."practitioner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"display_name" text NOT NULL,
	"specialty" text,
	"keeps_clinical_records" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practitioner_member_id_unique" UNIQUE("member_id"),
	CONSTRAINT "practitioner_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "rubens"."member" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" ADD CONSTRAINT "practitioner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The unique constraint goes in before the composite key that targets it.
ALTER TABLE "rubens"."member" ADD CONSTRAINT "member_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" ADD CONSTRAINT "practitioner_member_fk" FOREIGN KEY ("member_id","organization_id") REFERENCES "rubens"."member"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Row-level security, as for `office` and `room` (0003).
ALTER TABLE "rubens"."practitioner" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "practitioner_tenant" ON "rubens"."practitioner"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
