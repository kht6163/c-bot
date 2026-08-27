import { useEffect, useState } from "react";
import { PROTOCOL_VERSION, type ServerFrame } from "@cbot/shared";
import { fetchHealth, openEvents } from "./lib/api.ts";

type Tab = "sessions" | "bots";
type LinkState = "connecting" | "ok" | "down";

export function App() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [link, setLink] = useState<LinkState>("connecting");

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;

    void fetchHealth()
      .then((health) => {
        if (cancelled) {
          return;
        }
        if (health.ok && health.version === PROTOCOL_VERSION) {
          setLink("ok");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLink("down");
        }
      });

    try {
      socket = openEvents();
      socket.addEventListener("message", (ev) => {
        if (cancelled || typeof ev.data !== "string") {
          return;
        }
        let frame: ServerFrame;
        try {
          frame = JSON.parse(ev.data) as ServerFrame;
        } catch {
          return;
        }
        if (frame.type === "hello") {
          setLink("ok");
        }
      });
      socket.addEventListener("error", () => {
        if (!cancelled) {
          setLink("down");
        }
      });
      socket.addEventListener("close", () => {
        if (!cancelled) {
          setLink((current) => (current === "ok" ? "down" : current));
        }
      });
    } catch {
      setLink("down");
    }

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, []);

  const emptyLabel = tab === "sessions" ? "세션이 없습니다" : "봇이 없습니다";

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">c-bot</div>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sessions"}
            className={tab === "sessions" ? "tab active" : "tab"}
            onClick={() => setTab("sessions")}
          >
            세션
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "bots"}
            className={tab === "bots" ? "tab active" : "tab"}
            onClick={() => setTab("bots")}
          >
            봇
          </button>
        </div>
        <div className="list">
          <p className="empty">{emptyLabel}</p>
        </div>
        <p className={`status status-${link}`}>
          {link === "ok" ? "서버 연결됨" : link === "down" ? "서버 없음" : "연결 중…"}
        </p>
      </aside>
      <section className="main">
        <div className="hero">
          <h1>c-bot</h1>
          <p>브라우저에서 쓰는 코딩 에이전트. 세션과 봇 모드는 다음 단계에서 붙습니다.</p>
        </div>
        <form className="composer" onSubmit={(e) => e.preventDefault()}>
          <textarea
            disabled
            rows={3}
            placeholder="세션을 시작하면 메시지를 보낼 수 있습니다"
          />
          <button type="submit" disabled>
            보내기
          </button>
        </form>
      </section>
    </div>
  );
}
