import type { OrganizationData } from "../org/organization-data";

export interface Env {
  DB: D1Database;
  ORGANIZATION: DurableObjectNamespace<OrganizationData>;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  SEED_KEY?: string;
}
