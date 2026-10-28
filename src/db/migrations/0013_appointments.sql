CREATE TYPE "rubens"."appointment_canceller" AS ENUM('patient', 'business');--> statement-breakpoint
CREATE TYPE "rubens"."appointment_status" AS ENUM('booked', 'confirmed', 'checkedIn', 'attended', 'noShow', 'cancelled');--> statement-breakpoint
CREATE TABLE "rubens"."appointment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"during" "tstzrange" NOT NULL,
	"status" "rubens"."appointment_status" DEFAULT 'booked' NOT NULL,
	"overbooking" boolean DEFAULT false NOT NULL,
	"cancelled_by" "rubens"."appointment_canceller",
	"cancellation_reason" text,
	"reception_note" text,
	"previous_status" "rubens"."appointment_status",
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_during_check" CHECK (not isempty("rubens"."appointment"."during") and not lower_inf("rubens"."appointment"."during") and not upper_inf("rubens"."appointment"."during")),
	CONSTRAINT "appointment_reception_note_check" CHECK (char_length("rubens"."appointment"."reception_note") <= 200),
	CONSTRAINT "appointment_cancelled_check" CHECK (("rubens"."appointment"."status" = 'cancelled') = ("rubens"."appointment"."cancelled_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "rubens"."appointment" ADD CONSTRAINT "appointment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."appointment" ADD CONSTRAINT "appointment_patient_fk" FOREIGN KEY ("patient_id","organization_id") REFERENCES "rubens"."patient"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."appointment" ADD CONSTRAINT "appointment_practitioner_fk" FOREIGN KEY ("practitioner_id","organization_id") REFERENCES "rubens"."practitioner"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."appointment" ADD CONSTRAINT "appointment_type_fk" FOREIGN KEY ("appointment_type_id","organization_id") REFERENCES "rubens"."appointment_type"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."appointment" ADD CONSTRAINT "appointment_room_fk" FOREIGN KEY ("room_id","organization_id") REFERENCES "rubens"."room"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_patient_id_idx" ON "rubens"."appointment" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "appointment_room_id_idx" ON "rubens"."appointment" USING btree ("room_id");--> statement-breakpoint
-- A practitioner never holds two active appointments at once, unless one is an
-- overbooking (ADR-0003). The services match the constraint's name to report
-- "time already taken". Its index also serves lookups by practitioner.
ALTER TABLE "rubens"."appointment" ADD CONSTRAINT "appointment_practitioner_overlap"
  EXCLUDE USING gist ("practitioner_id" WITH =, "during" WITH &&)
  WHERE (NOT "overbooking" AND "status" IN ('booked', 'confirmed', 'checkedIn', 'attended'));--> statement-breakpoint
-- Row-level security, as for `office` (0003).
ALTER TABLE "rubens"."appointment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."appointment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointment_tenant" ON "rubens"."appointment"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
