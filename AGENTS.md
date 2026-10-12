# Rubens: guide for coding agents

Routes to the repo's conventions; each rule lives in the file a route names. The
first section applies to every task; a line in the second applies when its leading
word matches the task.

Claude Code and Codex share this file, the skills in `.agents/skills/` and the hooks
in `.agents/hooks/` ([agent-configuration.md](docs/agents/agent-configuration.md)). In
Codex, "call the Skill tool with X" means open `.agents/skills/X/SKILL.md` and follow it.

## Every task

- **Session conduct**: when a step needs no input from the user, keep going, and put
  status notes in the same message as the next action. Stop and ask only when the work
  cannot continue without them, or before anything destructive: deleting data,
  force-pushing, changing anything outside this repository. When a rule in these docs
  fights the task, say so and get a sign-off before breaking it. End a run with what
  needs the user first, then what changed, then what was found in this run.
- **Implementing** (a feature, a fix, any code change): call the Skill tool with
  "implement" before editing. Where work starts, investigating before editing, and the
  thread's branch and worktree: [workflows.md](docs/agents/workflows.md).
- **Validation**: [validation.md](docs/agents/validation.md) is the whole surface. Run
  only commands it or [scripts.md](docs/operations/scripts.md) lists.
- **Subagents**: reviewers spawn as "Spawning a reviewer" in the `code-review` skill
  says; research as [agent-configuration.md](docs/agents/agent-configuration.md#delegating-to-subagents) says.
- **Coding standards** (code language included):
  [coding-standards.md](docs/agents/coding-standards.md); identifiers map to UI terms in
  [GLOSSARY.md](GLOSSARY.md).

## When routed

- **Commands**: [scripts.md](docs/operations/scripts.md) indexes every `pnpm` script.
- **Code placement**, **routes**, **tests layout**: [codebase-map.md](docs/agents/codebase-map.md).
- **Documentation**, **UI verification**: [workflows.md](docs/agents/workflows.md).
- **Database tests**: [tests/db/README.md](tests/db/README.md).
- **Style** (frontend/UI): [style-guide.md](docs/agents/style-guide.md).
- **shadcn/ui** (before adding or re-syncing a component): [shadcn.md](docs/agents/shadcn.md).
- **Pull requests**: [pull-requests.md](docs/agents/pull-requests.md).
- **Issues**, **PRDs**, **wayfinding maps**: [issue-tracker.md](docs/agents/issue-tracker.md).
- **Domain**: [domain.md](docs/agents/domain.md); the rules in [docs/domain/](docs/domain/README.md);
  decisions in [docs/adr/](docs/adr/README.md).
- **CI**, **dependencies**: [ci.md](docs/operations/ci.md).
- **Agent configuration** (skills, hooks, subagent wiring):
  [agent-configuration.md](docs/agents/agent-configuration.md).
- **Local database, auth and dev server**: [local-development.md](docs/operations/local-development.md).
- **Production infrastructure**: [infrastructure.md](docs/operations/infrastructure.md).
- **Upstream skills**: [vendored-skills.md](docs/agents/vendored-skills.md).
