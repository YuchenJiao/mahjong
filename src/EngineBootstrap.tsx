import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { initCore } from "./engine/core";

type Startup = { status: "loading" | "ready" } | { status: "error"; message: string };

// Keep the whole table unmounted until initialization completes. A loading
// return at the bottom of App cannot protect earlier render-time scoring.
export function EngineBootstrap({ children, initialize = initCore }: {
  children: ReactNode;
  initialize?: () => Promise<void>;
}) {
  const [startup, setStartup] = useState<Startup>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => initialize()).then(
      () => { if (active) setStartup({ status: "ready" }); },
      error => { if (active) setStartup({ status: "error", message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { active = false; };
  }, [initialize, attempt]);
  if (startup.status === "ready") return children;
  if (startup.status === "error") return <div className="loading" role="alert">
    <h2>规则引擎加载失败</h2>
    <p>{startup.message}</p>
    <p>牌局存档仍保留，可以重试加载。</p>
    <button onClick={() => { setStartup({ status: "loading" }); setAttempt(n => n + 1); }}>重试加载</button>
  </div>;
  return <div className="loading" role="status" aria-live="polite">
    <div className="brand-mark">一</div>
    <h2>一桌麻将</h2>
    <p>正在准备牌桌与规则引擎…</p>
  </div>;
}
