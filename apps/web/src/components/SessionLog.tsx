import { useEffect, useRef } from "react";
import type { SessionId, ToolCallId } from "@cbot/shared";
import type { ChatRow } from "../lib/rows.ts";
import { toolBody, toolHeadline, toolMark } from "../lib/tool-row.ts";
import { MarkdownView } from "./MarkdownView.tsx";

interface Props {
  rows: ChatRow[];
  empty: string;
  compact?: boolean;
  sessionId?: SessionId;
  onApprove?: (callId: ToolCallId, allow: boolean) => void;
}

export function SessionLog({ rows, empty, compact = false, sessionId, onApprove }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [rows]);

  return (
    <div className={compact ? "log pane" : "log"} ref={logRef}>
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
            <p key={row.key} className="log-notice">
              {row.text}
            </p>
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
  );
}

function ToolRow({
  row,
  sessionId,
  onApprove,
}: {
  row: Extract<ChatRow, { kind: "tool" }>;
  sessionId: SessionId | undefined;
  onApprove: ((callId: ToolCallId, allow: boolean) => void) | undefined;
}) {
  const mark = toolMark(row);
  const headline = toolHeadline(row.arguments);
  const body = toolBody(row.arguments, row.content);

  return (
    <article className={`tool-card ui-${row.ui} is-${mark}`}>
      <div className="tool-head">
        <span className={`tool-mark is-${mark}`} aria-hidden="true" />
        <span className="tool-name">{row.name}</span>
        {headline ? <span className="tool-arg">{headline}</span> : null}
      </div>
      {body ? (
        <div className="tool-out">
          <pre>{body}</pre>
        </div>
      ) : null}
      {row.pendingApproval && sessionId && onApprove ? (
        <div className="approval">
          <span className="approval-label">승인 대기</span>
          <button type="button" onClick={() => onApprove(row.callId, true)}>
            허용
          </button>
          <button type="button" className="ghost" onClick={() => onApprove(row.callId, false)}>
            거절
          </button>
        </div>
      ) : null}
    </article>
  );
}
