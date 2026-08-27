import { useEffect, useState } from "react";
import { browseDir, type FsEntry } from "../lib/api.ts";

interface Props {
  open: boolean;
  current: string | null;
  recents?: string[];
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function WorkspacePicker({ open, current, recents = [], onClose, onSelect }: Props) {
  const [path, setPath] = useState(current ?? "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    void load(current ?? undefined);
  }, [open, current]);

  async function load(next?: string) {
    try {
      const listing = await browseDir(next);
      setPath(listing.path);
      setParent(listing.parent);
      setEntries(listing.entries.filter((e) => e.type === "dir"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "browse failed");
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-labelledby="ws-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="ws-title">프로젝트 열기</h2>
        <p className="hint-static">이 폴더에서 코딩 세션이 진행됩니다.</p>
        {recents.length > 0 ? (
          <div className="recent-list">
            {recents.map((item) => (
              <button key={item} type="button" className="dir-btn" onClick={() => onSelect(item)}>
                {folderName(item)}
                <span className="bot-role">{item}</span>
              </button>
            ))}
          </div>
        ) : null}
        <label>
          경로
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void load(path);
              }
            }}
          />
        </label>
        <div className="dir-list">
          {parent ? (
            <button type="button" className="dir-btn" onClick={() => void load(parent)}>
              ..
            </button>
          ) : null}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="dir-btn"
              onClick={() => void load(entry.path)}
            >
              {entry.name}/
            </button>
          ))}
        </div>
        {error ? <p className="hint danger">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
          <button type="button" onClick={() => onSelect(path)}>
            이 폴더 열기
          </button>
        </div>
      </div>
    </div>
  );
}

function folderName(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}
