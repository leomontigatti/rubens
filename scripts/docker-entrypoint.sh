#!/bin/sh
# Applies pending migrations, then hands over to the container command.
#
# This must stay an ENTRYPOINT rather than a chained CMD: the Coolify
# application has `start_command` populated with the serve command, and if the
# platform passes that as the container command a rewritten CMD would be
# silently overridden — migrations would never run, with no error, because the
# app would start normally. An ENTRYPOINT composes with whatever command
# arrives.
set -e

node /app/scripts/migrate.mjs

exec "$@"
