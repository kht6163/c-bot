import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchWorkspaceDir, fetchWorkspaceFile, type DirEntryView, type FilePreviewView } from "../lib/api.ts";
import { MarkdownView } from "./MarkdownView.tsx";

export function FilesPane({ sessionId }: { sessionId: SessionId }) {
  const [dir, setDir] = useState(".");
  const [entries, setEntries] = useState<DirEntryView[]>([]);
  const [preview, setPreview] = useState<FilePreviewView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    setDir(".");
    setPreview(undefined);
  }, [sessionId]);

  useEffect(() => {
    setError("");
    void fetchWorkspaceDir(sessionId, dir)
      .then(setEntries)
      .catch((err: unknown) => {
        setEntries([]);
        setError(err instanceof Error ? err.message : "failed");
      });
  }, [sessionId, dir]);

  const crumbs = crumbsOf(dir);

  return (
    <div className="files-pane">
      <nav className="file-crumbs" aria-label="경로">
        {crumbs.map((crumb) => (
          <button
            key={crumb.path}
            type="button"
            className="text-btn"
            onClick={() => {
              setDir(crumb.path);
              setPreview(undefined);
            }}
          >
            {crumb.label}
          </button>
        ))}
      </nav>
      {error ? <p className="hint danger">{error}</p> : null}
      {preview ? (
        <FilePreview preview={preview} />
      ) : (
        <ul className="file-list">
          {entries.length === 0 ? (
            <li className="empty">빈 폴더입니다</li>
          ) : (
            entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="file-item"
                  onClick={() => {
                    if (entry.kind === "dir") {
                      setDir(entry.path);
                      setPreview(undefined);
                      return;
                    }
                    void fetchWorkspaceFile(sessionId, entry.path)
                      .then(setPreview)
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : "failed");
                      });
                  }}
                >
                  <span className="file-kind">{entry.kind === "dir" ? "폴더" : "파일"}</span>
                  <span className="file-name">{entry.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
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
