import { useEffect, useState } from "react";
import {
  createMemory,
  deleteMemory,
  fetchMemories,
  updateMemory,
  type BotView,
  type MemoryView,
} from "../lib/api.ts";

export function BotMemoryPanel({ bot, onClose }: { bot: BotView; onClose: () => void }) {
  const [items, setItems] = useState<MemoryView[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setQuery("");
    setSelectedId(undefined);
    setTitle("");
    setBody("");
    setError("");
    void fetchMemories(bot.id).then(setItems).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "failed");
    });
  }, [bot.id]);

  const selected = items.find((item) => item.id === selectedId);

  async function reload(nextQuery = query): Promise<void> {
    const next = await fetchMemories(bot.id, nextQuery);
    setItems(next);
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
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setSelectedId(undefined);
                setTitle("");
                setBody("");
                setError("");
              }}
            >
              추가
            </button>
          </div>
          <ul className="memory-list">
            {items.length === 0 ? (
              <li className="empty">메모리가 없습니다</li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === selectedId ? "memory-item active" : "memory-item"}
                    onClick={() => {
                      setSelectedId(item.id);
                      setTitle(item.title);
                      setBody(item.body);
                      setError("");
                    }}
                  >
                    <span className="row-title">{item.title}</span>
                    <span className="row-meta">{item.body}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <label className="memory-body-field">
          내용
          <textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
      </div>
      {error ? <p className="hint danger">{error}</p> : null}
      <div className="modal-actions">
        {selected ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void (async () => {
                await deleteMemory(bot.id, selected.id);
                setSelectedId(undefined);
                setTitle("");
                setBody("");
                await reload();
              })().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "failed");
              });
            }}
          >
            삭제
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              if (selected) {
                const saved = await updateMemory(bot.id, selected.id, { title, body });
                setSelectedId(saved.id);
                setTitle(saved.title);
                setBody(saved.body);
              } else {
                const saved = await createMemory(bot.id, { title, body });
                setSelectedId(saved.id);
                setTitle(saved.title);
                setBody(saved.body);
              }
              await reload();
            })().catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "failed");
            });
          }}
        >
          저장
        </button>
      </div>
    </div>
  );
}
