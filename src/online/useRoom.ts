import { useEffect, useRef, useState } from "react";
import type { Config, PlayStyle } from "../engine/types";
import type { RoomCommand, RoomSession, RoomView } from "./protocol";
import type { Advice } from "../engine/ai";
import { RoomUpdates } from "./updates";
const KEY = "quiet-mahjong-online-session";
const base = (import.meta.env.VITE_ONLINE_API_URL ?? "").replace(/\/$/, "");
function stored(): RoomSession | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
export function useRoom() {
  const [session, setSession] = useState<RoomSession | null>(stored);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [pending, setPending] = useState<RoomCommand | null>(null);
  const [adviceStyle, setAdviceStyle] = useState<PlayStyle>("balanced");
  const [advice, setAdvice] = useState<{stage: string; style: PlayStyle; items: Advice[]}>({stage: "",style: "balanced",items: []});
  const [adviceLoading, setAdviceLoading] = useState(false), [adviceError, setAdviceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sending = useRef(false);
  const updates = useRef(new RoomUpdates());
  const activePoll = useRef<AbortController | null>(null);
  const publish = (value: RoomView, epoch?: number) => { if (updates.current.accept(value, epoch)) setRoom(value); };
  async function request(path: string, s: RoomSession | null, data?: unknown, signal?: AbortSignal) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const r = await fetch((s?.origin ?? base) + path, { method: data === undefined ? "GET" : "POST",
        headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...(s ? { Authorization: "Bearer " + s.token } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "联机服务未就绪");
      return body as { room: RoomView; token?: string; stage?: string; analysis?: Advice[] };
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
  }
  function remember(s: RoomSession | null) {
    updates.current = new RoomUpdates(); activePoll.current?.abort();
    sessionRef.current = s; setSession(s);
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); }
    catch { setError("浏览器无法保存重连凭据，请勿刷新本页"); }
  }
  async function enter(name: string, config?: Config, id?: string) {
    if (sending.current || sessionRef.current) return;
    sending.current = true; setBusy(true); setError("");
    try {
      const r = await request(id ? `/api/rooms/${id.toUpperCase()}/join` : "/api/rooms", null, { name, config });
      remember({ id: r.room.id, token: r.token!, origin: base });
      publish(r.room); setConnected(true);
      const u = new URL(location.href); u.searchParams.set("room", r.room.id); history.replaceState(null, "", u);
    } catch (e) { setError(e instanceof Error ? e.message : "无法进入房间"); }
    finally { sending.current = false; setBusy(false); }
  }
  async function send(command: RoomCommand, expectedStage = room?.stage) {
    const s = sessionRef.current;
    if (!s || !room) return false;
    if (sending.current) { setError("上一项操作正在提交，请稍候"); return false; }
    sending.current = true; setBusy(true); setPending(command); setError("");
    const epoch = updates.current.beginCommand(); activePoll.current?.abort();
    const requestId = crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, "0")).join("");
    const data = { command, stage: expectedStage, requestId };
    try {
      // Reuse the command id for a transport retry: a committed operation cannot execute twice.
      let response;
      try { response = await request(`/api/rooms/${s.id}/command`, s, data); }
      catch (e) {
        if (e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError")) response = await request(`/api/rooms/${s.id}/command`, s, data);
        else throw e;
      }
      if (sessionRef.current?.token === s.token) publish(response.room, epoch);
      if (command.type === "leave") { remember(null); setRoom(null); setConnected(false); }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); return false; }
    finally { sending.current = false; setBusy(false); setPending(null); }
  }
  useEffect(() => {
    if (!session) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (sending.current) { timer = setTimeout(poll, 300); return; }
      const epoch = updates.current.epoch, controller = new AbortController();
      activePoll.current = controller;
      try {
        const r = await request(`/api/rooms/${session!.id}`, session, undefined, controller.signal);
        if (!stopped && !sending.current && epoch === updates.current.epoch) { publish(r.room, epoch); setConnected(true); setNetworkError(""); }
      } catch (e) {
        if (!stopped && !controller.signal.aborted) { setConnected(false); setNetworkError(e instanceof Error ? e.message : "连接中断，正在重连"); }
      } finally { if (!stopped) timer = setTimeout(poll, 1000); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); activePoll.current?.abort(); };
  }, [session?.id, session?.token]);
  useEffect(() => {
    if (!session || !room?.game || room.game.phase !== "turn" || room.game.current !== 0 || room.game.players[0].won) {
      setAdviceLoading(false); return;
    }
    let cancelled = false; const controller = new AbortController(), stage = room.stage;
    setAdviceLoading(true); setAdviceError("");
    void request(`/api/rooms/${session.id}/analyze`, session, { style: adviceStyle, stage }, controller.signal)
      .then(r => { if (!cancelled && r.stage === stage) setAdvice({stage,style:adviceStyle,items:r.analysis ?? []}); })
      .catch(e => { if (!cancelled) setAdviceError(e instanceof Error ? e.message : "建议计算失败"); })
      .finally(() => { if (!cancelled) setAdviceLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [session?.token, room?.stage, adviceStyle]);
  function forget() { remember(null); setRoom(null); setConnected(false); setError(""); }
  return { session, room, error: error || networkError, busy, pending, connected, enter, send, forget, setAdviceStyle, adviceLoading, adviceError,
    advice: advice.stage === room?.stage && advice.style === adviceStyle ? advice.items : [] };
}
