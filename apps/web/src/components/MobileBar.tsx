import type { SessionActivity } from "../lib/activity.ts";
import { RAIL_ID } from "./Sidebar.tsx";

interface Props {
  /** The open session's name; the start screen has none. */
  title?: string | undefined;
  /** Folder name of the project the open session belongs to. */
  project?: string | undefined;
  /** What the rows hidden in the closed drawer are doing. */
  activity: SessionActivity | undefined;
  menuOpen: boolean;
  onMenu: () => void;
  /** Present while a session is open: opens its Git · 파일 · 작업 sheet. */
  onPanel?: (() => void) | undefined;
}

/** The phone's top bar: the rail lives in a drawer, so this is where it opens from. */
export function MobileBar({ title, project, activity, menuOpen, onMenu, onPanel }: Props) {
  return (
    <header className="mobile-bar">
      <button
        type="button"
        className="bar-btn"
        aria-label={
          activity === "done"
            ? "메뉴 · 작업을 끝낸 세션이 있습니다"
            : activity === "running"
              ? "메뉴 · 작업 중인 세션이 있습니다"
              : "메뉴"
        }
        aria-expanded={menuOpen}
        aria-controls={RAIL_ID}
        onClick={onMenu}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {activity ? (
          <span className={`row-dot bar-dot is-${activity}`} aria-hidden="true" />
        ) : null}
      </button>
      <div className="mobile-title">
        {title ? <span className="mobile-title-main">{title}</span> : null}
        {title && project ? <span className="mobile-title-sub">{project}</span> : null}
      </div>
      {onPanel ? (
        <button type="button" className="bar-btn" aria-label="Git · 파일 · 작업 패널" onClick={onPanel}>
          <PanelIcon size={16} />
        </button>
      ) : null}
    </header>
  );
}

/** A frame with its right pane split off: the Git · 파일 · 작업 panel. */
export function PanelIcon({ size }: { size: number }) {
  return (
    <svg className="bar-icon" width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.6" y="2.6" width="10.8" height="8.8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.2 2.6v8.8" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
