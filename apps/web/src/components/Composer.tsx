import { memo, useEffect, useRef } from "react";
import { isImeKeyboardEvent } from "../lib/ime.ts";

interface Props {
  disabled: boolean;
  placeholder: string;
  resetKey: string;
  onSend: (text: string) => void;
}

function ComposerInner({ disabled, placeholder, resetKey, onSend }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const onSendRef = useRef(onSend);
  const composing = useRef(false);
  const skipCompositionEnd = useRef(false);
  onSendRef.current = onSend;

  useEffect(() => {
    if (ref.current) {
      ref.current.value = "";
    }
    composing.current = false;
  }, [resetKey]);

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
        onSendRef.current(text);
      }}
    >
      <textarea
        ref={ref}
        rows={3}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
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
      <button type="submit" disabled={disabled}>
        보내기
      </button>
    </form>
  );
}

export const Composer = memo(ComposerInner, (prev, next) => {
  return (
    prev.disabled === next.disabled &&
    prev.placeholder === next.placeholder &&
    prev.resetKey === next.resetKey
  );
});
