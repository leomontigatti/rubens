# Style guide

Stub. The interface is not built yet; this page is written with the first screens,
one decision at a time, each with the reason and a component that gets it right.

What is settled already:

- The base is shadcn/ui on Tailwind 4, in the `new-york` style (see [shadcn.md](./shadcn.md)).
- The UI is Spanish; the copy is written with the user's terms from `GLOSSARY.md`
  (the `ui:` values), not with code identifiers.
- Tokens and variants come before one-off classes: a colour, radius or state comes
  from a token or a component variant, and `className` is for layout.
