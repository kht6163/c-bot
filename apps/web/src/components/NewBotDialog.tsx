import { useEffect, useState } from "react";
import type { BotToolName } from "@cbot/shared";
import { fetchSettings, type SettingsView } from "../lib/api.ts";
import { defaultEffort, effortLabel, effortsFor } from "../lib/thinking.ts";
import { BotToolPicker } from "./BotToolPicker.tsx";
import { ModelSearchSelect } from "./ModelSearchSelect.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    handle: string;
    title: string;
    description: string;
    provider: string | null;
    model: string | null;
    thinking: string | null;
    tools: BotToolName[] | null;
  }) => Promise<void>;
}

export function NewBotDialog({ open, onClose, onCreate }: Props) {
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [choice, setChoice] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState<BotToolName[] | null>(null);
  const [settings, setSettings] = useState<SettingsView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setHandle("");
    setTitle("");
    setDescription("");
    setChoice("");
    setThinking("");
    setTools(null);
    setError("");
    void fetchSettings().then(setSettings);
  }, [open]);

  if (!open) {
    return null;
  }

  const options = (settings?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.id}::${model}`,
      label: `${provider.displayName} / ${model}`,
    })),
  );
  const [providerId, modelId] = choice ? choice.split("::") : [null, null];
  const efforts = effortsFor(settings, providerId ?? null, modelId ?? null);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal-form"
        role="dialog"
        aria-labelledby="bot-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bot-title">새 봇</h2>
        <div className="modal-scroll">
          <p className="hint-static">전문 봇입니다. 직접 대화하지 않고, 리드가 필요할 때 부릅니다.</p>
          <label>
            핸들
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="researcher" />
          </label>
          <label>
            이름
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Researcher" />
          </label>
          <label>
            역할
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="코드베이스를 조사한다"
            />
          </label>
          <div className="field">
            <span className="field-label">모델</span>
            <ModelSearchSelect
              ariaLabel="모델"
              placeholder="모델 검색"
              emptyLabel="기본 모델"
              value={choice}
              options={options}
              onChange={(next) => {
                setChoice(next);
                const [nextProvider, nextModel] = next ? next.split("::") : [null, null];
                const nextEfforts = effortsFor(settings, nextProvider ?? null, nextModel ?? null);
                setThinking(defaultEffort(nextEfforts) ?? "");
              }}
            />
          </div>
          {efforts.length > 0 ? (
            <label>
              Effort
              <select
                className="field-input select-input"
                value={thinking}
                aria-label="Effort"
                onChange={(e) => setThinking(e.target.value)}
              >
                {efforts.map((level) => (
                  <option key={level} value={level}>
                    {effortLabel(level)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {options.length === 0 ? (
            <p className="hint-static">설정 → 모델에서 프로바이더를 추가하면 여기서 고를 수 있습니다.</p>
          ) : null}
          <BotToolPicker value={tools} onChange={setTools} />
        </div>
        {error ? <p className="hint danger">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            onClick={() => {
              const [provider, model] = choice ? choice.split("::") : [null, null];
              void onCreate({
                handle,
                title,
                description,
                provider: provider || null,
                model: model || null,
                thinking: thinking || null,
                tools,
              }).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "failed");
              });
            }}
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
