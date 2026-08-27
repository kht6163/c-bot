import { describe, expect, test } from "bun:test";
import { newSessionId, newBotId } from "../src/ids.ts";
import { DELIVERY_REASONS, isDeliveryReason } from "../src/reasons.ts";
import { PROTOCOL_VERSION, SESSION_FORMAT_VERSION } from "../src/index.ts";

describe("ids", () => {
  test("newSessionId uses a ses_ prefix and is unique", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a.startsWith("ses_")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("newBotId uses a bot_ prefix", () => {
    expect(newBotId().startsWith("bot_")).toBe(true);
  });
});

describe("delivery reasons", () => {
  test("every listed reason is recognized", () => {
    for (const reason of DELIVERY_REASONS) {
      expect(isDeliveryReason(reason)).toBe(true);
    }
  });

  test("unknown strings are rejected", () => {
    expect(isDeliveryReason("not_a_reason")).toBe(false);
    expect(isDeliveryReason("")).toBe(false);
  });
});

describe("versions", () => {
  test("format and protocol start at 0", () => {
    expect(SESSION_FORMAT_VERSION).toBe(0);
    expect(PROTOCOL_VERSION).toBe(0);
  });
});
