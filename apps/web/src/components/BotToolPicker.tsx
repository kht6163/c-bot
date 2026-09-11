import { Fragment, useId } from "react";
import { botToolEnabled, type BotToolName } from "@cbot/shared";
import { TOOL_GROUPS, TOOL_HINTS, toggleBotTool, toolsOff } from "../lib/bot-tools.ts";

interface Props {
  value: BotToolName[] | null;
  onChange: (next: BotToolName[] | null) => void;
}

export function BotToolPicker({ value, onChange }: Props) {
  const labelId = useId();
  const off = toolsOff(value);
  return (
    <div className="tool-picker" role="group" aria-labelledby={labelId}>
      <div className="tool-picker-head">
        <span id={labelId} className="field-label">
          도구
        </span>
        <span className="tool-picker-count">{off > 0 ? `${off}개 끔` : "모두 켬"}</span>
        {off > 0 ? (
          <button type="button" className="ghost tool-picker-reset" onClick={() => onChange(null)}>
            모두 켜기
          </button>
        ) : null}
      </div>
      <div className="tool-groups">
        {TOOL_GROUPS.map((group) => (
          <Fragment key={group.label}>
            <span className="tool-group-label">{group.label}</span>
            <div className="tool-group-chips">
              {group.tools.map((name) => {
                const on = botToolEnabled(value, name);
                return (
                  <label key={name} className={on ? "tool-chip is-on" : "tool-chip"} title={TOOL_HINTS[name]}>
                    <input type="checkbox" checked={on} onChange={() => onChange(toggleBotTool(value, name))} />
                    <CheckIcon />
                    {name}
                  </label>
                );
              })}
              {(group.locked ?? []).map((name) => (
                <label
                  key={name}
                  className="tool-chip is-on is-locked"
                  title={TOOL_HINTS[name as keyof typeof TOOL_HINTS]}
                >
                  <input type="checkbox" checked disabled />
                  <LockIcon />
                  {name}
                </label>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      <p className="hint-inline">끈 도구는 이 봇에게 보이지 않고, 불러도 실행되지 않습니다.</p>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="tool-chip-mark" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 5.2 4.1 7.3 8 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="tool-chip-mark" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="2" y="4.4" width="6" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.4 4.4V3.3a1.6 1.6 0 0 1 3.2 0v1.1" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
