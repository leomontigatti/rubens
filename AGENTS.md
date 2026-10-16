# Rubens: guide for coding agents

Routes to the repo's conventions; each rule lives in the file a route names. The
first section applies to every task; a line in the second applies when its leading
word matches the task.

The skills, agent briefs and shared hooks are the shared workflow in
`leomontigatti/agent-workflow`, installed at `~/.agents/workflow`; Claude Code and Codex
load them from the user's home ([agent-configuration.md](docs/agents/agent-configuration.md)).
In Codex, "call the Skill tool with X" means open `~/.agents/workflow/skills/X/SKILL.md`
and follow it. This repo keeps only its own facts, in the contract files the shared
`contract.md` lists: this file, [GLOSSARY.md](GLOSSARY.md), [docs/adr/](docs/adr/README.md),
`t3.json`, `.agents/required-tools`, and under `docs/agents/`:
[validation.md](docs/agents/validation.md), [verification.md](docs/agents/verification.md),
[review.md](docs/agents/review.md), [issue-tracker.md](docs/agents/issue-tracker.md),
[pull-requests.md](docs/agents/pull-requests.md), [t3-dependencies.md](docs/agents/t3-dependencies.md),
[tdd-db.md](docs/agents/tdd-db.md), [tdd-frontend.md](docs/agents/tdd-frontend.md),
[housekeeping.md](docs/agents/housekeeping.md) and [research.md](docs/agents/research.md).

## Every task

- **Session conduct**: when a step needs no input from the user, keep going, and put
  status notes in the same message as the next action. Stop and ask only when the work
  cannot continue without them, or before anything destructive: deleting data,
  force-pushing, changing anything outside this repository. When a rule in these docs
  fights the task, say so and get a sign-off before breaking it. End a run with what
  needs the user first, then what changed, then what was found in this run.
- **Implementing** (a feature, a fix, any code change): call the Skill tool with
  "implement" before editing. Where work starts: [workflows.md](docs/agents/workflows.md);
  investigating before editing, and the thread's branch and worktree: the `implement`
  skill's `THREADS.md`.
- **Validation**: [validation.md](docs/agents/validation.md) is the whole surface. Run
  only commands it or [scripts.md](docs/operations/scripts.md) lists.
- **Subagents**: reviewers spawn as "Spawning a reviewer" in the `code-review` skill
  says, on the models the shared `agents/models.md` gives; research as
  [agent-configuration.md](docs/agents/agent-configuration.md#delegating-to-subagents) says.
- **Coding standards** (code language and test-support files included):
  [coding-standards.md](docs/agents/coding-standards.md); identifiers map to UI terms in
  [GLOSSARY.md](GLOSSARY.md).

## When routed

- **Commands**: [scripts.md](docs/operations/scripts.md) indexes every `pnpm` script.
- **Code placement**, **routes**, **tests layout**: [codebase-map.md](docs/agents/codebase-map.md).
- **Documentation** (the docs layout, when a doc changes): [workflows.md](docs/agents/workflows.md#documentation).
- **UI verification**: [verification.md](docs/agents/verification.md).
- **Review** (tiers, always-ask areas, hotspots, one-way doors): [review.md](docs/agents/review.md).
- **Database tests**: [tests/db/README.md](tests/db/README.md); test-first notes in
  [tdd-db.md](docs/agents/tdd-db.md) and [tdd-frontend.md](docs/agents/tdd-frontend.md).
- **Style** (frontend/UI): [style-guide.md](docs/agents/style-guide.md).
- **shadcn/ui** (before adding or re-syncing a component): [shadcn.md](docs/agents/shadcn.md).
- **Pull requests**: [pull-requests.md](docs/agents/pull-requests.md).
- **Issues**, **PRDs**, **wayfinding maps**: [issue-tracker.md](docs/agents/issue-tracker.md).
- **Domain**: [domain.md](docs/agents/domain.md); the rules in [docs/domain/](docs/domain/README.md);
  decisions in [docs/adr/](docs/adr/README.md).
- **CI**, **dependencies**: [ci.md](docs/operations/ci.md).
- **Fallow** (dead code, unused dependencies, duplication): [fallow.md](docs/agents/fallow.md).
- **Housekeeping** (per-worktree databases): [housekeeping.md](docs/agents/housekeeping.md).
- **Agent configuration** (skills, hooks, subagent wiring):
  [agent-configuration.md](docs/agents/agent-configuration.md).
- **Local database, auth and dev server**: [local-development.md](docs/operations/local-development.md).
- **Production infrastructure**: [infrastructure.md](docs/operations/infrastructure.md).
- **T3 Code dependencies** (what this project assumes about T3 beyond the shared
  workflow; read by the `t3-update-review` skill): [t3-dependencies.md](docs/agents/t3-dependencies.md).
