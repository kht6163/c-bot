import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { findActiveAt } from "@cbot/shared";
import { searchProjectFiles } from "../lib/api.ts";
import { isImeKeyboardEvent } from "../lib/ime.ts";
import { filterMentionOptions, insertMention, type MentionOption } from "../lib/mention.ts";

interface BotHint {
  handle: string;
  title: string;
  role: "leader" | "specialist";
}

interface Props {
  busy: boolean;
  blocked: boolean;
  placeholder: string;
  resetKey: string;
  variant: "hero" | "dock";
  picker?: ReactNode;
  workspace?: string | null;
  bots?: readonly BotHint[];
  onSend: (text: string) => void;
}

function ComposerInner({
  busy,
  blocked,
  placeholder,
  resetKey,
  variant,
  picker,
  workspace,
  bots = [],
  onSend,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const onSendRef = useRef(onSend);
  const composing = useRef(false);
  const skipCompositionEnd = useRef(false);
  const searchTimer = useRef<number>(0);
  const mentionKey = useRef<string | null>(null);
  const [empty, setEmpty] = useState(true);
  const [mention, setMention] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [options, setOptions] = useState<MentionOption[]>([]);
  const [active, setActive] = useState(0);
  onSendRef.current = onSend;

  useEffect(() => {
    if (ref.current) {
      ref.current.value = "";
    }
    composing.current = false;
    setEmpty(true);
    setMention(null);
    setOptions([]);
    mentionKey.current = null;
  }, [resetKey]);

  useEffect(() => {
    return () => window.clearTimeout(searchTimer.current);
  }, []);

  const locked = busy || blocked;
  const canSend = !locked && !empty;
  const menuOpen = mention !== null && options.length > 0;

  function syncMention() {
    const el = ref.current;
    if (!el || composing.current) {
      return;
    }
    const found = findActiveAt(el.value, el.selectionStart);
    if (!found) {
      mentionKey.current = null;
      setMention(null);
      setOptions([]);
      return;
    }
    const key = `${found.start}:${found.query}`;
    const queryChanged = mentionKey.current !== key;
    mentionKey.current = key;
    setMention(found);
    if (!queryChanged) {
      return;
    }
    setActive(0);
    window.clearTimeout(searchTimer.current);
    const query = found.query;
    searchTimer.current = window.setTimeout(() => {
      void (async () => {
        const files = workspace ? await searchProjectFiles(workspace, query).catch(() => []) : [];
        setOptions(filterMentionOptions(query, bots, files));
      })();
    }, 80);
  }

  function applyOption(option: MentionOption) {
    const el = ref.current;
    if (!el || !mention) {
      return;
    }
    const token = option.kind === "bot" ? option.handle : option.path;
    const next = insertMention(el.value, mention, token);
    el.value = next.text;
    el.setSelectionRange(next.caret, next.caret);
    setEmpty(!next.text.trim());
    setMention(null);
    setOptions([]);
    el.focus();
  }

  return (
    <form
      className={variant === "hero" ? "composer hero-composer" : "composer dock"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend || menuOpen) {
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
        setMention(null);
        setOptions([]);
        onSendRef.current(text);
      }}
    >
      <div className="composer-card">
        {menuOpen ? (
          <ul className="mention-menu" role="listbox" aria-label="멘션">
            {options.map((option, index) => (
              <li key={option.kind === "bot" ? `bot:${option.handle}` : `file:${option.path}`}>
                <button
                  type="button"
                  className={index === active ? "mention-option active" : "mention-option"}
                  ref={(node) => {
                    if (index === active) {
                      node?.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyOption(option);
                  }}
                >
                  <span className="mention-token">
                    {option.kind === "bot" ? `@${option.handle}` : option.path}
                  </span>
                  <span className="mention-kind">
                    {option.kind === "bot" ? option.title : "파일"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={ref}
          rows={2}
          disabled={busy}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onInput={() => {
            setEmpty(!(ref.current?.value.trim()));
            syncMention();
          }}
          onClick={() => syncMention()}
          onKeyUp={(e) => {
            if (
              e.key === "ArrowDown" ||
              e.key === "ArrowUp" ||
              e.key === "Enter" ||
              e.key === "Tab" ||
              e.key === "Escape"
            ) {
              return;
            }
            syncMention();
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
              setMention(null);
              setOptions([]);
            } else {
              setEmpty(!(ref.current?.value.trim()));
              syncMention();
            }
          }}
          onKeyDown={(e) => {
            if (isImeKeyboardEvent(e)) {
              return;
            }
            if (menuOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((index) => Math.min(index + 1, options.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                setOptions([]);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                const option = options[active];
                if (option) {
                  e.preventDefault();
                  applyOption(option);
                }
                return;
              }
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
          {picker}
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
    prev.variant === next.variant &&
    prev.picker === next.picker &&
    prev.workspace === next.workspace &&
    prev.bots === next.bots
  );
});
