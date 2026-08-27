import { memo, useEffect, useRef, useState } from "react";
import { isImeKeyboardEvent } from "../lib/ime.ts";

interface Props {
  busy: boolean;
  blocked: boolean;
  placeholder: string;
  resetKey: string;
  variant: "hero" | "dock";
  onSend: (text: string) => void;
}

function ComposerInner({ busy, blocked, placeholder, resetKey, variant, onSend }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const onSendRef = useRef(onSend);
  const composing = useRef(false);
  const skipCompositionEnd = useRef(false);
  const [empty, setEmpty] = useState(true);
  onSendRef.current = onSend;

  useEffect(() => {
    if (ref.current) {
      ref.current.value = "";
    }
    composing.current = false;
    setEmpty(true);
  }, [resetKey]);

  const locked = busy || blocked;
  const canSend = !locked && !empty;

  return (
    <form
      className={variant === "hero" ? "composer hero-composer" : "composer dock"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) {
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
        setEmpty(true);
        onSendRef.current(text);
      }}
    >
      <div className="composer-card">
        <textarea
          ref={ref}
          rows={variant === "hero" ? 2 : 2}
          disabled={busy}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onInput={() => {
            setEmpty(!(ref.current?.value.trim()));
          }}
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
              setEmpty(true);
            } else {
              setEmpty(!(ref.current?.value.trim()));
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
        <div className="composer-row">
          <span className="composer-hint">
            {blocked ? "프로젝트를 먼저 여세요" : busy ? "생각 중" : ""}
          </span>
          <button type="submit" className="send-btn" disabled={!canSend} aria-label="보내기">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 3.2v9.6M4.2 7l3.8-3.8L11.8 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}

export const Composer = memo(ComposerInner, (prev, next) => {
  return (
    prev.busy === next.busy &&
    prev.blocked === next.blocked &&
    prev.placeholder === next.placeholder &&
    prev.resetKey === next.resetKey &&
    prev.variant === next.variant
  );
});
