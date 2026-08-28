import { useEffect, useId, useState } from "react";

interface Props {
  source: string;
}

let mermaidReady: Promise<typeof import("mermaid").default> | undefined;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

export function MermaidBlock({ source }: Props) {
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      setSvg(undefined);
      return;
    }
    void loadMermaid()
      .then((mermaid) => mermaid.render(`mermaid-${reactId}`, trimmed))
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg(undefined);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reactId, source]);

  if (failed || !svg) {
    return (
      <pre className="md-code">
        <code>{source}</code>
      </pre>
    );
  }
  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />;
}
