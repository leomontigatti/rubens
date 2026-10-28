import { describe, expect, it } from "vite-plus/test";

import { patientSearchKey, patientSearchQueries } from "#/components/patient-search.ts";

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
