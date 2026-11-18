import { describe, expect, it } from "vite-plus/test";

import { mediaIn } from "#/lib/message-media.ts";

describe("a patient's message media", () => {
  it("is the media id Meta's payload names for the message's type", () => {
    expect(mediaIn("image", JSON.stringify({ image: { id: "1234" } }))).toEqual({
      kind: "image",
      mediaId: "1234",
      filename: null,
    });
  });

  it("is none for a payload that is not JSON", () => {
    expect(mediaIn("image", "{not json")).toBeNull();
  });
});
