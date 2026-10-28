CREATE TABLE "rubens"."schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"first_date" date NOT NULL,
	"last_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_weekdays_check" CHECK (cardinality("rubens"."schedule"."weekdays") >= 1 and "rubens"."schedule"."weekdays" <@ array[1,2,3,4,5,6,7]),
	CONSTRAINT "schedule_times_check" CHECK ("rubens"."schedule"."start_time" < "rubens"."schedule"."end_time"),
	CONSTRAINT "schedule_dates_check" CHECK ("rubens"."schedule"."last_date" is null or "rubens"."schedule"."last_date" >= "rubens"."schedule"."first_date")
);
--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" ADD COLUMN "grid_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
-- The unique constraint goes in before the composite key that targets it.
ALTER TABLE "rubens"."room" ADD CONSTRAINT "room_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "rubens"."schedule" ADD CONSTRAINT "schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."schedule" ADD CONSTRAINT "schedule_practitioner_fk" FOREIGN KEY ("practitioner_id","organization_id") REFERENCES "rubens"."practitioner"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."schedule" ADD CONSTRAINT "schedule_room_fk" FOREIGN KEY ("room_id","organization_id") REFERENCES "rubens"."room"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_practitioner_id_idx" ON "rubens"."schedule" USING btree ("practitioner_id");--> statement-breakpoint
CREATE INDEX "schedule_room_id_idx" ON "rubens"."schedule" USING btree ("room_id");--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" ADD CONSTRAINT "practitioner_grid_minutes_check" CHECK ("rubens"."practitioner"."grid_minutes" between 5 and 120);--> statement-breakpoint
-- Row-level security, as for `office` and `room` (0003).
ALTER TABLE "rubens"."schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."schedule" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "schedule_tenant" ON "rubens"."schedule"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
