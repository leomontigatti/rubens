import { registerHooks } from "node:module";

// Loaded with `--import` by the eval scripts (package.json), which run on
// plain Node. The app's modules import each other through `#/` (package.json
// `imports`, which Vite and TypeScript read), but Node 22 refuses a specifier
// that starts `#/`, so this resolves it to `src/` itself and hands every other
// specifier, node_modules included, to Node unchanged.

const src = new URL("../../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("#/")) {
      return nextResolve(new URL(specifier.slice(2), src).href, context);
    }
    return nextResolve(specifier, context);
  },
});
