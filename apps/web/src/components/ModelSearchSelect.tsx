import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isImeKeyboardEvent } from "../lib/ime.ts";
import { matchesQuery } from "../lib/search.ts";

export interface ModelOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: readonly ModelOption[];
  placeholder: string;
  emptyLabel?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}

export function ModelSearchSelect({
  value,
  options,
  placeholder,
  emptyLabel,
  ariaLabel,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const rows = useMemo(() => {
    const extra =
      emptyLabel && matchesQuery(emptyLabel, query)
        ? [{ value: "", label: emptyLabel }]
        : [];
    const matched = options.filter((option) =>
      matchesQuery(`${option.label} ${option.value}`, query),
    );
    return extra.length > 0 && query.trim().length === 0
      ? [...extra, ...matched]
      : extra.length > 0
        ? [...extra.filter((row) => matchesQuery(row.label, query)), ...matched]
        : matched;
  }, [emptyLabel, options, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActive(0);
    const id = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
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
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const node = rootRef.current?.querySelector('[aria-selected="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open, rows]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="model-picker-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected || (value === "" && emptyLabel) ? undefined : "model-picker-placeholder"}>
          {selected?.label ?? emptyLabel ?? placeholder}
        </span>
      </button>
      {open ? (
        <div className="model-picker-menu">
          <input
            ref={searchRef}
            className="field-input"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls={listId}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (isImeKeyboardEvent(event)) {
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const row = rows[active];
                if (row) {
                  pick(row.value);
                }
              }
            }}
          />
          {rows.length === 0 ? (
            <p className="model-picker-empty">맞는 모델이 없습니다</p>
          ) : (
            <ul className="model-picker-list" role="listbox" id={listId} aria-label={ariaLabel}>
              {rows.map((row, index) => (
                <li key={`${row.value || "empty"}:${row.label}`}>
                  <button
                    type="button"
                    role="option"
                    className={index === active ? "model-picker-option active" : "model-picker-option"}
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(row.value)}
                  >
                    {row.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
