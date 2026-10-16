# Housekeeping

Rubens' per-worktree resources, for the shared `housekeeping` skill.

## Worktree databases

Each worktree gets its own database, `rubens-wt-<slug>`, in the shared `rubens-postgres`
container, on its first `pnpm dev` or `pnpm db:migrate`. The slug is the worktree folder's name,
lowercased, every run of other characters turned into `-` (`worktreeDatabaseName` in
`scripts/worktree-db.ts`), so a database belongs to the worktree whose folder gives that slug,
wherever the folder lives. The main checkout's `rubens` database is never one of them.

- **List**: `pnpm db:worktree prune` prints every `rubens-wt-` database whose worktree is gone,
  T3's removed worktrees included. It changes nothing.
- **Remove**, one by name, for each database the accepted report listed:
  `docker exec rubens-postgres dropdb --force -U postgres <database>`.
  Never `pnpm db:worktree prune --apply`: it drops whatever is orphaned when it runs, including
  the database of a worktree T3 removed after the report.

## Ports and `.env.local`

A worktree's dev port lives in its gitignored `.env.local`, which goes with the worktree. Nothing
else to sweep.
