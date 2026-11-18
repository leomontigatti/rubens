import { describe, expect, it } from "vite-plus/test";

import { lintProbes, text } from "./lint.test-support.ts";
import type { Diagnostic } from "./lint.test-support.ts";

// The global `fetch` is banned outside the modules that own a network boundary,
// where tests inject a fetcher (`no-restricted-globals` and
// `no-restricted-properties` in vite.config.ts).

const probes = lintProbes("network");

const bannedCodes = new Set(["eslint(no-restricted-globals)", "eslint(no-restricted-properties)"]);
const fetches = (...files: string[]) =>
  probes.lint(...files).filter((d) => bannedCodes.has(d.code));

// The 1-based line a diagnostic starts on.
const line = (d: Diagnostic) => d.labels[0]!.span.line;

const rawFetches = `declare const self: typeof globalThis;

export const called = () => fetch("https://example.com");
export const passed = [1].map(() => fetch);
export type Fetcher = typeof fetch;
export const onGlobal = () => globalThis.fetch("https://example.com");
export const onWindow = () => window.fetch("https://example.com");
export const onSelf = () => self.fetch("https://example.com");
export const bracketed = () => globalThis["fetch"]("https://example.com");
export const { fetch: destructured } = globalThis;
`;

const ownFetches = `import type { Fetcher } from "#/organization/graph-api.ts";

declare const handler: { fetch(request: Request): Promise<Response> };
declare const fakeMeta: { fetch: Fetcher };

export default {
  fetch(request: Request) {
    return handler.fetch(request);
  },
};
export const injected = (fetcher: Fetcher) => fetcher("https://example.com");
export const fake = () => fakeMeta.fetch("https://example.com");
`;

describe("Network lint rules", { timeout: 30_000 }, () => {
  const rawProbe = probes.probe("raw-fetch.ts", rawFetches);

  it("reject the global fetch in every form outside a boundary module, and say where calls belong", () => {
    const found = fetches(rawProbe);

    const lines = [...rawFetches.split("\n").entries()]
      .filter(([, source]) => source.startsWith("export"))
      .map(([index]) => index + 1);
    expect([...new Set(found.map(line))]).toEqual(lines);
    expect(lines).toHaveLength(8);
    expect(found.map(text).join()).toContain("graph-api.ts");
  });

  const ownProbe = probes.probe("own-fetch.ts", ownFetches);

  it("accept a Worker's fetch handler, a method named fetch and an injected fetcher", () => {
    expect(fetches(ownProbe)).toEqual([]);
  });

  const boundary = probes.existing("src/organization/graph-api.ts");
  const script = probes.existing("scripts/setup-organization.ts");

  it("accept the global fetch in the Graph API module and in a script", () => {
    expect(fetches(boundary, script)).toEqual([]);
  });
});
