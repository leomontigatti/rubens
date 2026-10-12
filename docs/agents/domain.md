# Domain docs

How the engineering skills consume this repo's domain documentation.

## Read first

- **`GLOSSARY.md`** at the repo root: the vocabulary. Each entry is keyed on the
  code identifier, with the Spanish copy the user sees in its `ui:` value.
- **`docs/adr/`**: read the ADRs that touch the area you are about to change. An ADR
  is a decision and its reason; [`docs/adr/README.md`](../adr/README.md) indexes them.
- **`docs/domain/`**: the rules the glossary points at (availability, cancellation,
  clinical records). Start at [`docs/domain/README.md`](../domain/README.md).
- **[codebase-map.md](./codebase-map.md)**: once the area is chosen, the directories
  and tests where its code lives.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a test
name), use the term from `GLOSSARY.md`. Do not drift to synonyms it avoids. Use the
identifier when naming code and the `ui:` value when writing anything a user reads.

If the concept you need is not in the glossary, either you are inventing language
the project does not use, or there is a real gap. Note the gap for the
`domain-modeling` skill.

## Flag ADR conflicts

If your output contradicts an ADR, say so rather than silently overriding it:

> _Contradicts ADR-0002 (tenancy and connections), but worth reopening because…_

ADRs are records. A reversal is a new ADR that supersedes the old one.
