import { useEffect, useId, useRef, useState } from "react";
import { createMemory, deleteMemory, fetchMemories, updateMemory, type MemoryView } from "../lib/api.ts";

interface Form {
  title: string;
  cue: string;
  body: string;
}

const EMPTY: Form = { title: "", cue: "", body: "" };

/** A bot's memory list. Unlike the rest of the panel, every edit here is saved at once. */
export function BotMemoryList({ botId }: { botId: string }) {
  const labelId = useId();
  const [items, setItems] = useState<MemoryView[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState("");
  const latest = useRef(0);

  async function reload(nextQuery: string): Promise<void> {
    const ticket = ++latest.current;
    const next = await fetchMemories(botId, nextQuery);
    // A slower answer to an older query must not replace a newer one.
    if (ticket === latest.current) {
      setItems(next);
    }
  }

  useEffect(() => {
    setQuery("");
    setSearching(false);
    setEditing(undefined);
    setError("");
    void reload("").catch((err: unknown) => setError(err instanceof Error ? err.message : "failed"));
  }, [botId]);

  function open(id: string, next: Form): void {
    setEditing(id);
    setForm(next);
    setError("");
  }

  function run(task: () => Promise<void>): void {
    void task().catch((err: unknown) => setError(err instanceof Error ? err.message : "failed"));
  }

  function save(): void {
    run(async () => {
      if (!form.title.trim() && !form.body.trim()) {
        setError("제목이나 내용을 입력하세요");
        return;
      }
      if (editing && editing !== "new") {
        await updateMemory(botId, editing, form);
      } else {
        await createMemory(botId, form);
      }
      setEditing(undefined);
      await reload(query);
    });
  }

  const formView = (id: string) => (
    <div
      key={`form-${id}`}
      className="team-mem-form"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setEditing(undefined);
        }
      }}
    >
      <input
        className="team-input"
        aria-label="제목"
        placeholder="제목"
        value={form.title}
        autoFocus
        onChange={(event) => setForm({ ...form, title: event.target.value })}
      />
      <input
        className="team-input"
        aria-label="설명"
        placeholder="언제 꺼내 쓸지. 검색은 제목과 여기로 합니다"
        value={form.cue}
        onChange={(event) => setForm({ ...form, cue: event.target.value })}
      />
      <textarea
        className="team-textarea"
        aria-label="내용"
        placeholder="실제로 기억할 사실"
        rows={3}
        value={form.body}
        onChange={(event) => setForm({ ...form, body: event.target.value })}
      />
      <div className="team-mem-actions">
        {id !== "new" ? (
          <button
            type="button"
            className="team-btn"
            onClick={() =>
              run(async () => {
                await deleteMemory(botId, id);
                setEditing(undefined);
                await reload(query);
              })
            }
          >
            삭제
          </button>
        ) : null}
        <span className="team-grow" />
        <button type="button" className="team-btn" onClick={() => setEditing(undefined)}>
          취소
        </button>
        <button type="button" className="team-btn is-strong" onClick={save}>
          {id === "new" ? "추가" : "저장"}
        </button>
      </div>
    </div>
  );

  return (
    <section className="team-sec" aria-labelledby={labelId}>
      <div className="team-sec-head">
        <h3 id={labelId} className="team-sec-title">
          메모리
        </h3>
        <span className="team-count">{items.length}</span>
        <span className="team-grow" />
        <button
          type="button"
          className={searching ? "team-btn is-on" : "team-btn"}
          aria-pressed={searching}
          onClick={() => {
            if (searching && query) {
              setQuery("");
              run(() => reload(""));
            }
            setSearching(!searching);
          }}
        >
          <SearchIcon />
          검색
        </button>
        <button type="button" className="team-btn" onClick={() => open("new", EMPTY)}>
          <PlusIcon />
          추가
        </button>
      </div>
      {searching ? (
        <input
          className="team-input"
          aria-label="메모리 검색"
          placeholder="제목과 설명으로 찾습니다"
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            run(() => reload(event.target.value));
          }}
        />
      ) : null}
      <div className="team-mem-list">
        {editing === "new" ? formView("new") : null}
        {items.map((item) =>
          editing === item.id ? (
            formView(item.id)
          ) : (
            <button
              key={item.id}
              type="button"
              className="team-mem"
              onClick={() => open(item.id, { title: item.title, cue: item.cue, body: item.body })}
            >
              <span className="team-mem-line">
                <span className="team-mem-title">{item.title || "제목 없음"}</span>
                {item.cue ? <span className="team-mem-cue">{item.cue}</span> : null}
              </span>
              {item.body ? <span className="team-mem-body">{item.body}</span> : null}
            </button>
          ),
        )}
        {items.length === 0 && editing !== "new" ? (
          <p className="team-empty">{query ? "맞는 기억이 없습니다" : "기억이 없습니다"}</p>
        ) : null}
      </div>
      {error ? <p className="hint danger">{error}</p> : null}
    </section>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6.2" cy="6.2" r="3.9" stroke="currentColor" strokeWidth="1.3" />
      <path d="m9.2 9.2 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
