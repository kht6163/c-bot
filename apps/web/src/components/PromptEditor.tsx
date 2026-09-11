import { useLayoutEffect, useRef, useState } from "react";

interface Props {
  value: string;
  label: string;
  placeholder?: string;
  onChange: (next: string) => void;
}

/**
 * A prompt textarea with line numbers. Long lines wrap, so a hidden mirror
 * with the same width and type lays each line out to learn how tall its
 * number's row must be.
 */
export function PromptEditor({ value, label, placeholder, onChange }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const lines = value.split("\n");

  useLayoutEffect(() => {
    const area = areaRef.current;
    const mirror = mirrorRef.current;
    if (!area || !mirror) {
      return;
    }
    const measure = () => {
      const style = getComputedStyle(area);
      const width = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      mirror.style.width = `${Math.max(0, width)}px`;
      setHeights(Array.from(mirror.children, (line) => (line as HTMLElement).offsetHeight));
      if (gutterRef.current) {
        gutterRef.current.scrollTop = area.scrollTop;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className="prompt-editor">
      <div className="prompt-gutter" ref={gutterRef} aria-hidden="true">
        {lines.map((_, index) => (
          <div key={index} style={heights[index] ? { height: heights[index] } : undefined}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={areaRef}
        className="prompt-area"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutterRef.current) {
            gutterRef.current.scrollTop = event.currentTarget.scrollTop;
          }
        }}
      />
      <div className="prompt-mirror" ref={mirrorRef} aria-hidden="true">
        {lines.map((line, index) => (
          <div key={index}>{line.length > 0 ? line : "\u00a0"}</div>
        ))}
      </div>
    </div>
  );
}
