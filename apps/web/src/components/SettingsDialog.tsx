import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  createProvider,
  deleteProvider,
  fetchRemoteModels,
  fetchSettings,
  updateProvider,
  type CatalogProviderView,
  type ProviderView,
  type SettingsView,
} from "../lib/api.ts";
import { matchesQuery } from "../lib/search.ts";

const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROTOCOL = "openai-chat-completions";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export function SettingsDialog({ open, onClose, onChanged }: Props) {
  const [view, setView] = useState<SettingsView | undefined>();
  const [adding, setAdding] = useState<boolean | CatalogProviderView>(false);
  const [editing, setEditing] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<ProviderView | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  async function reload() {
    const next = await fetchSettings();
    setView(next);
    onChanged?.();
    return next;
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setAdding(false);
    setEditing(undefined);
    setDeleteTarget(undefined);
    setError("");
    setSaved("");
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다");
    });
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (deleteTarget) {
        if (!deleting) {
          setDeleteTarget(undefined);
        }
        return;
      }
      if (document.querySelector(".settings-modal-layer, .model-chip-menu")) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, deleteTarget, deleting, onClose]);

  if (!open) {
    return null;
  }

  const providers = view?.providers ?? [];
  const catalog = view?.catalog ?? [];

  return (
    <div className="settings-overlay" role="presentation">
      <div
        className="settings-mask"
        aria-hidden="true"
        onClick={() => {
          if (deleteTarget) {
            if (!deleting) {
              setDeleteTarget(undefined);
            }
            return;
          }
          onClose();
        }}
      />
      <div className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <nav className="settings-nav">
          <div className="settings-nav-title" id="settings-title">
            설정
          </div>
          <div className="settings-nav-list">
            <button type="button" className="settings-nav-item active" aria-current="true">
              <IconModels />
              <span>모델</span>
            </button>
          </div>
        </nav>
        <div className="settings-content">
          <div className="settings-header">
            <button
              ref={closeRef}
              type="button"
              className="settings-close"
              onClick={onClose}
            >
              <IconClose />
              <span className="hidden-label">닫기</span>
            </button>
          </div>
          <div className="settings-options">
            <section className="models-section">
              <h2 className="models-title">모델</h2>
              <p className="models-intro">API 키를 넣으면 아래 프로바이더의 모델을 쓸 수 있습니다.</p>
              {saved ? (
                <p className="saved-notice" role="status" aria-live="polite">
                  {saved}
                </p>
              ) : null}
              {error ? <p className="field-error">{error}</p> : null}
              <ul className="provider-list">
                {providers.map((provider) => {
                  const openEditor = !adding && editing === provider.id;
                  const removable = provider.kind === "custom";
                  return (
                    <li key={provider.id} className="provider-card">
                      <div className="provider-head">
                        <span className="provider-identity">
                          <span className="provider-name">{provider.displayName}</span>
                          {provider.kind === "custom" ? <span className="row-tag">커스텀</span> : null}
                          <span
                            className={provider.hasApiKey ? "key-dot ok" : "key-dot missing"}
                            role="img"
                            aria-label={provider.hasApiKey ? "API 키 있음" : "API 키 없음"}
                            title={provider.hasApiKey ? "API 키 있음" : "API 키 없음"}
                          />
                        </span>
                        <span className="provider-actions">
                          <button
                            type="button"
                            className="capsule-btn"
                            aria-label={`${provider.displayName} 수정`}
                            onClick={() => {
                              setSaved("");
                              setAdding(false);
                              setEditing(openEditor ? undefined : provider.id);
                            }}
                          >
                            수정
                          </button>
                          {removable ? (
                            <button
                              type="button"
                              className="capsule-btn danger"
                              aria-label={`${provider.displayName} 삭제`}
                              onClick={() => {
                                setSaved("");
                                setError("");
                                setDeleteTarget(provider);
                              }}
                            >
                              삭제
                            </button>
                          ) : null}
                        </span>
                      </div>
                      {openEditor ? (
                        <ProviderForm
                          existing={provider}
                          taken={providers.map((item) => item.id)}
                          onCancel={() => setEditing(undefined)}
                          onSaved={async (next) => {
                            setView(next);
                            setEditing(undefined);
                            setSaved(`${provider.displayName}을(를) 저장했습니다.`);
                            onChanged?.();
                          }}
                          onError={setError}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="add-block">
                {adding ? (
                  <div className="add-card">
                    {typeof adding === "object" ? (
                      <label className="field">
                        <span className="field-label">프로바이더</span>
                        <select
                          className="field-input select-input"
                          value={adding.id}
                          aria-label="프로바이더"
                          onChange={(e) => {
                            const next = catalog.find((item) => item.id === e.target.value);
                            if (next) {
                              setAdding(next);
                            }
                          }}
                        >
                          {catalog.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <ProviderForm
                      key={typeof adding === "object" ? adding.id : "custom"}
                      taken={providers.map((item) => item.id)}
                      hideTitle={typeof adding === "object"}
                      {...(typeof adding === "object" ? { seed: adding } : {})}
                      onCancel={() => setAdding(false)}
                      onSaved={async (next) => {
                        setView(next);
                        setAdding(false);
                        const created = next.providers.find(
                          (item) => !providers.some((prev) => prev.id === item.id),
                        );
                        setSaved(
                          created
                            ? `${created.displayName}을(를) 저장했습니다.`
                            : "프로바이더를 저장했습니다.",
                        );
                        onChanged?.();
                      }}
                      onError={setError}
                    />
                  </div>
                ) : (
                  <div className="add-actions">
                    <button
                      type="button"
                      className="add-provider"
                      disabled={catalog.length === 0}
                      onClick={() => {
                        const first = catalog[0];
                        if (!first) {
                          return;
                        }
                        setSaved("");
                        setEditing(undefined);
                        setAdding(first);
                      }}
                    >
                      <IconPlus />
                      프로바이더 추가
                    </button>
                    <button
                      type="button"
                      className="add-provider"
                      onClick={() => {
                        setSaved("");
                        setEditing(undefined);
                        setAdding(true);
                      }}
                    >
                      <IconPlus />
                      커스텀 프로바이더 추가
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      {deleteTarget ? (
        <div className="settings-modal-layer" role="presentation">
          <div
            className="settings-mask"
            aria-hidden="true"
            onClick={() => {
              if (!deleting) {
                setDeleteTarget(undefined);
              }
            }}
          />
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-provider-title"
          >
            <div className="settings-modal-head">
              <h2 id="delete-provider-title">{deleteTarget.displayName}을(를) 삭제할까요?</h2>
              <button
                type="button"
                className="settings-close"
                disabled={deleting}
                onClick={() => setDeleteTarget(undefined)}
              >
                <IconClose />
                <span className="hidden-label">닫기</span>
              </button>
            </div>
            <p className="models-intro">
              삭제하면 {deleteTarget.displayName} 설정과 저장된 API 키가 지워집니다.
            </p>
            <div className="editor-actions">
              <button
                type="button"
                className="capsule-btn lg"
                disabled={deleting}
                onClick={() => setDeleteTarget(undefined)}
              >
                취소
              </button>
              <button
                type="button"
                className="capsule-btn lg danger-outline"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  setError("");
                  void deleteProvider(deleteTarget.id)
                    .then((next) => {
                      setView(next);
                      setDeleteTarget(undefined);
                      setEditing(undefined);
                      onChanged?.();
                    })
                    .catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "삭제 실패");
                    })
                    .finally(() => {
                      setDeleting(false);
                    });
                }}
              >
                {deleting ? "삭제하는 중…" : `${deleteTarget.displayName} 삭제`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProviderForm({
  existing,
  seed,
  taken,
  hideTitle = false,
  onCancel,
  onSaved,
  onError,
}: {
  existing?: ProviderView;
  seed?: CatalogProviderView;
  taken: string[];
  hideTitle?: boolean;
  onCancel: () => void;
  onSaved: (view: SettingsView) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [id, setId] = useState(existing?.id ?? seed?.id ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? seed?.displayName ?? "");
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? seed?.baseURL ?? "");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>(existing?.models ?? []);
  const [thinking, setThinking] = useState<Record<string, string[]>>(existing?.thinking ?? {});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [candidates, setCandidates] = useState<string[] | undefined>();
  const [candidateQuery, setCandidateQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const creating = !existing;
  const custom = existing ? existing.kind === "custom" : !seed;
  const idLocked = Boolean(existing || seed);

  useEffect(() => {
    if (!candidates) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setCandidates(undefined);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [candidates]);

  const route = id.trim().toLowerCase();
  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route);
  const routeTaken = creating && taken.includes(route);
  const modelIds = uniqueIds(models);
  const ready =
    baseURL.trim().length > 0 &&
    (!custom || modelIds.length > 0) &&
    (!creating || !custom || (route.length > 0 && !routeInvalid && !routeTaken));

  const hint =
    creating && custom && (route.length === 0 || routeInvalid || routeTaken)
      ? undefined
      : baseURL.trim().length === 0
        ? "커스텀 프로바이더는 Base URL이 필요합니다."
        : custom && modelIds.length === 0
          ? "커스텀 프로바이더는 모델이 하나 이상 필요합니다."
          : undefined;

  async function commit() {
    const payload = {
      displayName,
      baseURL,
      models: modelIds,
      thinking,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    if (creating) {
      return createProvider({ id: route, ...payload });
    }
    return updateProvider(existing.id, payload);
  }

  const identity = (
    <>
      {creating && custom ? (
        <>
          <label className="field">
            <span className="field-label">프로바이더 ID</span>
            <input
              className="field-input"
              value={id}
              placeholder="acme-gateway"
              aria-label="프로바이더 ID"
              disabled={idLocked}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          {routeInvalid || routeTaken ? (
            <p className="field-error">
              {routeInvalid
                ? "소문자로 시작하고, 그 뒤에는 소문자·숫자·하이픈만 씁니다."
                : "이미 쓰는 ID입니다."}
            </p>
          ) : (
            <p className="field-hint">
              소문자로 시작하고, 그 뒤에는 소문자·숫자·하이픈만 씁니다. 요청과 자격 증명 이름에 이 ID가
              쓰입니다.
            </p>
          )}
        </>
      ) : null}
      {custom ? (
        <label className="field">
          <span className="field-label">표시 이름</span>
          <input
            className="field-input"
            value={displayName}
            placeholder={route.length === 0 ? "표시 이름" : route}
            aria-label="표시 이름"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      ) : null}
      <label className="field">
        <span className="field-label">Base URL</span>
        <input
          className="field-input"
          value={baseURL}
          placeholder="https://gateway.example/v1"
          aria-label="Base URL"
          onChange={(e) => setBaseURL(e.target.value)}
        />
      </label>
      {custom ? (
        <>
          <label className="field">
            <span className="field-label">API 프로토콜</span>
            <select
              className="field-input select-input"
              value={PROTOCOL}
              aria-label="API 프로토콜"
              onChange={() => undefined}
            >
              <option value={PROTOCOL}>{PROTOCOL}</option>
            </select>
          </label>
          <p className="field-hint">OpenAI 호환 Chat Completions (`/v1/chat/completions`)</p>
        </>
      ) : null}
    </>
  );

  const keyField = (
    <label className="field">
      <span className="field-label">API 키</span>
      <input
        className="field-input"
        type="password"
        autoComplete="off"
        value={apiKey}
        placeholder={
          existing?.hasApiKey ? "설정됨 — 새 값을 넣으면 교체합니다" : "API 키를 입력하세요"
        }
        aria-label="API 키"
        onChange={(e) => setApiKey(e.target.value)}
      />
    </label>
  );

  const catalogFields = (
    <ModelCatalog
      models={models}
      setModels={setModels}
      modelQuery={modelQuery}
      setModelQuery={setModelQuery}
      busy={busy}
      setBusy={setBusy}
      setStatus={setStatus}
      thinking={thinking}
      setThinking={setThinking}
      setCandidates={setCandidates}
      setCandidateQuery={setCandidateQuery}
      setPicked={setPicked}
      baseURL={baseURL}
      apiKey={apiKey}
      {...(existing ? { existing } : {})}
      {...(seed ? { seed } : {})}
      modelIds={modelIds}
    />
  );

  return (
    <div className="editor">
      {hideTitle ? null : (
        <div className="editor-head">
          <span className="editor-title">
            {creating ? (seed ? seed.displayName : "커스텀 프로바이더") : existing.displayName}
          </span>
        </div>
      )}
      {creating && custom ? (
        <>
          {identity}
          {keyField}
          {catalogFields}
        </>
      ) : (
        <>
          {keyField}
          <details className="customized">
            <summary className="customized-summary">사용자 설정</summary>
            <div className="customized-body">
              {identity}
              {catalogFields}
            </div>
          </details>
        </>
      )}
      {status ? <p className="field-hint">{status}</p> : null}
      {hint ? <p className="field-hint">{hint}</p> : null}
      <div className="editor-actions">
        <button type="button" className="capsule-btn lg" disabled={busy} onClick={onCancel}>
          취소
        </button>
        <button
          type="button"
          className="capsule-btn lg primary"
          disabled={busy || !ready}
          onClick={() => {
            void (async () => {
              setBusy(true);
              onError("");
              try {
                const next = await commit();
                await onSaved(next);
              } catch (err) {
                onError(err instanceof Error ? err.message : "저장 실패");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy
            ? creating && custom
              ? "만드는 중…"
              : "적용하는 중…"
            : creating && custom
              ? "프로바이더 만들기"
              : "적용"}
        </button>
      </div>
      {candidates ? (
        <div className="settings-modal-layer nested" role="presentation">
          <div className="settings-mask" aria-hidden="true" onClick={() => setCandidates(undefined)} />
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fetch-title"
          >
            <div className="settings-modal-head">
              <h2 id="fetch-title">추가할 모델 선택</h2>
              <button type="button" className="settings-close" onClick={() => setCandidates(undefined)}>
                <IconClose />
                <span className="hidden-label">닫기</span>
              </button>
            </div>
            <p className="models-intro">이 프로바이더가 알려 준 모델입니다. 검색해서 넣을 항목을 고르세요.</p>
            <input
              className="field-input"
              value={candidateQuery}
              placeholder="모델 검색"
              aria-label="모델 검색"
              autoFocus
              onChange={(e) => setCandidateQuery(e.target.value)}
            />
            <div className="candidate-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  const visible = candidates.filter((item) => matchesQuery(item, candidateQuery));
                  const all = visible.length > 0 && visible.every((item) => picked.has(item));
                  setPicked((current) => {
                    const next = new Set(current);
                    if (all) {
                      for (const item of visible) {
                        next.delete(item);
                      }
                    } else {
                      for (const item of visible) {
                        next.add(item);
                      }
                    }
                    return next;
                  });
                }}
              >
                {candidates.filter((item) => matchesQuery(item, candidateQuery)).length > 0 &&
                candidates
                  .filter((item) => matchesQuery(item, candidateQuery))
                  .every((item) => picked.has(item))
                  ? "선택 해제"
                  : "전체 선택"}
              </button>
            </div>
            {candidates.filter((item) => matchesQuery(item, candidateQuery)).length === 0 ? (
              <p className="model-empty">맞는 모델이 없습니다</p>
            ) : (
              <ul className="candidate-list">
                {candidates
                  .filter((item) => matchesQuery(item, candidateQuery))
                  .map((item) => (
                    <li key={item} className="candidate">
                      <label className="candidate-label">
                        <input
                          type="checkbox"
                          checked={picked.has(item)}
                          onChange={() => {
                            setPicked((current) => {
                              const next = new Set(current);
                              if (!next.delete(item)) {
                                next.add(item);
                              }
                              return next;
                            });
                          }}
                        />
                        <span className="candidate-id">{item}</span>
                      </label>
                    </li>
                  ))}
              </ul>
            )}
            <div className="editor-actions">
              <button type="button" className="capsule-btn lg" onClick={() => setCandidates(undefined)}>
                취소
              </button>
              <button
                type="button"
                className="capsule-btn lg primary"
                onClick={() => {
                  const known = new Set(modelIds);
                  const adopted = candidates.filter((item) => picked.has(item) && !known.has(item));
                  setModels([...modelIds, ...adopted]);
                  setCandidates(undefined);
                }}
              >
                선택한 항목 추가
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelCatalog({
  models,
  setModels,
  modelQuery,
  setModelQuery,
  busy,
  setBusy,
  setStatus,
  thinking,
  setThinking,
  setCandidates,
  setCandidateQuery,
  setPicked,
  baseURL,
  apiKey,
  existing,
  seed,
  modelIds,
}: {
  models: string[];
  setModels: Dispatch<SetStateAction<string[]>>;
  modelQuery: string;
  setModelQuery: (value: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setStatus: (value: string) => void;
  thinking: Record<string, string[]>;
  setThinking: Dispatch<SetStateAction<Record<string, string[]>>>;
  setCandidates: (value: string[] | undefined) => void;
  setCandidateQuery: (value: string) => void;
  setPicked: Dispatch<SetStateAction<Set<string>>>;
  baseURL: string;
  apiKey: string;
  existing?: ProviderView;
  seed?: CatalogProviderView;
  modelIds: string[];
}) {
  const visibleModels = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => matchesQuery(model, modelQuery));

  return (
    <section className="model-catalog" aria-label="모델">
      <div className="model-catalog-head">
        <span className="field-label">모델</span>
        <button
          type="button"
          className="link-btn"
          disabled={busy}
          title={baseURL.trim() ? undefined : "Base URL을 먼저 넣은 다음 가져오세요"}
          onClick={() => {
            void (async () => {
              if (!baseURL.trim()) {
                setStatus("Base URL을 먼저 넣은 다음 가져오세요.");
                return;
              }
              if (!apiKey.trim() && !existing?.hasApiKey) {
                setStatus("API 키를 먼저 넣으세요.");
                return;
              }
              setBusy(true);
              setStatus("");
              try {
                const fetched = await fetchRemoteModels({
                  ...(existing
                    ? { provider: existing.id }
                    : seed
                      ? { provider: seed.id }
                      : {}),
                  baseURL,
                  ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                });
                if (fetched.models.length === 0) {
                  setStatus("프로바이더가 모델을 알려 주지 않았습니다. 직접 넣을 수 있습니다.");
                  return;
                }
                const known = new Set(modelIds);
                const sorted = [...fetched.models].sort((a, b) => a.localeCompare(b));
                const nextThinking = { ...thinking };
                for (const item of fetched.catalog ?? []) {
                  if (item.thinking.length > 0) {
                    nextThinking[item.id] = item.thinking;
                  }
                }
                setThinking(nextThinking);
                setCandidateQuery("");
                setCandidates(sorted);
                setPicked(new Set(sorted.filter((item) => !known.has(item))));
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "모델 목록을 가져오지 못했습니다.");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? "물어보는 중…" : "사용 가능한 모델 가져오기"}
        </button>
      </div>
      {models.length === 0 ? (
        <p className="model-empty">선택기에 모델이 보이지 않습니다. 목록에 없는 ID도 직접 넣을 수 있습니다.</p>
      ) : (
        <>
          {models.length > 6 ? (
            <input
              className="field-input"
              value={modelQuery}
              placeholder="모델 검색"
              aria-label="모델 검색"
              onChange={(e) => setModelQuery(e.target.value)}
            />
          ) : null}
          {visibleModels.length === 0 ? (
            <p className="model-empty">맞는 모델이 없습니다</p>
          ) : (
            <ul className="model-list">
              {visibleModels.map(({ model, index }) => (
                <li key={index} className="model-entry">
                  <input
                    className="field-input"
                    value={model}
                    placeholder="모델 ID"
                    aria-label={`모델 ID ${index + 1}`}
                    onChange={(e) => {
                      setModels(models.map((item, at) => (at === index ? e.target.value : item)));
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`모델 ${index + 1} 삭제`}
                    onClick={() => {
                      setModels(models.filter((_, at) => at !== index));
                    }}
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <button
        type="button"
        className="add-model"
        onClick={() => {
          setModels([...models, ""]);
        }}
      >
        <IconPlus />
        모델 추가
      </button>
    </section>
  );
}

function uniqueIds(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function IconModels() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
