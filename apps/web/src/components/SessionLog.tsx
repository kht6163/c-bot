import { useLayoutEffect, useRef, useState } from "react";
import type { ApprovalRemember, SessionId, ToolCallId } from "@cbot/shared";
import type { ChatRow } from "../lib/rows.ts";
import { approvalRuleOf, toolBody, toolHeadline, toolMark } from "../lib/tool-row.ts";
import { MarkdownView } from "./MarkdownView.tsx";

interface Props {
  rows: ChatRow[];
  empty: string;
  compact?: boolean;
  sessionId?: SessionId;
  onApprove?: (callId: ToolCallId, allow: boolean, remember?: ApprovalRemember) => void;
}

export function SessionLog({ rows, empty, compact = false, sessionId, onApprove }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);
  const [atEnd, setAtEnd] = useState(true);

  useLayoutEffect(() => {
    followEnd.current = true;
  }, [sessionId]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const follow = () => {
      if (followEnd.current) log.scrollTop = log.scrollHeight;
      // A short log never fires a scroll event, so the button state settles here too.
      setAtEnd(isAtEnd(log));
    };
    follow();
    // Markdown images and diagrams can grow after the streamed row renders.
    const resize = new ResizeObserver(follow);
    resize.observe(log);
    for (const row of log.children) resize.observe(row);
    return () => resize.disconnect();
  }, [rows, sessionId]);

  return (
    <div className="log-shell">
      <div
        className={compact ? "log pane" : "log"}
        ref={logRef}
        onClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest(".tool-out > summary")) {
            followEnd.current = false;
          }
        }}
        onScroll={(event) => {
          const log = event.currentTarget;
          if (event.target !== log) return;
          followEnd.current = isAtEnd(log);
          setAtEnd(followEnd.current);
        }}
      >
        {rows.length === 0 ? (
          <p className="empty-log">{empty}</p>
        ) : (
          rows.map((row) =>
            row.kind === "status" ? (
              <div key={row.key} className="scaffold" role="status" aria-live="polite">
                <span className="scaffold-pulse" aria-hidden="true" />
                {row.text}
              </div>
            ) : row.kind === "notice" ? (
              row.detail ? (
                <details key={row.key} className="log-notice notice-detail">
                  <summary>{row.text}</summary>
                  <MarkdownView text={row.detail} live={false} />
                </details>
              ) : (
                <p key={row.key} className="log-notice">
                  {row.text}
                </p>
              )
            ) : row.kind === "command" ? (
              <article key={row.key} className="command-note">
                <span className="command-name">/{row.command}</span>
                <MarkdownView text={row.text} live={false} />
              </article>
            ) : row.kind === "thinking" ? (
              <article key={row.key} className={`thinking${row.live ? " live" : ""}`}>
                <span className="who">thinking</span>
                <pre>{row.text}</pre>
              </article>
            ) : row.kind === "memory" ? (
              <article key={row.key} className="memory-chip">
                <span className="who">memory</span>
                {row.text}
              </article>
            ) : row.kind === "tool" ? (
              <ToolRow
                key={row.key}
                row={row}
                sessionId={sessionId}
                onApprove={onApprove}
              />
            ) : (
              <article key={row.key} className={`bubble ${row.kind}${row.live ? " live" : ""}`}>
                {row.kind === "peer" ? <span className="who">@{row.handle}</span> : null}
                {row.kind === "user" ? (
                  <pre>{row.text}</pre>
                ) : (
                  <MarkdownView text={row.text} live={row.live} />
                )}
              </article>
            ),
          )
        )}
      </div>
      {!compact && !atEnd ? (
        <button
          type="button"
          className="jump-end"
          aria-label="맨 아래로"
          onClick={() => {
            const log = logRef.current;
            if (!log) return;
            followEnd.current = true;
            log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3.5 6l4.5 4.5L12.5 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function ToolRow({
  row,
  sessionId,
  onApprove,
}: {
  row: Extract<ChatRow, { kind: "tool" }>;
  sessionId: SessionId | undefined;
  onApprove: ((callId: ToolCallId, allow: boolean, remember?: ApprovalRemember) => void) | undefined;
}) {
  const mark = toolMark(row);
  const headline = toolHeadline(row.arguments);
  const body = toolBody(row.arguments, row.content);
  const rule = row.pendingApproval ? approvalRuleOf(row.name, row.arguments) : "";

  return (
    <article className={`tool-card ui-${row.ui} is-${mark}`}>
      <div className="tool-head">
        <span className={`tool-mark is-${mark}`} aria-hidden="true" />
        <span className="tool-name">{row.name}</span>
        {headline ? <span className="tool-arg">{headline}</span> : null}
      </div>
      {body ? (
        <details className="tool-out">
          <summary>도구 결과</summary>
          <pre>{body}</pre>
        </details>
      ) : null}
      {row.pendingApproval && sessionId && onApprove ? (
        <div className="approval">
          <span className="approval-label">승인 대기</span>
          <button type="button" onClick={() => onApprove(row.callId, true)}>
            허용
          </button>
          {rule ? (
            <>
              <button
                type="button"
                className="ghost"
                title={`이 세션에서 ${rule}로 시작하는 명령은 묻지 않습니다`}
                onClick={() => onApprove(row.callId, true, "session")}
              >
                이 세션에서 <code>{rule}</code> 허용
              </button>
              <button
                type="button"
                className="ghost"
                title={`앞으로 ${rule}로 시작하는 명령은 묻지 않습니다 (config.yaml)`}
                onClick={() => onApprove(row.callId, true, "always")}
              >
                항상 <code>{rule}</code> 허용
              </button>
            </>
          ) : null}
          <button type="button" className="ghost" onClick={() => onApprove(row.callId, false)}>
            거절
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** Within a couple of pixels of the end counts as there: sub-pixel heights round unevenly. */
function isAtEnd(log: HTMLElement): boolean {
  return log.scrollHeight - log.clientHeight - log.scrollTop <= 2;
}
