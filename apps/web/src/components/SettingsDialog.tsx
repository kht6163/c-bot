import { useEffect, useState } from "react";
import { fetchSettings, saveApiKey, saveSettings, type SettingsView } from "../lib/api.ts";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const [view, setView] = useState<SettingsView | undefined>();
  const [model, setModel] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void fetchSettings().then((next) => {
      if (cancelled) {
        return;
      }
      setView(next);
      setModel(next.model);
      setBaseURL(next.baseURL);
      setApiKey("");
      setStatus("");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title">설정</h2>
        <label>
          모델
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          Base URL
          <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
        </label>
        <label>
          XAI_API_KEY {view?.hasApiKey ? "(저장됨)" : "(없음)"}
          <input
            type="password"
            value={apiKey}
            placeholder={view?.hasApiKey ? "새 키를 넣으면 교체합니다" : "키를 입력하세요"}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p className="hint">{status}</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await saveSettings({ model, baseURL });
                if (apiKey.trim()) {
                  await saveApiKey(apiKey.trim());
                }
                setStatus("저장했습니다. 다음 턴부터 적용됩니다.");
                setApiKey("");
                setView(await fetchSettings());
              })();
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
