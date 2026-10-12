-- The app role (ADR-0002). Infrastructure creates it with LOGIN and a password
-- before the first migration; this creates a NOLOGIN stand-in only where it is
-- missing (a fresh test database), so the grants below always have a target.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rubens_app') THEN
    CREATE ROLE rubens_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA rubens TO rubens_app;
--> statement-breakpoint
-- The tables 0000 created, then every table the migration role creates in
-- `rubens` from here on. The app role never owns them, so row-level security
-- applies to it.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rubens TO rubens_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA rubens GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rubens_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA rubens GRANT USAGE, SELECT ON SEQUENCES TO rubens_app;
--> statement-breakpoint
-- Exclusion constraints on (id WITH =, range WITH &&) against double booking
-- (ADR-0003). Extensions stay in `public`, outside the app schema.
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public;
