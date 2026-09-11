import { Fragment, useId } from "react";
import { botToolEnabled, type BotToolName } from "@cbot/shared";
import { TOOL_GROUPS, TOOL_HINTS, toggleBotTool, toolsOff } from "../lib/bot-tools.ts";

interface Props {
  value: BotToolName[] | null;
  /** True while the choice differs from what is saved. */
  changed: boolean;
  onChange: (next: BotToolName[] | null) => void;
}

export function BotToolList({ value, changed, onChange }: Props) {
  const labelId = useId();
  const off = toolsOff(value);
  return (
    <section className="team-sec" aria-labelledby={labelId}>
      <div className="team-sec-head">
        <h3 id={labelId} className="team-sec-title" title="끈 도구는 이 봇에게 보이지 않고, 불러도 실행되지 않습니다">
          도구
        </h3>
        {changed ? <span className="team-dirty" title="저장하지 않은 변경" /> : null}
        <span className="team-sec-meta">{off > 0 ? `${off}개 끔` : "모두 켬"}</span>
        {off > 0 ? (
          <button type="button" className="team-link" onClick={() => onChange(null)}>
            모두 켜기
          </button>
        ) : null}
      </div>
      <div className="team-tools" role="group" aria-labelledby={labelId}>
        {TOOL_GROUPS.map((group) => (
          <Fragment key={group.label}>
            <span className="team-tools-group">{group.label}</span>
            {group.tools.map((name) => {
              const on = botToolEnabled(value, name);
              return (
                <label key={name} className={on ? "team-tool" : "team-tool is-off"}>
                  <input type="checkbox" checked={on} onChange={() => onChange(toggleBotTool(value, name))} />
                  <span className="team-tool-check" aria-hidden="true">
                    {on ? <CheckIcon /> : null}
                  </span>
                  <span className="team-tool-name">{name}</span>
                  <span className="team-tool-desc">{TOOL_HINTS[name]}</span>
                </label>
              );
            })}
            {(group.locked ?? []).map((name) => (
              <div key={name} className="team-tool is-locked">
                <span className="team-tool-check" aria-hidden="true">
                  <LockIcon />
                </span>
                <span className="team-tool-name">{name}</span>
                <span className="team-tool-desc">{TOOL_HINTS[name as keyof typeof TOOL_HINTS]}</span>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 5.2 4.1 7.3 8 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="5.2" width="7" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.2 5.2V3.9a1.8 1.8 0 0 1 3.6 0v1.3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
