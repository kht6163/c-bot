import { useEffect, useRef, useState } from "react";
import { isImeKeyboardEvent } from "../lib/ime.ts";

interface Props {
  disabled: boolean;
  placeholder: string;
  resetKey: string;
  onSend: (text: string) => void;
}

/**
 * Uncontrolled textarea so Hangul composition is not reset by React value writes.
 * Space/arrow are not required to "confirm" a syllable before it can be sent.
 */
export function Composer({ disabled, placeholder, resetKey, onSend }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const skipCompositionEnd = useRef(false);
  const [hasText, setHasText] = useState(false);

  useEffect(() => {
    if (ref.current) {
      ref.current.value = "";
    }
    setHasText(false);
    composing.current = false;
  }, [resetKey]);

  function syncHasText() {
    setHasText((ref.current?.value.trim().length ?? 0) > 0);
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) {
          return;
        }
        const text = ref.current?.value.trim() ?? "";
        if (text.length === 0) {
          return;
        }
        skipCompositionEnd.current = composing.current;
        composing.current = false;
        if (ref.current) {
          ref.current.value = "";
        }
        setHasText(false);
        onSend(text);
      }}
    >
      <textarea
        ref={ref}
        rows={3}
        disabled={disabled}
        placeholder={placeholder}
        defaultValue=""
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (skipCompositionEnd.current) {
            skipCompositionEnd.current = false;
            if (ref.current) {
              ref.current.value = "";
            }
            setHasText(false);
            return;
          }
          syncHasText();
        }}
        onInput={() => {
          if (!composing.current) {
            syncHasText();
          }
        }}
        onKeyDown={(e) => {
          if (isImeKeyboardEvent(e)) {
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button type="submit" disabled={disabled || !hasText}>
        보내기
      </button>
    </form>
  );
}
