CREATE TYPE "rubens"."practitioner_color" AS ENUM('color1', 'color2', 'color3', 'color4', 'color5');--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" ADD COLUMN "color" "rubens"."practitioner_color" DEFAULT 'color1' NOT NULL;--> statement-breakpoint
-- Existing practitioners take the palette's colours in turn, by name, within
-- their organization. Row-level security is forced on this table (0004), so it
-- is lifted for the update and forced again.
ALTER TABLE "rubens"."practitioner" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "rubens"."practitioner" AS "target"
  SET "color" = (enum_range(NULL::"rubens"."practitioner_color"))[1 + ("ranked"."position" - 1) % 5]
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "organization_id" ORDER BY "display_name", "id") AS "position"
    FROM "rubens"."practitioner"
  ) AS "ranked"
  WHERE "target"."id" = "ranked"."id";--> statement-breakpoint
ALTER TABLE "rubens"."practitioner" FORCE ROW LEVEL SECURITY;
