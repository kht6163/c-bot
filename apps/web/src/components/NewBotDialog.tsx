import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { handle: string; title: string; description: string }) => Promise<void>;
}

export function NewBotDialog({ open, onClose, onCreate }: Props) {
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-labelledby="bot-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="bot-title">새 봇</h2>
        <label>
          핸들
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="researcher" />
        </label>
        <label>
          이름
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Researcher" />
        </label>
        <label>
          역할
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="코드베이스를 조사한다"
          />
        </label>
        {error ? <p className="hint danger">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            onClick={() => {
              void onCreate({ handle, title, description }).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "failed");
              });
            }}
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
