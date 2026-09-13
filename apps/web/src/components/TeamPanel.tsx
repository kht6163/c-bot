import { useEffect, useId, useRef, useState } from "react";
import { createBot, fetchSettings, updateBot, type BotView, type SettingsView } from "../lib/api.ts";
import { avatarText } from "../lib/graph.ts";
import {
  AUTO_COMPACT_IDLE_PRESETS,
  NEW_BOT,
  autoCompactIdleFromPreset,
  autoCompactIdlePresetOf,
  draftChanges,
  draftOf,
  emptyDraft,
  isDirty,
  lineCount,
  parseAutoCompactIdlePreset,
  rosterMeta,
  shortSkillsPath,
  type BotDraft,
} from "../lib/team-panel.ts";
import { BotMemoryList, PlusIcon } from "./BotMemoryList.tsx";
import { BotToolList } from "./BotToolList.tsx";
import { LeadMark } from "./LeadMark.tsx";
import { ModelChip } from "./ModelChip.tsx";
import { PromptEditor } from "./PromptEditor.tsx";

interface Props {
  /** The bot to open on, or NEW_BOT to start making one. */
  target: string;
  bots: BotView[];
  onClose: () => void;
  onSaved: (bot: BotView) => void;
  onCreated: (bot: BotView) => void;
}

/**
 * Bot settings beside the roster, on the same frame as the app settings.
 * Edits stay as a draft per bot until saved, so switching bots loses nothing;
 * memory is the exception and saves as it is edited.
 */
export function TeamPanel({ target, bots, onClose, onSaved, onCreated }: Props) {
  const [selected, setSelected] = useState(target);
  const [returnTo, setReturnTo] = useState<string | undefined>(target === NEW_BOT ? undefined : target);
  const [drafts, setDrafts] = useState<Record<string, BotDraft>>({});
  const [settings, setSettings] = useState<SettingsView | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const basicsId = useId();
  const promptId = useId();

  const making = selected === NEW_BOT;
  const current = making ? undefined : (bots.find((item) => item.id === selected) ?? bots[0]);
  const key = making ? NEW_BOT : (current?.id ?? "");
  const saved = current ? draftOf(current) : emptyDraft();
  const draft = drafts[key] ?? saved;
  const changes = draftChanges(saved, draft);
  const lead = current?.role === "leader";
  const handle = making ? draft.handle.trim() : (current?.handle ?? "");

  function dirtyDraft(id: string, value: BotDraft): boolean {
    if (id === NEW_BOT) {
      return value.handle.trim() !== "" || isDirty(draftChanges(emptyDraft(), value));
    }
    const bot = bots.find((item) => item.id === id);
    return bot ? isDirty(draftChanges(draftOf(bot), value)) : false;
  }

  const dirty = dirtyDraft(key, draft);
  const anyDirty = Object.entries(drafts).some(([id, value]) => dirtyDraft(id, value));

  function edit(patch: Partial<BotDraft>): void {
    setDrafts((all) => ({ ...all, [key]: { ...(all[key] ?? saved), ...patch } }));
  }

  function drop(id: string): void {
    setDrafts((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  function close(): void {
    if (anyDirty && !window.confirm("저장하지 않은 변경이 있습니다. 버리고 닫을까요?")) {
      return;
    }
    onClose();
  }

  const closeLatest = useRef(close);
  closeLatest.current = close;

  // The panel mounts once per opening; a later bot is a selection, not a new target.
  useEffect(() => {
    void fetchSettings()
      .then(setSettings)
      .catch(() => {
        // Without settings the model chip cannot list models; the panel still edits the rest.
      });
    if (target !== NEW_BOT) {
      closeRef.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".model-chip-menu")) {
        return;
      }
      closeLatest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function select(id: string): void {
    setSelected(id);
    setError("");
  }

  function startNew(): void {
    if (!making) {
      setReturnTo(current?.id);
    }
    select(NEW_BOT);
  }

  function run(task: () => Promise<void>): void {
    setSaving(true);
    setError("");
    void task()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setSaving(false));
  }

  function save(): void {
    if (!current) {
      return;
    }
    const id = current.id;
    run(async () => {
      const next = await updateBot(id, {
        title: draft.title,
        description: draft.description,
        soul: draft.soul,
        provider: draft.provider,
        model: draft.model,
        thinking: draft.thinking,
        hidden: draft.hidden,
        tools: draft.tools,
        autoCompactIdle: draft.autoCompactIdle,
        autoCompactIdleMs: draft.autoCompactIdleMs,
      });
      drop(id);
      onSaved(next);
    });
  }

  function create(): void {
    run(async () => {
      const next = await createBot({
        handle: draft.handle,
        title: draft.title,
        description: draft.description,
        provider: draft.provider,
        model: draft.model,
        thinking: draft.thinking,
        tools: draft.tools,
        ...(draft.soul.trim() ? { soul: draft.soul } : {}),
      });
      drop(NEW_BOT);
      onCreated(next);
      select(next.id);
    });
  }

  function cancelNew(): void {
    if (returnTo && bots.some((item) => item.id === returnTo)) {
      drop(NEW_BOT);
      select(returnTo);
      return;
    }
    const others = Object.entries(drafts).some(([id, value]) => id !== NEW_BOT && dirtyDraft(id, value));
    if (others && !window.confirm("저장하지 않은 변경이 있습니다. 버리고 닫을까요?")) {
      return;
    }
    onClose();
  }

  const hasModels = Boolean(settings?.providers.some((item) => item.models.length > 0));
  const newDraft = drafts[NEW_BOT] ?? emptyDraft();

  return (
    <div className="settings-overlay" role="presentation">
      <div className="settings-mask" aria-hidden="true" onClick={close} />
      <div className="team-panel" role="dialog" aria-modal="true" aria-label="팀">
        <nav className="team-nav" aria-label="봇 목록">
          <div className="team-nav-title">팀</div>
          <div className="team-roster">
            {bots.map((bot) => {
              const value = drafts[bot.id] ?? draftOf(bot);
              const active = !making && bot.id === current?.id;
              return (
                <button
                  key={bot.id}
                  type="button"
                  className={`team-bot${active ? " is-active" : ""}${value.hidden ? " is-hidden" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => select(bot.id)}
                >
                  <Avatar bot={bot} />
                  <span className="team-bot-text">
                    <span className="team-bot-line">
                      <span className="team-bot-handle">@{bot.handle}</span>
                      {bot.role === "leader" ? <span className="row-badge">LEAD</span> : null}
                      {dirtyDraft(bot.id, value) ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
                    </span>
                    <span className="team-bot-meta">{rosterMeta(value)}</span>
                  </span>
                </button>
              );
            })}
            {making || drafts[NEW_BOT] ? (
              <button
                type="button"
                className={making ? "team-bot is-active" : "team-bot"}
                aria-current={making ? "true" : undefined}
                onClick={() => select(NEW_BOT)}
              >
                <span className="team-avatar is-new">
                  <PlusIcon />
                </span>
                <span className="team-bot-text">
                  <span className="team-bot-line">
                    <span className="team-bot-handle">
                      {newDraft.handle.trim() ? `@${newDraft.handle.trim()}` : "새 봇"}
                    </span>
                  </span>
                  <span className="team-bot-meta">{rosterMeta(newDraft)}</span>
                </span>
              </button>
            ) : null}
          </div>
          <button type="button" className="team-add" onClick={startNew}>
            <PlusIcon />
            새 봇
          </button>
        </nav>
        <div className="team-detail">
          <header className="team-head">
            <span className={`team-avatar is-lg${lead ? " is-lead" : ""}${making ? " is-new" : ""}`}>
              {lead ? <LeadMark size={20} /> : making ? <PlusIcon /> : avatarText(handle)}
            </span>
            <div className="team-id">
              <div className="team-id-top">
                <h2 className="team-name">{making ? "새 봇" : draft.title || handle}</h2>
                {lead ? (
                  <span className="row-badge" title="고정 리드입니다. 삭제할 수 없습니다">
                    LEAD
                  </span>
                ) : (
                  <span className="team-tag" title="직접 대화하지 않습니다. 리드가 이 봇을 부릅니다">
                    전문 봇
                  </span>
                )}
              </div>
              <div className="team-id-sub">
                {making ? (
                  <span className="team-id-role">직접 대화하지 않고, 리드가 필요할 때 부릅니다</span>
                ) : (
                  <>
                    <span className="team-handle">@{handle}</span>
                    {draft.description ? (
                      <>
                        <span className="team-sep" />
                        <span className="team-id-role">{draft.description}</span>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            <div className="team-head-tools">
              {changes.model ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
              {settings && hasModels ? (
                <ModelChip
                  settings={settings}
                  value={{ provider: draft.provider, model: draft.model, thinking: draft.thinking }}
                  allowDefault
                  placement="down"
                  onChange={(next) =>
                    edit(
                      next
                        ? { provider: next.provider, model: next.model, thinking: next.thinking }
                        : { provider: null, model: null, thinking: null },
                    )
                  }
                />
              ) : (
                <span className="team-note">기본 모델</span>
              )}
              {!lead && !making ? (
                <label className="team-switch">
                  {changes.hidden ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
                  <span>로스터에서 숨김</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={draft.hidden}
                    onChange={(event) => edit({ hidden: event.target.checked })}
                  />
                  <span className="team-switch-track" aria-hidden="true" />
                </label>
              ) : null}
            </div>
            <button ref={closeRef} type="button" className="settings-close" onClick={close}>
              <CloseIcon />
              <span className="hidden-label">닫기</span>
            </button>
          </header>
          <div className="team-body">
            <div className="team-col">
              <section className="team-sec" aria-labelledby={basicsId}>
                <div className="team-sec-head">
                  <h3 id={basicsId} className="team-sec-title">
                    기본
                  </h3>
                  {changes.basics ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
                </div>
                {making ? (
                  <label className="team-field">
                    핸들
                    <input
                      className="team-input is-mono"
                      value={draft.handle}
                      placeholder="researcher"
                      autoFocus
                      onChange={(event) => edit({ handle: event.target.value })}
                    />
                  </label>
                ) : null}
                <div className="team-fields">
                  <label className="team-field">
                    이름
                    <input
                      className="team-input"
                      value={draft.title}
                      placeholder={making ? "Researcher" : handle}
                      onChange={(event) => edit({ title: event.target.value })}
                    />
                  </label>
                  <label className="team-field">
                    역할
                    <input
                      className="team-input"
                      value={draft.description}
                      placeholder="코드베이스를 조사한다"
                      onChange={(event) => edit({ description: event.target.value })}
                    />
                  </label>
                </div>
              </section>
              <BotToolList value={draft.tools} changed={changes.tools} onChange={(tools) => edit({ tools })} />
              <section className="team-sec" aria-label="자동 요약">
                <div className="team-sec-head">
                  <h3 className="team-sec-title">자동 요약</h3>
                  {changes.autoCompact ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
                </div>
                <label className="team-field">
                  유휴 시 컨텍스트 요약
                  <select
                    className="team-input"
                    value={autoCompactIdlePresetOf(draft)}
                    onChange={(event) =>
                      edit(autoCompactIdleFromPreset(parseAutoCompactIdlePreset(event.target.value)))
                    }
                  >
                    {AUTO_COMPACT_IDLE_PRESETS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="team-note">
                  끔이 기본입니다. 켜면 이 봇 세션만, 유휴 시간과 컨텍스트 한도(
                  <span className="team-mono">compactAt</span>)를 함께 넘길 때{" "}
                  <span className="team-mono">/compact</span>와 같은 요약을 합니다.
                </p>
              </section>
            </div>
            <div className="team-col">
              <section className="team-sec team-prompt" aria-labelledby={promptId}>
                <div className="team-sec-head">
                  <h3 id={promptId} className="team-sec-title">
                    프롬프트
                  </h3>
                  {changes.soul ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
                  <span className="team-sec-meta team-mono">SOUL.md · {lineCount(draft.soul)}줄</span>
                </div>
                <PromptEditor
                  value={draft.soul}
                  label="프롬프트"
                  {...(making ? { placeholder: "비워 두면 이름과 역할로 기본 프롬프트를 만듭니다" } : {})}
                  onChange={(soul) => edit({ soul })}
                />
              </section>
              {current && !making ? <BotMemoryList botId={current.id} /> : null}
              {current && !making ? <Skills bot={current} /> : null}
            </div>
          </div>
          <footer className="team-foot">
            {error ? (
              <p className="hint danger team-foot-note">{error}</p>
            ) : (
              <p className="team-foot-note">
                {making ? "메모리와 스킬은 만든 뒤에 씁니다" : "메모리는 고치는 즉시 저장됩니다"}
              </p>
            )}
            <span className="team-grow" />
            {making ? (
              <>
                <button type="button" className="team-ghost" onClick={cancelNew}>
                  취소
                </button>
                <button
                  type="button"
                  className="team-primary"
                  disabled={!draft.handle.trim() || saving}
                  onClick={create}
                >
                  만들기
                </button>
              </>
            ) : (
              <>
                <button type="button" className="team-ghost" disabled={!dirty || saving} onClick={() => drop(key)}>
                  되돌리기
                </button>
                <button type="button" className="team-primary" disabled={!dirty || saving} onClick={save}>
                  저장
                </button>
              </>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}

function Avatar({ bot }: { bot: BotView }) {
  const lead = bot.role === "leader";
  return (
    <span className={lead ? "team-avatar is-lead" : "team-avatar"}>
      {lead ? <LeadMark size={16} /> : avatarText(bot.handle)}
    </span>
  );
}

function Skills({ bot }: { bot: BotView }) {
  const [copied, setCopied] = useState(false);
  const skills = bot.skills ?? [];
  const dir = bot.skillsDir;
  return (
    <section className="team-sec" aria-label="스킬">
      <div className="team-sec-head team-skills">
        <h3 className="team-sec-title">스킬</h3>
        {skills.length > 0 ? (
          skills.map((name) => (
            <code key={name} className="team-skill">
              {name}
            </code>
          ))
        ) : (
          <span className="team-note">없음</span>
        )}
        {dir ? (
          <>
            <span className="team-path" title={`${dir}\n이 폴더의 마크다운이 프롬프트에 들어갑니다`}>
              {shortSkillsPath(dir)}
            </span>
            <button
              type="button"
              className="team-copy"
              aria-label={copied ? "복사했습니다" : "스킬 폴더 경로 복사"}
              title={copied ? "복사했습니다" : "경로 복사"}
              onClick={() => {
                void navigator.clipboard
                  .writeText(dir)
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  })
                  .catch(() => {
                    // A refused clipboard leaves the full path in the tooltip to copy by hand.
                  });
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 2.5H3.2a.7.7 0 0 0-.7.7V8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7.3 5.8 10 11 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
