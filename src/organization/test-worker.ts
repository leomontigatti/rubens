// The Worker the object tests run against (`pnpm test:workers`): the object
// alone, without Start's handler, which only serves and builds.
export { Organization } from "#/organization/organization.ts";

export default {
  fetch: () => new Response(null, { status: 404 }),
} satisfies ExportedHandler;
