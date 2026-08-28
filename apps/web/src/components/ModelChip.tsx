import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SettingsView } from "../lib/api.ts";
import { matchesQuery } from "../lib/search.ts";
import { effortLabel } from "../lib/thinking.ts";

export interface ModelChoice {
  provider: string;
  model: string;
  thinking: string | null;
}

interface Props {
  settings: SettingsView;
  disabled?: boolean;
  onChange: (next: ModelChoice) => void;
}

type Pane = "root" | "model" | "effort";

export function ModelChip({ settings, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const groups = settings.providers.filter((item) => item.models.length > 0);
  const currentProvider = groups.find((item) => item.id === settings.activeProvider) ?? groups[0];
  const currentModel =
    currentProvider?.models.find((item) => item === settings.activeModel) ?? currentProvider?.models[0];
  const efforts = currentModel ? (currentProvider?.thinking[currentModel] ?? []) : [];
  const currentEffort =
    currentModel && settings.activeThinking && efforts.includes(settings.activeThinking)
      ? settings.activeThinking
      : (efforts[0] ?? null);

  const filtered = useMemo(
    () =>
      groups
        .map((group) => ({
          id: group.id,
          name: group.displayName,
          models: group.models.filter((model) => matchesQuery(`${group.displayName} ${model}`, query)),
        }))
        .filter((group) => group.models.length > 0),
    [groups, query],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (pane !== "root") {
        setPane("root");
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, pane]);

  useEffect(() => {
    if (open && pane === "model") {
      searchRef.current?.focus();
    }
  }, [open, pane]);

  if (groups.length === 0) {
    return null;
  }

  const modelLabel = currentModel ?? "모델 선택";
  const effortText = currentEffort ? effortLabel(currentEffort) : undefined;

  return (
    <div className="model-chip" ref={rootRef}>
      <button
        type="button"
        className="model-chip-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={effortText ? `${modelLabel} ${effortText}` : modelLabel}
        title={effortText ? `${modelLabel} · ${effortText}` : modelLabel}
        onClick={() => {
          if (open) {
            setOpen(false);
            setPane("root");
            return;
          }
          setQuery("");
          setPane("root");
          setOpen(true);
        }}
      >
        <span className="model-chip-name">{modelLabel}</span>
        {effortText ? <span className="model-chip-effort">{effortText}</span> : null}
        <svg
          className={`model-chip-chevron${open ? " open" : ""}`}
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 5.2L7 8.8L10.5 5.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="model-chip-menu" id={`${id}-menu`} role="menu" aria-label="모델">
          {pane === "root" ? (
            <>
              <button
                type="button"
                className="model-chip-cell"
                role="menuitem"
                onClick={() => setPane("model")}
              >
                <span className="model-chip-cell-label">모델</span>
                <span className="model-chip-cell-value">{modelLabel}</span>
                <IconChevronRight />
              </button>
              {efforts.length > 0 ? (
                <button
                  type="button"
                  className="model-chip-cell"
                  role="menuitem"
                  onClick={() => setPane("effort")}
                >
                  <span className="model-chip-cell-label">Effort</span>
                  <span className="model-chip-cell-value">{effortText}</span>
                  <IconChevronRight />
                </button>
              ) : null}
            </>
          ) : null}
          {pane === "model" ? (
            <>
              <input
                ref={searchRef}
                className="field-input model-chip-search"
                value={query}
                placeholder="모델 검색"
                aria-label="모델 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="model-chip-groups">
                {filtered.length === 0 ? (
                  <p className="model-chip-empty">맞는 모델이 없습니다</p>
                ) : (
                  filtered.map((group) => (
                    <section key={group.id} role="group" aria-label={group.name}>
                      <div className="model-chip-group-title">{group.name}</div>
                      {group.models.map((model) => {
                        const selected = currentProvider?.id === group.id && currentModel === model;
                        return (
                          <button
                            key={`${group.id}:${model}`}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className="model-chip-option"
                            title={model}
                            onClick={() => {
                              const provider = groups.find((item) => item.id === group.id);
                              const nextEfforts = provider?.thinking[model] ?? [];
                              const thinking =
                                currentEffort && nextEfforts.includes(currentEffort)
                                  ? currentEffort
                                  : (nextEfforts[0] ?? null);
                              onChange({ provider: group.id, model, thinking });
                              setOpen(false);
                              setPane("root");
                            }}
                          >
                            <span className="model-chip-option-label">{model}</span>
                            <span className="model-chip-check">{selected ? <IconCheck /> : null}</span>
                          </button>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>
            </>
          ) : null}
          {pane === "effort" ? (
            efforts.map((level) => {
              const selected = currentEffort === level;
              return (
                <button
                  key={level}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className="model-chip-option"
                  onClick={() => {
                    if (!currentProvider || !currentModel) {
                      return;
                    }
                    onChange({
                      provider: currentProvider.id,
                      model: currentModel,
                      thinking: level,
                    });
                    setOpen(false);
                    setPane("root");
                  }}
                >
                  <span className="model-chip-option-label">{effortLabel(level)}</span>
                  <span className="model-chip-check">{selected ? <IconCheck /> : null}</span>
                </button>
              );
            })
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IconChevronRight() {
  return (
    <svg className="model-chip-cell-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.2 3.5L8.8 7L5.2 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.2L6.4 11.1L12.5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
