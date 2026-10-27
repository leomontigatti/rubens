CREATE TABLE "rubens"."office" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"time_zone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_id_organization_id_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "rubens"."room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"office_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_capacity_check" CHECK ("rubens"."room"."capacity" >= 1)
);
--> statement-breakpoint
ALTER TABLE "rubens"."office" ADD CONSTRAINT "office_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."room" ADD CONSTRAINT "room_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."room" ADD CONSTRAINT "room_office_fk" FOREIGN KEY ("office_id","organization_id") REFERENCES "rubens"."office"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_organization_id_idx" ON "rubens"."office" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "room_office_id_idx" ON "rubens"."room" USING btree ("office_id");--> statement-breakpoint
-- Row-level security, the tenant boundary (ADR-0002). Forced, so it applies to
-- the table owner too, and matched against the organization `withTenant()` sets
-- for the transaction: with no setting, no row matches. Every later table with
-- `organization_id` follows this pattern; tests/db/rls.db.test.ts guards it.
ALTER TABLE "rubens"."office" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."office" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "office_tenant" ON "rubens"."office"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));--> statement-breakpoint
ALTER TABLE "rubens"."room" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."room" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "room_tenant" ON "rubens"."room"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
