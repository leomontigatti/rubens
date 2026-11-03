import { describe, expect, it } from "vite-plus/test";

import {
  patientSearchKey,
  patientSearchMatches,
  patientSearchProblem,
  patientSearchQueries,
  patientSearchRequest,
  patientSearchState,
} from "#/components/patient-search.ts";

const search = { query: "juan", includeInactive: false };

describe("patientSearchKey", () => {
  it("keeps one viewer's results apart from another user's and another organization's", () => {
    const viewer = { organizationId: "org-1", userId: "user-1" };
    const key = JSON.stringify(patientSearchKey(viewer, search));

    expect(JSON.stringify(patientSearchKey({ ...viewer, userId: "user-2" }, search))).not.toBe(key);
    expect(
      JSON.stringify(patientSearchKey({ ...viewer, organizationId: "org-2" }, search)),
    ).not.toBe(key);
  });

  it("falls under the key a patient save invalidates", () => {
    const key = patientSearchKey({ organizationId: "org-1", userId: "user-1" }, search);

    expect(key.slice(0, patientSearchQueries.length)).toEqual(patientSearchQueries);
  });
});

describe("patientSearchRequest", () => {
  it("asks for the trimmed text", () => {
    expect(patientSearchRequest("  juan p ", true)).toEqual({
      query: "juan p",
      includeInactive: true,
    });
  });
});

describe("patientSearchState", () => {
  const answered = { data: "results", isError: false };

  it("is no search with an empty box, whatever an earlier search answered", () => {
    expect(patientSearchState("  ", "juan", answered)).toEqual({
      searching: false,
      waiting: false,
      failed: false,
    });
  });

  it("holds no answer while the text differs from what was asked", () => {
    expect(patientSearchState("juana", "juan", answered)).toEqual({
      searching: true,
      waiting: true,
      failed: false,
    });
  });

  it("holds the answer to the text in the box", () => {
    expect(patientSearchState("juan", "juan", answered)).toEqual({
      searching: true,
      waiting: false,
      found: "results",
      failed: false,
    });
  });

  it("ignores a space typed after the words", () => {
    expect(patientSearchState("juan ", "juan", answered).found).toBe("results");
  });

  it("holds no answer once the search failed, even one fetched earlier", () => {
    expect(patientSearchState("juan", "juan", { data: "results", isError: true })).toEqual({
      searching: true,
      waiting: false,
      failed: true,
    });
  });

  it("waits while the text in the box has not been answered yet", () => {
    expect(patientSearchState("juan", "juan", { isError: false }).waiting).toBe(true);
  });
});

describe("patientSearchProblem", () => {
  it("is nothing while there is no answer or the answer is a list", () => {
    expect(patientSearchProblem({ searching: true, waiting: true, failed: false })).toBeNull();
    expect(
      patientSearchProblem({
        searching: true,
        waiting: false,
        found: { ok: true },
        failed: false,
      }),
    ).toBeNull();
  });

  it("says why the search was refused", () => {
    expect(
      patientSearchProblem({
        searching: true,
        waiting: false,
        found: { ok: false, reason: "unauthenticated" },
        failed: false,
      }),
    ).toBe("Tu sesión terminó. Ingresá de nuevo.");
  });

  it("says the search failed", () => {
    expect(patientSearchProblem({ searching: true, waiting: false, failed: true })).toBe(
      "No pudimos buscar. Probá de nuevo.",
    );
  });
});

describe("patientSearchMatches", () => {
  const answered = (patients: string[]) => ({
    searching: true,
    waiting: false,
    found: { ok: true as const, patients },
    failed: false,
  });

  it("is the patients the answer to the text in the box found, none included", () => {
    expect(patientSearchMatches(answered(["Juan Pérez"]))).toEqual(["Juan Pérez"]);
    expect(patientSearchMatches(answered([]))).toEqual([]);
  });

  it("is nothing while the answer is on its way, refused or failed", () => {
    expect(patientSearchMatches({ searching: true, waiting: true, failed: false })).toBeUndefined();
    expect(
      patientSearchMatches({
        searching: true,
        waiting: false,
        found: { ok: false, reason: "unauthenticated" },
        failed: false,
      }),
    ).toBeUndefined();
    expect(patientSearchMatches({ searching: true, waiting: false, failed: true })).toBeUndefined();
  });
});
