import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { FilesPane } from "./FilesPane.tsx";
import { GitPane } from "./GitPane.tsx";
import { TasksPane } from "./TasksPane.tsx";

type Tab = "git" | "files" | "tasks";

interface Props {
  sessionId: SessionId;
  refreshKey: number;
  onClose: () => void;
}

export function Inspector({ sessionId, refreshKey, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("git");

  useEffect(() => {
    setTab("git");
  }, [sessionId]);

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-tabs" role="tablist" aria-label="세션 패널">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "git"}
            className={tab === "git" ? "inspector-tab active" : "inspector-tab"}
            onClick={() => setTab("git")}
          >
            Git
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            className={tab === "files" ? "inspector-tab active" : "inspector-tab"}
            onClick={() => setTab("files")}
          >
            파일
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "tasks"}
            className={tab === "tasks" ? "inspector-tab active" : "inspector-tab"}
            onClick={() => setTab("tasks")}
          >
            작업
          </button>
        </div>
        <button type="button" className="ghost inspector-close" aria-label="패널 닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="inspector-body">
        {tab === "git" ? <GitPane sessionId={sessionId} refreshKey={refreshKey} /> : null}
        {tab === "files" ? <FilesPane sessionId={sessionId} refreshKey={refreshKey} /> : null}
        {tab === "tasks" ? <TasksPane sessionId={sessionId} refreshKey={refreshKey} /> : null}
      </div>
    </aside>
  );
}
