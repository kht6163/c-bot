import { useEffect, useState } from "react";
import { fetchSettings, type BotView, type SettingsView } from "../lib/api.ts";
import { defaultEffort, effortLabel, effortsFor } from "../lib/thinking.ts";
import { BotMemoryPanel } from "./BotMemoryPanel.tsx";
import { ModelSearchSelect } from "./ModelSearchSelect.tsx";

interface Props {
  bot: BotView | undefined;
  onClose: () => void;
  onSave: (input: {
    title: string;
    description: string;
    soul: string;
    provider: string | null;
    model: string | null;
    thinking: string | null;
  }) => Promise<void>;
}

export function EditBotDialog({ bot, onClose, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [soul, setSoul] = useState("");
  const [choice, setChoice] = useState("");
  const [thinking, setThinking] = useState("");
  const [settings, setSettings] = useState<SettingsView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bot) {
      return;
    }
    setTitle(bot.title);
    setDescription(bot.description);
    setSoul(bot.soul ?? "");
    setChoice(bot.provider && bot.model ? `${bot.provider}::${bot.model}` : "");
    setThinking(bot.thinking ?? "");
    setError("");
    void fetchSettings().then(setSettings);
  }, [bot]);

  if (!bot) {
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
        className="modal modal-wide"
        role="dialog"
        aria-labelledby="edit-bot-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-bot-title">{bot.role === "leader" ? "Leader" : `@${bot.handle}`}</h2>
        <div className="modal-scroll bot-settings">
          <div className="bot-settings-profile">
            {bot.role === "leader" ? (
              <p className="hint-static">고정 리드입니다. 삭제할 수 없습니다. 모델과 프롬프트를 바꿉니다.</p>
            ) : (
              <p className="hint-static">직접 대화하지 않습니다. 리드가 이 봇을 부릅니다.</p>
            )}
            <label>
              이름
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              역할
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
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
                  value={thinking && efforts.includes(thinking) ? thinking : (defaultEffort(efforts) ?? "")}
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
            <label className="bot-settings-prompt">
              프롬프트
              <textarea rows={6} value={soul} onChange={(e) => setSoul(e.target.value)} />
            </label>
          </div>
          <section className="memory-section" aria-label="메모리">
            <h3 className="field-label">메모리</h3>
            <p className="hint-static">이 봇만 쓰는 기억입니다. 추가하면 목록에 바로 남습니다.</p>
            <BotMemoryPanel bot={bot} />
          </section>
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
              const levels = effortsFor(settings, provider || null, model || null);
              const nextThinking =
                thinking && levels.includes(thinking) ? thinking : defaultEffort(levels);
              void onSave({
                title,
                description,
                soul,
                provider: provider || null,
                model: model || null,
                thinking: nextThinking,
              }).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "failed");
              });
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
