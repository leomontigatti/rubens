-- Patient search (src/server/patients.ts): names compared without accents,
-- case or extra spaces, by trigram similarity. Extensions stay in `public`, as
-- `btree_gist` does (0001); every name here is qualified (ADR-0004).
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;--> statement-breakpoint
-- `unaccent` is only STABLE, because its dictionary could change, so an index
-- cannot call it. Naming the dictionary makes the result fixed, which is what
-- IMMUTABLE promises.
CREATE FUNCTION rubens.normalize_text(value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, value)), '\s+', ' ', 'g'));--> statement-breakpoint
-- What a name search matches: the legal names and the chosen name, normalized.
CREATE FUNCTION rubens.patient_search_name(first_name text, last_name text, chosen_name text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN rubens.normalize_text(first_name || ' ' || last_name || coalesce(' ' || chosen_name, ''));--> statement-breakpoint
CREATE INDEX "patient_search_name_idx" ON "rubens"."patient" USING gin (rubens.patient_search_name("first_name", "last_name", "chosen_name") public.gin_trgm_ops);--> statement-breakpoint
-- Digits typed in the search box match anywhere in the document or the phone.
CREATE INDEX "patient_document_number_trgm_idx" ON "rubens"."patient" USING gin ("document_number" public.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "patient_phone_trgm_idx" ON "rubens"."patient" USING gin ("phone" public.gin_trgm_ops);--> statement-breakpoint
-- The duplicate check's same name and birth date.
CREATE INDEX "patient_birth_date_idx" ON "rubens"."patient" USING btree ("organization_id", "birth_date");
