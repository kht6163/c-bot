import { useEffect, useState } from "react";
import { browseDir, pickNativeFolder, type FsEntry } from "../lib/api.ts";
import { folderName } from "../lib/path.ts";

interface Props {
  open: boolean;
  current: string | null;
  recents?: string[];
  launchDir?: string | null;
  launchName?: string | null;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function WorkspacePicker({
  open,
  current,
  recents = [],
  launchDir = null,
  launchName = null,
  onClose,
  onSelect,
}: Props) {
  const [path, setPath] = useState(current ?? "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load(current ?? launchDir ?? undefined);
  }, [open, current, launchDir]);

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
        <p className="hint-static">폴더 탐색기에서 고르거나, 아래에서 직접 이동할 수 있습니다.</p>
        <button
          type="button"
          className="dir-btn launch-btn"
          disabled={picking}
          onClick={() => {
            setPicking(true);
            setError("");
            void pickNativeFolder()
              .then(async (picked) => {
                if ("cancelled" in picked) {
                  return;
                }
                onSelect(picked.path);
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "폴더를 찾지 못했습니다. 아래에서 고르세요.");
              })
              .finally(() => {
                setPicking(false);
              });
          }}
        >
          {picking ? "폴더 창을 확인하세요…" : "폴더 탐색기에서 고르기"}
        </button>
        {launchDir ? (
          <button type="button" className="dir-btn launch-btn" onClick={() => onSelect(launchDir)}>
            실행한 폴더 열기{launchName ? ` · ${launchName}` : ""}
            <span className="row-meta">{launchDir}</span>
          </button>
        ) : null}
        {recents.length > 0 ? (
          <div className="recent-list">
            {recents.map((item) => (
              <button key={item} type="button" className="dir-btn" onClick={() => onSelect(item)}>
                {folderName(item)}
                <span className="row-meta">{item}</span>
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
