import { describe, expect, it } from "vite-plus/test";

import {
  patientSearchKey,
  patientSearchQueries,
  sharesPatientFilter,
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

describe("sharesPatientFilter", () => {
  const viewer = { organizationId: "org-1", userId: "user-1" };
  const shown = patientSearchKey(viewer, { query: "juan", includeInactive: true });

  it("keeps results while the inactive filter holds", () => {
    expect(sharesPatientFilter(shown, true)).toBe(true);
  });

  it("drops results that may hold patients the filter now hides", () => {
    expect(sharesPatientFilter(shown, false)).toBe(false);
  });

  it("has nothing to keep before the first search", () => {
    expect(sharesPatientFilter(undefined, false)).toBe(false);
  });
});
