CREATE TYPE "rubens"."insurer_kind" AS ENUM('obraSocial', 'prepaga');--> statement-breakpoint
CREATE TABLE "rubens"."coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"insurer_id" uuid NOT NULL,
	"plan" text,
	"member_number" text NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubens"."insurer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "rubens"."insurer_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurer_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "rubens"."coverage" ADD CONSTRAINT "coverage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."coverage" ADD CONSTRAINT "coverage_patient_fk" FOREIGN KEY ("patient_id","organization_id") REFERENCES "rubens"."patient"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."coverage" ADD CONSTRAINT "coverage_insurer_fk" FOREIGN KEY ("insurer_id","organization_id") REFERENCES "rubens"."insurer"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubens"."insurer" ADD CONSTRAINT "insurer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "rubens"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coverage_patient_id_idx" ON "rubens"."coverage" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_primary_unique" ON "rubens"."coverage" USING btree ("patient_id") WHERE "rubens"."coverage"."primary";--> statement-breakpoint
CREATE INDEX "insurer_organization_id_idx" ON "rubens"."insurer" USING btree ("organization_id");--> statement-breakpoint
-- Row-level security, as for `office` (0003).
ALTER TABLE "rubens"."insurer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."insurer" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "insurer_tenant" ON "rubens"."insurer"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));--> statement-breakpoint
ALTER TABLE "rubens"."coverage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rubens"."coverage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "coverage_tenant" ON "rubens"."coverage"
  USING ("organization_id" = current_setting('app.organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true));
