import { useEffect, useMemo, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { createTask, fetchTasks, updateTask, type TaskView } from "../lib/api.ts";

const STATUS_LABEL: Record<TaskView["status"], string> = {
  pending: "대기",
  in_progress: "진행",
  completed: "완료",
  cancelled: "취소",
};

interface Props {
  sessionId: SessionId;
  owners: string[];
  leadHandle: string;
  refreshKey: number;
}

export function TasksPane({ sessionId, owners, leadHandle, refreshKey }: Props) {
  const [items, setItems] = useState<TaskView[]>([]);
  const [filter, setFilter] = useState("all");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(leadHandle);
  const [error, setError] = useState("");

  const handles = useMemo(() => {
    const next = new Set<string>([leadHandle, ...owners]);
    return [...next];
  }, [leadHandle, owners]);

  async function reload(): Promise<void> {
    const next = await fetchTasks(sessionId);
    setItems(next);
  }

  useEffect(() => {
    setError("");
    setFilter("all");
    setOwner(leadHandle);
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "failed");
    });
  }, [sessionId, refreshKey, leadHandle]);

  const visible = items.filter((item) => {
    if (filter === "open") {
      return item.status === "pending" || item.status === "in_progress";
    }
    if (filter === "assigned") {
      return (
        item.requesterHandle !== item.ownerHandle &&
        item.status !== "completed" &&
        item.status !== "cancelled"
      );
    }
    if (filter.startsWith("@")) {
      return item.ownerHandle === filter.slice(1);
    }
    return true;
  });

  return (
    <div className="tasks-pane">
      <div className="task-filters">
        <button
          type="button"
          className={filter === "all" ? "chip active" : "chip"}
          onClick={() => setFilter("all")}
        >
          전체
        </button>
        <button
          type="button"
          className={filter === "open" ? "chip active" : "chip"}
          onClick={() => setFilter("open")}
        >
          미완료
        </button>
        <button
          type="button"
          className={filter === "assigned" ? "chip active" : "chip"}
          onClick={() => setFilter("assigned")}
        >
          요청 대기
        </button>
        {handles.map((handle) => (
          <button
            key={handle}
            type="button"
            className={filter === `@${handle}` ? "chip active" : "chip"}
            onClick={() => setFilter(`@${handle}`)}
          >
            @{handle}
          </button>
        ))}
      </div>
      <form
        className="task-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) {
            return;
          }
          void (async () => {
            await createTask(sessionId, { title, ownerHandle: owner });
            setTitle("");
            await reload();
          })().catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "failed");
          });
        }}
      >
        <input
          value={title}
          placeholder="작업 제목"
          aria-label="작업 제목"
          onChange={(event) => setTitle(event.target.value)}
        />
        <select
          className="field-input select-input"
          aria-label="담당"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          {handles.map((handle) => (
            <option key={handle} value={handle}>
              @{handle}
            </option>
          ))}
        </select>
        <button type="submit">추가</button>
      </form>
      {error ? <p className="hint danger">{error}</p> : null}
      {visible.length === 0 ? (
        <p className="empty">작업이 없습니다</p>
      ) : (
        <ul className="task-list">
          {visible.map((item) => (
            <li key={item.id} className={`task-row status-${item.status}`}>
              <button
                type="button"
                className="task-check"
                aria-label={item.status === "completed" ? "미완료로" : "완료로"}
                onClick={() => {
                  const next = item.status === "completed" ? "pending" : "completed";
                  void updateTask(sessionId, item.id, { status: next })
                    .then(() => reload())
                    .catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "failed");
                    });
                }}
              >
                {item.status === "completed" ? "✓" : "○"}
              </button>
              <div className="task-main">
                <p className="task-title">{item.title}</p>
                <p className="task-meta">
                  @{item.ownerHandle}
                  {item.requesterHandle !== item.ownerHandle ? ` ← @${item.requesterHandle}` : ""}
                  {" · "}
                  {STATUS_LABEL[item.status]}
                </p>
                {item.detail ? <p className="task-detail">{item.detail}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
