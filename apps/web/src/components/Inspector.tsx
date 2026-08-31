import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SessionId } from "@cbot/shared";
import { INSPECTOR_MIN_W, clampInspectorWidth, widthFromPointer } from "../lib/inspector.ts";
import { FilesPane } from "./FilesPane.tsx";
import { GitPane } from "./GitPane.tsx";
import { TasksPane } from "./TasksPane.tsx";

type Tab = "git" | "files" | "tasks";

interface Props {
  sessionId: SessionId;
  refreshKey: number;
  width: number;
  onWidth: (px: number) => void;
  onClose: () => void;
}

export function Inspector({ sessionId, refreshKey, width, onWidth, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("git");

  useEffect(() => {
    setTab("git");
  }, [sessionId]);

  // The window listens, not the handle: the pointer spends the drag over the
  // chat, and a release outside the window still ends it.
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const move = (moved: PointerEvent) => onWidth(widthFromPointer(moved.clientX, window.innerWidth));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  return (
    <aside className="inspector">
      <div
        className="inspector-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="패널 너비"
        aria-valuenow={width}
        aria-valuemin={INSPECTOR_MIN_W}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0;
          if (step !== 0) {
            event.preventDefault();
            onWidth(clampInspectorWidth(width + step, window.innerWidth));
          }
        }}
      />
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
