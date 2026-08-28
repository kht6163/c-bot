import { useEffect, useRef } from "react";
import type { SessionId, ToolCallId } from "@cbot/shared";
import type { ChatRow } from "../lib/rows.ts";
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
          ) : row.kind === "thinking" ? (
            <article key={row.key} className={`thinking${row.live ? " live" : ""}`}>
              <span className="who">thinking</span>
              <pre>{row.text}</pre>
            </article>
          ) : row.kind === "tool" ? (
            <article key={row.key} className={`tool-card ui-${row.ui}${row.live ? " live" : ""}`}>
              <span className="who">{row.name}</span>
              <pre>{row.content || row.arguments}</pre>
              {row.pendingApproval && sessionId && onApprove ? (
                <div className="approval">
                  <button type="button" onClick={() => onApprove(row.callId, true)}>
                    허용
                  </button>
                  <button type="button" className="ghost" onClick={() => onApprove(row.callId, false)}>
                    거절
                  </button>
                </div>
              ) : null}
            </article>
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
