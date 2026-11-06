import type { OrganizationData } from "../org/organization-data";

export interface Env {
  ORGANIZATION: DurableObjectNamespace<OrganizationData>;
  /** Unset in dev: the app falls back to a dev sign-in with the seeded staff. Required deployed. */
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  SEED_KEY?: string;
}
