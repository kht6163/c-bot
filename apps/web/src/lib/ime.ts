/** Hangul/IME key events must not submit or intercept composition. */
export function isImeKeyboardEvent(event: {
  key: string;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return event.nativeEvent.isComposing || event.key === "Process" || event.keyCode === 229;
}
