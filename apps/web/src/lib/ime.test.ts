import { describe, expect, test } from "bun:test";
import { isImeKeyboardEvent } from "./ime.ts";

describe("isImeKeyboardEvent", () => {
  test("treats composing and keyCode 229 as IME", () => {
    expect(
      isImeKeyboardEvent({ key: "Enter", keyCode: 13, nativeEvent: { isComposing: true } }),
    ).toBe(true);
    expect(
      isImeKeyboardEvent({ key: "Process", keyCode: 229, nativeEvent: { isComposing: false } }),
    ).toBe(true);
    expect(
      isImeKeyboardEvent({ key: "Enter", keyCode: 13, nativeEvent: { isComposing: false } }),
    ).toBe(false);
  });
});
