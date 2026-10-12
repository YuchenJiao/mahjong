import { useEffect, useRef, useState } from "react";
import type { Config } from "../engine/types";
import type { RoomCommand, RoomSession, RoomView } from "./protocol";
const KEY = "quiet-mahjong-online-session";
const base = (import.meta.env.VITE_ONLINE_API_URL ?? "").replace(/\/$/, "");
function stored(): RoomSession | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
export function useRoom() {
  const [session, setSession] = useState<RoomSession | null>(stored);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sending = useRef(false);
  const publish = (value: RoomView) => setRoom(old => old?.id === value.id && old.version > value.version ? old : value);
  async function request(path: string, s: RoomSession | null, data?: unknown) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch((s?.origin ?? base) + path, { method: data === undefined ? "GET" : "POST",
        headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...(s ? { Authorization: "Bearer " + s.token } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "联机服务未就绪");
      return body as { room: RoomView; token?: string };
    } finally { clearTimeout(timeout); }
  }
  function remember(s: RoomSession | null) {
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
  async function send(command: RoomCommand) {
    const s = sessionRef.current;
    if (!s || !room || sending.current) return false;
    sending.current = true; setBusy(true); setError("");
    const requestId = crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, "0")).join("");
    const data = { command, stage: room.stage, requestId };
    try {
      // Reuse the command id for a transport retry: a committed operation cannot execute twice.
      let response;
      try { response = await request(`/api/rooms/${s.id}/command`, s, data); }
      catch (e) {
        if (e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError")) response = await request(`/api/rooms/${s.id}/command`, s, data);
        else throw e;
      }
      if (sessionRef.current?.token === s.token) publish(response.room);
      if (command.type === "leave") { remember(null); setRoom(null); setConnected(false); }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); return false; }
    finally { sending.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!session) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await request(`/api/rooms/${session!.id}`, session);
        if (!stopped) { publish(r.room); setConnected(true); setError(""); }
      } catch (e) {
        if (!stopped) { setConnected(false); setError(e instanceof Error ? e.message : "连接中断，正在重连"); }
      } finally { if (!stopped) timer = setTimeout(poll, 1000); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [session?.id, session?.token]);
  function forget() { remember(null); setRoom(null); setConnected(false); setError(""); }
  return { session, room, error, busy, connected, enter, send, forget };
}
