import { useEffect, useState } from "react";
import {
  fetchSettings,
  saveApiKey,
  saveSettings,
  testLlmConnection,
  type SettingsView,
} from "../lib/api.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export function SettingsDialog({ open, onClose, onChanged }: Props) {
  const [view, setView] = useState<SettingsView | undefined>();
  const [model, setModel] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState<boolean | undefined>();
  const [busy, setBusy] = useState(false);

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
      setOk(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  async function persist() {
    await saveSettings({ model, baseURL });
    if (apiKey.trim()) {
      await saveApiKey(apiKey.trim());
    }
    setView(await fetchSettings());
    onChanged?.();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title">LLM 연결</h2>
        <p className="hint-static">
          xAI 콘솔에서 키를 만든 뒤 붙여 넣고 연결 테스트를 누르세요.{" "}
          <a href="https://console.x.ai" target="_blank" rel="noreferrer">
            console.x.ai
          </a>
        </p>
        <label>
          모델
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          Base URL
          <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
        </label>
        <label>
          API 키 {view?.hasApiKey ? "(저장됨)" : "(없음)"}
          <input
            type="password"
            value={apiKey}
            placeholder={view?.hasApiKey ? "새 키를 넣으면 교체합니다" : "XAI_API_KEY"}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p className={`hint ${ok === true ? "" : ok === false ? "danger" : ""}`}>{status}</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setStatus("");
                setOk(undefined);
                try {
                  await persist();
                  const probe = await testLlmConnection({
                    model,
                    baseURL,
                    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                  });
                  setOk(probe.ok);
                  setStatus(probe.ok ? probe.message : `${probe.reason ?? "error"}: ${probe.message}`);
                  if (apiKey.trim()) {
                    setApiKey("");
                  }
                } catch (err) {
                  setOk(false);
                  setStatus(err instanceof Error ? err.message : "연결 테스트 실패");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? "확인 중…" : "연결 테스트"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await persist();
                  setStatus("저장했습니다. 다음 턴부터 적용됩니다.");
                  setOk(true);
                  setApiKey("");
                } catch (err) {
                  setOk(false);
                  setStatus(err instanceof Error ? err.message : "저장 실패");
                } finally {
                  setBusy(false);
                }
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
