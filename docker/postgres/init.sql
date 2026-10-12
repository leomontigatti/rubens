-- Local only. The app connects as rubens_app, which owns no table and has no
-- BYPASSRLS, so row-level security applies to it (ADR-0002). Migrations run as
-- postgres, the owner. Production creates the same role with its own password
-- (docs/operations/infrastructure.md).
CREATE ROLE rubens_app LOGIN PASSWORD 'rubens_app' NOSUPERUSER NOBYPASSRLS;
