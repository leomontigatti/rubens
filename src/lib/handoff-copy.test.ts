import { describe, expect, it } from "vite-plus/test";

import { handoffReasonLabel } from "#/lib/handoff-copy.ts";

describe("a handoff's reason", () => {
  it("names only what the patient sent", () => {
    expect(handoffReasonLabel("media", ["image"])).toBe("Mandó una foto");
    expect(handoffReasonLabel("media", ["video"])).toBe("Mandó un video");
    expect(handoffReasonLabel("media", ["document"])).toBe("Mandó un archivo");
  });

  it("names each kind once when the patient sent several", () => {
    expect(handoffReasonLabel("media", ["image", "document", "image"])).toBe(
      "Mandó una foto y un archivo",
    );
    expect(handoffReasonLabel("media", ["image", "video", "document"])).toBe(
      "Mandó una foto, un video y un archivo",
    );
  });

  it("keeps any other reason's label", () => {
    expect(handoffReasonLabel("patientAsked", [])).toBe("Pidió hablar con una persona");
  });
});
