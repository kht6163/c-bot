import { useEffect, useRef, useState } from "react";
import { SESSION_TITLE_MAX, normalizeSessionTitle, type SessionSummary } from "@cbot/shared";
import { createSession } from "../lib/api.ts";
import { isImeKeyboardEvent } from "../lib/ime.ts";
import { folderName, homePath } from "../lib/path.ts";

interface Props {
  /** The project folder the session is made in. */
  project: string;
  onClose: () => void;
  onCreated: (session: SessionSummary) => void;
}

export function NewSessionDialog({ project, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function close() {
    if (!creating) {
      onClose();
    }
  }

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (creating) {
      return;
    }
    setCreating(true);
    setError("");
    const name = normalizeSessionTitle(title);
    void createSession(project, name ? { title: name } : {})
      .then(onCreated)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "세션을 만들지 못했습니다");
        setCreating(false);
      });
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <form
        className="modal ns-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          // Enter that only finishes a Hangul syllable must not make the session.
          if (event.key === "Enter" && isImeKeyboardEvent(event)) {
            event.preventDefault();
          }
        }}
      >
        <header className="ns-head">
          <h2 id="new-session-title">새 세션</h2>
          <p className="ns-project" title={project}>
            <span className="ns-project-name">{folderName(project)}</span>
            <span className="ns-project-path">{homePath(project)}</span>
          </p>
        </header>
        <label>
          이름
          <input
            ref={nameRef}
            value={title}
            maxLength={SESSION_TITLE_MAX}
            placeholder="비워 두면 첫 메시지로 정합니다"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error ? <p className="hint danger">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={creating} onClick={close}>
            취소
          </button>
          <button type="submit" disabled={creating}>
            {creating ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}
