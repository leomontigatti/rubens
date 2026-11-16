import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { sectionOf } from "#/components/app-nav.ts";

// Every page the top bar names: a page in the sidebar is named by its link, any
// other declares its own steps in its route's `staticData.crumbs`.

const appRoutes = fileURLToPath(new URL("../routes/_app", import.meta.url));

/** Not pages a member reaches: `/` redirects to the calendar, `/dev` is the dev patterns page. */
const unnamed = new Set(["/", "/dev/patrones"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(file);
    return entry.name.endsWith(".tsx") && !entry.name.startsWith("-") ? [file] : [];
  });
}

function pagePath(source: string): string | undefined {
  const id = /createFileRoute\("\/_app([^"]*)"\)/.exec(source)?.[1];
  if (id === undefined) return undefined;
  const trimmed = id.replace(/\/$/, "");
  return trimmed === "" ? "/" : trimmed;
}

describe("the top bar's breadcrumbs", () => {
  const pages = routeFiles(appRoutes).map((file) => {
    const source = readFileSync(file, "utf8");
    return { file: path.relative(appRoutes, file), path: pagePath(source), source };
  });

  it("finds the app's pages", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it("names every page: by its sidebar link, or by its route's own crumbs", () => {
    const unnamedPages = pages
      .filter((page) => page.path && !unnamed.has(page.path))
      .filter((page) => !page.source.includes("crumbs:"))
      .filter((page) => sectionOf(page.path!).at(-1)?.to !== page.path)
      .map((page) => page.file);

    expect(unnamedPages).toEqual([]);
  });
});
