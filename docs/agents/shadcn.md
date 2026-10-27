# shadcn/ui in this repo

Components are shadcn/ui, style `new-york`, on Tailwind 4 with the `lucide` icon
set. The configuration is `components.json`; `pnpm exec shadcn info --json` prints
what the CLI resolves from it.

- **Components live in `src/components/ui/`**, imported through the `#/components/ui`
  alias. Only the components a screen uses are in the tree: add one when a screen
  needs it, not in advance.
- **Add with the CLI, then check the diff.** `pnpm exec shadcn add <name> --diff`
  shows what would change. Read the output and apply it by hand when the local file
  has changed; a blind `--overwrite` discards local edits.
- **Check `package.json` after an `add`.** The CLI may install a dependency a component
  needs; it does not remove what it added by mistake. shadcn 4.21 writes
  `import { cn } from "cn"` and installs the unrelated `cn` package: point the import at
  `#/lib/utils` and `pnpm remove cn`.
- **Local edits are kept.** A component file edited here (a variant, a prop, a
  class) is the repo's version. Record a deliberate divergence in a comment at the
  top of the file, with its reason, so the next sync does not undo it.
- **The style rules** for how components are used are in [style-guide.md](./style-guide.md).
