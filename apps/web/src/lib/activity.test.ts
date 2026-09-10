import { describe, expect, test } from "bun:test";
import { asSessionId } from "@cbot/shared";
import { applyActivity, clearActivity, seedActivity } from "./activity.ts";

const a = asSessionId("session-a");
const b = asSessionId("session-b");

describe("session activity marks", () => {
  test("a running frame marks the session even while it is the one open", () => {
    const next = applyActivity({}, a, true, a);
    expect(next[a]).toBe("running");
  });

  test("a turn ending elsewhere leaves a done mark until the session is opened", () => {
    let state = applyActivity({}, b, true, a);
    state = applyActivity(state, b, false, a);
    expect(state[b]).toBe("done");
    state = clearActivity(state, b);
    expect(b in state).toBe(false);
  });

  test("a turn ending in the open session leaves no mark", () => {
    let state = applyActivity({}, a, true, a);
    state = applyActivity(state, a, false, a);
    expect(a in state).toBe(false);
  });

  test("the list seed marks running sessions without touching done marks", () => {
    const state = seedActivity({ [b]: "done" }, [a]);
    expect(state).toEqual({ [a]: "running", [b]: "done" });
  });

  test("unchanged frames keep the same object so React skips a render", () => {
    const state = applyActivity({}, a, true, undefined);
    expect(applyActivity(state, a, true, undefined)).toBe(state);
    expect(clearActivity(state, b)).toBe(state);
  });
});
