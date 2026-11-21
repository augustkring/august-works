import { describe, expect, it } from "vitest";
import { sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      AW_FIRST_PARTY_SUPPORT_ANTHROPIC_API_KEY: "platform-only-fixture-secret",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});
