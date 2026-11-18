import { describe, expect, it } from "vite-plus/test";

import { lintProbes, text } from "./lint.test-support.ts";

// An effect lives only in a named hook in `src/hooks`, or in shadcn's own
// components: `no-restricted-imports` in vite.config.ts, off for those two.

const probes = lintProbes("react");

const effectFindings = (file: string) =>
  probes.lint(file).filter((d) => d.code === "eslint(no-restricted-imports)");

const component = (imports: string, body: string) =>
  `${imports}\n\nexport function Probe() {\n  ${body}\n  return null;\n}\n`;

describe("the effect ban", { timeout: 30_000 }, () => {
  const inComponent = probes.probe(
    "component.tsx",
    component(`import { useEffect } from "react";`, "useEffect(() => undefined, []);"),
  );
  const inRoute = probes.probe(
    "route.tsx",
    `import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect } from "react";

export const Route = createFileRoute("/probe")({ component: Probe });

function Probe() {
  useLayoutEffect(() => undefined, []);
  return null;
}
`,
  );

  it("rejects an effect in a component or a route, and names where it goes instead", () => {
    for (const file of [inComponent, inRoute]) {
      const found = effectFindings(file);
      expect(found).toHaveLength(1);
      expect(text(found[0]!)).toContain("src/hooks");
    }
  });

  const renamed = probes.probe(
    "renamed.tsx",
    component(`import { useInsertionEffect as run } from "react";`, "run(() => undefined, []);"),
  );
  const namespaced = probes.probe(
    "namespaced.tsx",
    component(`import * as React from "react";`, "React.useEffect(() => undefined, []);"),
  );
  const defaulted = probes.probe(
    "defaulted.tsx",
    component(`import React from "react";`, "React.useEffect(() => undefined, []);"),
  );

  it("rejects an effect reached by another name: renamed, or through the namespace or the default import", () => {
    expect([renamed, namespaced, defaulted].map((file) => effectFindings(file).length)).toEqual([
      1, 1, 1,
    ]);
  });

  const otherHooks = probes.probe(
    "other-hooks.tsx",
    component(`import { useState } from "react";`, "useState(0);"),
  );

  it("lets the other hooks through", () => {
    expect(effectFindings(otherHooks)).toEqual([]);
  });

  it("allows effects in src/hooks and in shadcn's components", () => {
    const homes = [
      probes.existing("src/hooks/use-mobile.ts"),
      probes.existing("src/components/ui/sidebar.tsx"),
    ];
    expect(homes.map((file) => effectFindings(file).length)).toEqual([0, 0]);
  });
});
