# syntax=docker/dockerfile:1

FROM node:22.23.4-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production
# Two package managers, two switches: npm's covers corepack's own npm, pnpm's keeps its
# "new version available" notice out of the Coolify build log.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PNPM_CONFIG_UPDATE_NOTIFIER=false
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# pnpm comes from the `packageManager` field in package.json.
RUN corepack enable

FROM base AS build

# `prepare` runs `vp config`, which would install git hooks. The build context has
# no .git (.dockerignore), so skip it rather than rely on the `|| true` in `prepare`.
ENV VP_GIT_HOOKS=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Dev dependencies are needed to build; NODE_ENV is set per command, because a
# development NODE_ENV during `vp build` ships the React dev JSX runtime (jsxDEV) and
# the server answers 500 on every render.
RUN NODE_ENV=development pnpm install --frozen-lockfile
COPY . .
# Produces .output/: a self-contained Nitro server (its dependencies are bundled into
# .output/server/_libs and _ssr), plus the static assets in .output/public.
RUN NODE_ENV=production pnpm build
RUN pnpm prune --prod --ignore-scripts

FROM base AS runtime

# What the container runs, and nothing else:
# - .output: the built server. Bundled, so it needs no node_modules of its own.
# - scripts/migrate.mjs and scripts/migrations/: the migration runner, which Node runs
#   directly. It resolves its migrations at ../src/db/migrations, so that folder keeps
#   its path.
# - node_modules: pruned to production dependencies. migrate.mjs imports drizzle-orm
#   and pg from it, and the server bundle does not need it. Trimming it to only those
#   two packages is possible but not worth the maintenance until the image size matters.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/migrations ./scripts/migrations
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=build /app/src/db/migrations ./src/db/migrations

RUN chmod +x /app/scripts/docker-entrypoint.sh

USER node

EXPOSE 3000

# Coolify's own healthcheck is the gate in production. This one is for plain
# `docker run`. The app has no dedicated health route yet, so it probes `/`, which
# answers 200 without a session. Replace with a route that checks the database once
# one exists (docs/operations/infrastructure.md).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# ENTRYPOINT, not a chained CMD: the Coolify application may set its own start
# command, and a rewritten CMD would be silently overridden, so migrations would
# never run. An ENTRYPOINT composes with whatever command arrives.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
