# GLOSSARY.md Format

## Structure

```md
# Rubens

{One or two sentences on what the glossary covers.}

## Tenancy

**`organization`** — ui: "Organización"
{A one or two sentence description of the term.}
_Avoid_: tenant, account

**`clinicalNote`** — ui: "Evolución"
One entry in a clinical record. A note is never edited in place.
_Avoid_: note, nota

**`cliente`** _(retired term)_ — no code identifier
{Why it was retired, and the term that replaced it.}
```

Each heading is the canonical English identifier, the name to use in code, followed by `ui:` and
the Spanish term the user sees. The reading rules (declining the identifier, the Spanish that
prose may borrow) are in [coding-standards.md](../../../docs/agents/coding-standards.md#code-language).

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
