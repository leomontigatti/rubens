import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { serverAnswer } from "#/components/save-failure.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serverAnswer", () => {
  it("answers null when the call throws, logging the tag and the error's class but not its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const answer = await serverAnswer("patient-save", "/pacientes/p-1", async () => {
      throw new TypeError("Failed query: insert into patients params: 30111222,Ana");
    });

    expect(answer).toBeNull();
    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0]!.join(" ");
    expect(line).toContain("[save-failed]");
    expect(line).toContain("patient-save");
    expect(line).toContain("/pacientes/p-1");
    expect(line).toContain("TypeError");
    expect(line).not.toContain("30111222");
  });
});
