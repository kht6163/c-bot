import { useEffect, useMemo, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchTasks, type TaskView } from "../lib/api.ts";
import { timeAgo } from "../lib/path.ts";

type Lane = "in_progress" | "pending" | "done";

const LANES: { key: Lane; label: string }[] = [
  { key: "in_progress", label: "진행 중" },
  { key: "pending", label: "대기" },
  { key: "done", label: "끝난 일" },
];

const STATUS_LABEL: Record<TaskView["status"], string> = {
  pending: "대기",
  in_progress: "진행",
  completed: "완료",
  cancelled: "취소",
};

interface Props {
  sessionId: SessionId;
  refreshKey: number;
}

/** The board is the bots' — `task` writes it, this pane only watches. */
export function TasksPane({ sessionId, refreshKey }: Props) {
  const [items, setItems] = useState<TaskView[] | undefined>();
  const [owner, setOwner] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setOwner("");
  }, [sessionId]);

  useEffect(() => {
    setError("");
    void fetchTasks(sessionId)
      .then(setItems)
      .catch((err: unknown) => {
        setItems([]);
        setError(err instanceof Error ? err.message : "작업을 읽지 못했습니다");
      });
  }, [sessionId, refreshKey]);

  const all = items ?? [];
  const owners = useMemo(() => [...new Set(all.map((item) => item.ownerHandle))].sort(), [all]);
  const visible = owner ? all.filter((item) => item.ownerHandle === owner) : all;
  const lanes = LANES.map((lane) => ({
    ...lane,
    items: visible.filter((item) => laneOf(item) === lane.key),
  })).filter((lane) => lane.items.length > 0);

  if (error) {
    return <p className="hint danger">{error}</p>;
  }
  if (!items) {
    return <p className="empty">불러오는 중</p>;
  }
  if (all.length === 0) {
    return <p className="empty">봇이 맡은 일이 여기 쌓입니다</p>;
  }

  return (
    <div className="tasks-pane">
      <p className="task-ledger">
        {count(all, "in_progress") > 0 ? (
          <span className="task-ledger-live">진행 {count(all, "in_progress")}</span>
        ) : null}
        <span>대기 {count(all, "pending")}</span>
        <span>완료 {count(all, "completed")}</span>
      </p>
      {owners.length > 1 ? (
        <div className="task-owners">
          <button
            type="button"
            className={owner === "" ? "task-owner active" : "task-owner"}
            onClick={() => setOwner("")}
          >
            전체
          </button>
          {owners.map((handle) => (
            <button
              key={handle}
              type="button"
              className={owner === handle ? "task-owner active" : "task-owner"}
              onClick={() => setOwner(handle)}
            >
              @{handle}
            </button>
          ))}
        </div>
      ) : null}
      {lanes.length === 0 ? <p className="empty">@{owner}가 맡은 일이 없습니다</p> : null}
      {lanes.map((lane) => (
        <section key={lane.key} className="task-lane">
          <p className="section-label">
            {lane.label} {lane.items.length}
          </p>
          <ul className="task-list">
            {lane.items.map((item) => (
              <li key={item.id} className={`task-row status-${item.status}`}>
                <span className="task-dot" aria-hidden="true" />
                <span className="task-body">
                  <span className="task-title">{item.title}</span>
                  <span className="task-meta">
                    @{item.ownerHandle}
                    {item.requesterHandle !== item.ownerHandle ? (
                      <span className="task-from"> ← @{item.requesterHandle}</span>
                    ) : null}
                    <span className="task-sep">·</span>
                    {STATUS_LABEL[item.status]}
                  </span>
                  {item.detail ? <span className="task-detail">{item.detail}</span> : null}
                </span>
                <span className="task-time">{timeAgo(item.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function laneOf(item: TaskView): Lane {
  if (item.status === "in_progress") {
    return "in_progress";
  }
  return item.status === "pending" ? "pending" : "done";
}

function count(items: readonly TaskView[], status: TaskView["status"]): number {
  return items.filter((item) => item.status === status).length;
}
