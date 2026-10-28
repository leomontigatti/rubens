import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

/**
 * The contrib extensions the migrations create (0001, 0008). PGlite only has
 * the extensions it is handed, so every instance is created with these.
 */
export const testExtensions = { btree_gist, pg_trgm, unaccent };
