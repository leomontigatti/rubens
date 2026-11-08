# ADR-0011: The product is named underthing

The product was called Rubens, which is the brand name of its likely first customer, a
dental practice. From 2026-11-08 the product is **underthing**. That is the name of the
business behind it (the owner's own monotributo, the site at underthing.dev) and the name
Meta's business verification and app dashboard already show. A practice's brand must not
be the name every other practice signs in to. Renaming before the WhatsApp App Review is
filed is cheap. Renaming later would also change a reviewed app and every practice's
setup.

The rename covers the Worker's name (and so its `workers.dev` URL), page titles, the
sign-in and app-shell text, the package name, the docs that name the product, and the
code identifiers that carried the old name (the dev sign-in cookie, the session-change
storage key). The ADRs before this one say "Rubens" as they were written; read it as
underthing. The repository and its T3 project are still `rubens`, and their rename is a
separate follow-up: `underthing` is already the business site's repository. The Durable
Object class, `Organization`, never carried the name, so no migration is needed.

## Consequences

- Renaming a Worker means deploying a new one. `underthing` starts with no secrets and
  empty objects, so the secrets are set and the test organization is created again
  (there is no real data yet). Meta's webhook callback URL and any URL set in Clerk move
  to the new address. The old `rubens` Worker is deleted once the new one works.
- The sibling repository `underthing` is the business site, whose Worker is
  `underthing-site`. The app's Worker takes the bare name.
