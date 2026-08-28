import { describe, expect, test } from "bun:test";
import { defaultEffort, effortLabel, leaderTurnLabel } from "../lib/thinking.ts";

describe("effortLabel", () => {
  test("capitalizes known thinking levels", () => {
    expect(effortLabel("high")).toBe("High");
    expect(effortLabel("xhigh")).toBe("Xhigh");
    expect(effortLabel("off")).toBe("Off");
  });

  test("defaultEffort prefers xhigh", () => {
    expect(defaultEffort(["off", "low", "xhigh"])).toBe("xhigh");
    expect(defaultEffort([])).toBeNull();
  });
});

describe("leaderTurnLabel", () => {
  test("prefers the leader pin over the global default", () => {
    expect(
      leaderTurnLabel(
        { model: "cliproxyapi/grok-4.6", thinking: "high" },
        { activeModel: "other", activeThinking: "low" },
      ),
    ).toBe("grok-4.6 · High");
  });

  test("falls back to the global model when the leader has no pin", () => {
    expect(
      leaderTurnLabel({ model: null, thinking: null }, { activeModel: "demo", activeThinking: "xhigh" }),
    ).toBe("demo · Xhigh");
  });
});
