import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock.tsx";

interface Props {
  text: string;
  live?: boolean;
}

const components: Components = {
  a({ href, children }) {
    const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
    if (!safe) {
      return <span>{children}</span>;
    }
    return (
      <a href={safe} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
    if (lang === "mermaid") {
      return <MermaidBlock source={text} />;
    }
    if (className || text.includes("\n")) {
      return (
        <pre className="md-code">
          <code>{text}</code>
        </pre>
      );
    }
    return <code className="md-inline">{children}</code>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export function MarkdownView({ text, live = false }: Props) {
  return (
    <div className={live ? "md-body live" : "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
