import { useEffect, useState } from "react";
import {
  createMemory,
  deleteMemory,
  fetchMemories,
  updateMemory,
  type BotView,
  type MemoryView,
} from "../lib/api.ts";

export function BotMemoryPanel({ bot }: { bot: BotView }) {
  const [items, setItems] = useState<MemoryView[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [cue, setCue] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setQuery("");
    setSelectedId(undefined);
    setTitle("");
    setCue("");
    setBody("");
    setError("");
    void fetchMemories(bot.id)
      .then(setItems)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "failed");
      });
  }, [bot.id]);

  const selected = items.find((item) => item.id === selectedId);

  async function reload(nextQuery = query): Promise<void> {
    const next = await fetchMemories(bot.id, nextQuery);
    setItems(next);
  }

  function startNew(): void {
    setSelectedId(undefined);
    setTitle("");
    setCue("");
    setBody("");
    setError("");
  }

  return (
    <div className="memory-panel">
      <div className="memory-layout">
        <div className="memory-toolbar">
          <input
            value={query}
            placeholder="검색"
            aria-label="메모리 검색"
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              void reload(next);
            }}
          />
        </div>
        <label className="memory-title-field">
          제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="memory-list-pane">
          <div className="memory-list-head">
            <span className="memory-list-label">목록</span>
          </div>
          <ul className="memory-list">
            {items.length === 0 ? (
              <li className="empty">메모리가 없습니다</li>
            ) : (
              items.map((item) => (
                <li key={item.id} className="memory-row">
                  <button
                    type="button"
                    className={item.id === selectedId ? "memory-item active" : "memory-item"}
                    onClick={() => {
                      setSelectedId(item.id);
                      setTitle(item.title);
                      setCue(item.cue);
                      setBody(item.body);
                      setError("");
                    }}
                  >
                    <span className="row-title">{item.title}</span>
                    <span className="row-meta">{item.cue || item.body}</span>
                  </button>
                  <button
                    type="button"
                    className="add-btn memory-row-delete"
                    aria-label={`${item.title} 기억 삭제`}
                    onClick={() => {
                      void (async () => {
                        await deleteMemory(bot.id, item.id);
                        if (item.id === selectedId) {
                          startNew();
                        }
                        await reload();
                      })().catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : "failed");
                      });
                    }}
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <label className="memory-cue-field">
          설명
          <textarea
            rows={2}
            placeholder="언제 이 기억을 꺼내 쓸지. 검색은 제목과 여기로 합니다."
            value={cue}
            onChange={(event) => setCue(event.target.value)}
          />
        </label>
        <label className="memory-body-field">
          내용
          <textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <div className="memory-form-actions">
          {selected ? (
            <button type="button" className="ghost" onClick={startNew}>
              새 기억
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void (async () => {
                if (!title.trim() && !body.trim()) {
                  setError("제목이나 내용을 입력하세요");
                  return;
                }
                if (selected) {
                  const saved = await updateMemory(bot.id, selected.id, { title, cue, body });
                  setSelectedId(saved.id);
                  setTitle(saved.title);
                  setCue(saved.cue);
                  setBody(saved.body);
                  await reload();
                  return;
                }
                await createMemory(bot.id, { title, cue, body });
                setQuery("");
                startNew();
                await reload("");
              })().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "failed");
              });
            }}
          >
            {selected ? "수정" : "추가"}
          </button>
        </div>
      </div>
      {error ? <p className="hint danger">{error}</p> : null}
    </div>
  );
}
