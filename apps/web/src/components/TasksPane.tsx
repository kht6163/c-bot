import { useEffect, useMemo, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchTasks, type TaskView } from "../lib/api.ts";
import { timeAgo } from "../lib/path.ts";
import { countByStatus, openChildren, ownersOf, taskLanes } from "../lib/task-tree.ts";

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

  const all = useMemo(() => items ?? [], [items]);
  const owners = useMemo(() => ownersOf(all), [all]);
  // A bot can reassign the last task away from the filtered owner. Falling back
  // to 전체 keeps the pane out of a state whose only control has just vanished.
  const active = owner && owners.includes(owner) ? owner : "";
  const lanes = useMemo(() => taskLanes(all, active), [all, active]);

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
        {countByStatus(all, "in_progress") > 0 ? (
          <span className="task-ledger-live">진행 {countByStatus(all, "in_progress")}</span>
        ) : null}
        <span>대기 {countByStatus(all, "pending")}</span>
        <span>완료 {countByStatus(all, "completed")}</span>
      </p>
      {owners.length > 1 ? (
        <div className="task-owners">
          <button
            type="button"
            className={active === "" ? "task-owner active" : "task-owner"}
            onClick={() => setOwner("")}
          >
            전체
          </button>
          {owners.map((handle) => (
            <button
              key={handle}
              type="button"
              className={active === handle ? "task-owner active" : "task-owner"}
              onClick={() => setOwner(handle)}
            >
              @{handle}
            </button>
          ))}
        </div>
      ) : null}
      {lanes.length === 0 ? <p className="empty">@{active}가 맡은 일이 없습니다</p> : null}
      {lanes.map((lane) => (
        <section key={lane.key} className="task-lane">
          <p className="section-label">
            {lane.label} {lane.nodes.length}
          </p>
          <ul className="task-list">
            {lane.nodes.map((node) => (
              <li key={node.task.id}>
                <TaskRow task={node.task} left={openChildren(node)} />
                {node.children.length > 0 ? (
                  <ul className="task-list task-children">
                    {node.children.map((child) => (
                      <li key={child.id}>
                        <TaskRow task={child} child />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TaskRow({ task, left = 0, child = false }: { task: TaskView; left?: number; child?: boolean }) {
  return (
    <div className={`task-row status-${task.status}${child ? " is-child" : ""}`}>
      <span className="task-dot" aria-hidden="true" />
      <span className="task-body">
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          @{task.ownerHandle}
          {task.requesterHandle !== task.ownerHandle ? (
            <span className="task-from"> ← @{task.requesterHandle}</span>
          ) : null}
          <span className="task-sep">·</span>
          {STATUS_LABEL[task.status]}
          {left > 0 ? <span className="task-left"> · 남은 조각 {left}</span> : null}
        </span>
        {task.detail ? <span className="task-detail">{task.detail}</span> : null}
      </span>
      <span className="task-time">{timeAgo(task.updatedAt)}</span>
    </div>
  );
}
