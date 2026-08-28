import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchWorkspaceDir, fetchWorkspaceFile, type DirEntryView, type FilePreviewView } from "../lib/api.ts";
import { MarkdownView } from "./MarkdownView.tsx";

export function FilesPane({ sessionId, refreshKey }: { sessionId: SessionId; refreshKey: number }) {
  const [dir, setDir] = useState(".");
  const [entries, setEntries] = useState<DirEntryView[] | undefined>();
  const [preview, setPreview] = useState<FilePreviewView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    setDir(".");
    setPreview(undefined);
  }, [sessionId]);

  useEffect(() => {
    setEntries(undefined);
  }, [sessionId, dir]);

  useEffect(() => {
    setError("");
    void fetchWorkspaceDir(sessionId, dir)
      .then(setEntries)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "폴더를 읽지 못했습니다");
      });
  }, [sessionId, dir, refreshKey]);

  if (preview) {
    return (
      <div className="files-pane">
        <div className="file-head">
          <button type="button" className="file-back" onClick={() => setPreview(undefined)}>
            ← 목록
          </button>
          <span className="file-open" title={preview.path}>
            {baseName(preview.path)}
          </span>
        </div>
        {error ? <p className="hint danger">{error}</p> : null}
        <FilePreview preview={preview} />
      </div>
    );
  }

  return (
    <div className="files-pane">
      <nav className="file-crumbs" aria-label="경로">
        {crumbsOf(dir).map((crumb, i, all) =>
          i === all.length - 1 ? (
            <span key={crumb.path} className="file-crumb current">
              {crumb.label}
            </span>
          ) : (
            <span key={crumb.path} className="file-crumb">
              <button type="button" className="file-crumb-btn" onClick={() => setDir(crumb.path)}>
                {crumb.label}
              </button>
              <span className="file-crumb-sep">/</span>
            </span>
          ),
        )}
      </nav>
      {error ? <p className="hint danger">{error}</p> : null}
      {!entries ? (
        <p className="empty">불러오는 중</p>
      ) : entries.length === 0 ? (
        <p className="empty">빈 폴더입니다</p>
      ) : (
        <ul className="file-list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="file-item"
                aria-label={`${entry.kind === "dir" ? "폴더" : "파일"} ${entry.name}`}
                onClick={() => {
                  if (entry.kind === "dir") {
                    setDir(entry.path);
                    return;
                  }
                  void fetchWorkspaceFile(sessionId, entry.path)
                    .then(setPreview)
                    .catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "파일을 읽지 못했습니다");
                    });
                }}
              >
                <EntryIcon dir={entry.kind === "dir"} />
                <span className="file-name">{entry.name}</span>
                {entry.kind === "dir" ? (
                  <span className="file-chevron" aria-hidden="true">
                    ›
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryIcon({ dir }: { dir: boolean }) {
  return (
    <svg className="file-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {dir ? (
        <path
          d="M2 4.2c0-.7.5-1.2 1.2-1.2h2.9l1.3 1.5h4.4c.7 0 1.2.5 1.2 1.2v5.1c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M4 2.6h4.4L12 6.2v7.2c0 .5-.4.9-.9.9H4.9c-.5 0-.9-.4-.9-.9V3.5c0-.5.4-.9.9-.9zM8.3 2.8V6h3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function FilePreview({ preview }: { preview: FilePreviewView }) {
  if (preview.kind === "missing") {
    return <p className="empty">파일이 없습니다</p>;
  }
  if (preview.kind === "binary") {
    return <p className="empty">미리볼 수 없는 파일입니다 ({preview.bytes} bytes)</p>;
  }
  if (isMarkdown(preview.path)) {
    return (
      <div className="file-preview">
        <MarkdownView text={preview.text} />
      </div>
    );
  }
  return (
    <pre className="file-preview-code">
      <code>{preview.text}</code>
    </pre>
  );
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function crumbsOf(dir: string): { label: string; path: string }[] {
  const parts = dir === "." || dir === "" ? [] : dir.split("/").filter((part) => part.length > 0);
  const crumbs = [{ label: "루트", path: "." }];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}
