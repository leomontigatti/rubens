import { describe, expect, it } from "vite-plus/test";

import { compareAdvisories, formatAdvisory, parseAuditReport } from "./audit.mjs";

function advisory(ghsa: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1102341,
    title: "A request smuggling hole in the parser.",
    module_name: "some-package",
    vulnerable_versions: "<=1.2.3",
    patched_versions: ">=1.2.4",
    severity: "high",
    github_advisory_id: ghsa,
    url: `https://github.com/advisories/${ghsa}`,
    findings: [
      {
        version: "1.2.3",
        paths: [".>some-package", ".>other>some-package"],
        dev: false,
        optional: false,
        bundled: false,
      },
    ],
    ...overrides,
  };
}

describe("parseAuditReport", () => {
  it("reads the advisories out of a report keyed by pnpm's numeric id", () => {
    const stdout = JSON.stringify({
      advisories: { "1102341": advisory("GHSA-aaaa-bbbb-cccc") },
      metadata: { vulnerabilities: { high: 1 } },
    });

    expect(parseAuditReport(stdout)).toEqual([advisory("GHSA-aaaa-bbbb-cccc")]);
  });

  it("reads a clean run, where pnpm reports no advisories at all", () => {
    expect(parseAuditReport(JSON.stringify({ advisories: {} }))).toEqual([]);
  });

  it("throws when the registry answered with something that is not a report", () => {
    expect(() => parseAuditReport("ERR_PNPM_AUDIT_BAD_RESPONSE")).toThrow(
      "did not produce a JSON report",
    );
  });

  it("throws on JSON that carries no advisories key, rather than passing", () => {
    expect(() => parseAuditReport(JSON.stringify({ error: "500" }))).toThrow("no advisories");
  });
});

describe("compareAdvisories", () => {
  it("fails only on what the head added, keyed by GHSA", () => {
    const introduced = advisory("GHSA-new0-new0-new0");
    const shared = advisory("GHSA-old0-old0-old0");

    expect(compareAdvisories([introduced, shared], [shared])).toEqual({
      introduced: [introduced],
      inherited: [shared],
    });
  });

  it("inherits an advisory the base already carries, so a fresh CVE reddens nothing", () => {
    const shared = advisory("GHSA-old0-old0-old0");

    expect(compareAdvisories([shared], [shared])).toEqual({
      introduced: [],
      inherited: [shared],
    });
  });

  it("reports nothing for an advisory the branch fixed", () => {
    expect(compareAdvisories([], [advisory("GHSA-old0-old0-old0")])).toEqual({
      introduced: [],
      inherited: [],
    });
  });

  it("keys by GHSA, not by pnpm's numeric id, which is registry-local", () => {
    const head = advisory("GHSA-same-same-same", { id: 1 });
    const base = advisory("GHSA-same-same-same", { id: 2 });

    expect(compareAdvisories([head], [base]).introduced).toEqual([]);
  });
});

describe("formatAdvisory", () => {
  it("names the package, the GHSA, one path and the patched range", () => {
    expect(formatAdvisory(advisory("GHSA-aaaa-bbbb-cccc"))).toBe(
      "high GHSA-aaaa-bbbb-cccc in some-package@1.2.3: " +
        "A request smuggling hole in the parser. " +
        "Path: .>some-package. Patched in >=1.2.4. " +
        "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    );
  });

  it("falls back to the package name when the advisory carries no finding", () => {
    expect(formatAdvisory(advisory("GHSA-aaaa-bbbb-cccc", { findings: [] }))).toContain(
      "Path: some-package.",
    );
  });

  it("falls back to the package name when the finding carries no path", () => {
    const pathless = advisory("GHSA-aaaa-bbbb-cccc", {
      findings: [
        {
          version: "1.2.3",
          paths: [],
          dev: false,
          optional: false,
          bundled: false,
        },
      ],
    });

    expect(formatAdvisory(pathless)).toContain("Path: some-package.");
  });
});
