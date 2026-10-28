# shadcn/ui in this repo

Components are shadcn/ui, style `base-nova`: built on Base UI (`@base-ui/react`),
not Radix (ADR-0001), on Tailwind 4 with the `lucide` icon set. The configuration
is `components.json`; `pnpm exec shadcn info --json` prints what the CLI resolves
from it.

- **Components live in `src/components/ui/`**, imported through the `#/components/ui`
  alias. Only the components a screen uses are in the tree: add one when a screen
  needs it, not in advance.
- **Add with the CLI, then check the diff.** `pnpm exec shadcn add <name> --diff`
  shows what would change. Read the output and apply it by hand when the local file
  has changed; a blind `--overwrite` discards local edits.
- **Class merging is the `cn` package**, shadcn's own replacement for `clsx` +
  `tailwind-merge`. Components import it as the CLI writes it, `import { cn } from "cn"`,
  so an `add` needs no fix-up; there is no `src/lib/utils.ts`. An item from another
  registry that still imports `cn` from the `utils` alias gets that import pointed at
  `cn`.
- **Check `package.json` after an `add`.** The CLI may install a dependency a component
  needs; it does not remove what it added by mistake. It does not install
  `@base-ui/react` itself.
- **Toasts are the `toast` component**, built on Base UI's Toast like the rest of the
  kit, not shadcn's `sonner` item, which adds the `sonner` and `next-themes` packages.
- **Base UI's API, not Radix's.** Compose with `render`, not `asChild`:
  `<Button nativeButton={false} render={<Link … />}>` (a non-`<button>` element needs
  `nativeButton={false}`), `<DropdownMenuItem render={<Link … />}>`. A menu item takes
  `onClick`, not `onSelect`. `DropdownMenuLabel` must sit inside a `DropdownMenuGroup`,
  or Base UI throws. Base UI's `Button` defaults to `type="button"`: a submit button says
  `type="submit"`.
- **Local edits are kept.** A component file edited here (a variant, a prop, a
  class) is the repo's version. Record a deliberate divergence in a comment at the
  top of the file, with its reason, so the next sync does not undo it.
- **The style rules** for how components are used are in [style-guide.md](./style-guide.md).
