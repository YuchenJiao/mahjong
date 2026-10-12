import { useState } from "react";
import type { RoomCommand, RoomView } from "./protocol";
export function RoomPanel({ room, active, busy, connected, error, onCreate, onJoin, send, forget }: {
  room: RoomView | null; active: boolean; busy: boolean; connected: boolean; error: string;
  onCreate: (name: string) => void; onJoin: (name: string, id: string) => void;
  send: (c: RoomCommand) => Promise<boolean>; forget: () => void;
}) {
  const [name, setName] = useState("玩家"), [id, setId] = useState(new URL(location.href).searchParams.get("room") ?? "");
  const [copied, setCopied] = useState(false);
  const [invite, setInvite] = useState("");
  const seconds = room ? Math.max(0, Math.ceil((room.deadline - room.serverTime) / 1000)) : 0;
  return <section className="room-panel" aria-label="联机房间">
    <div className="room-panel-heading"><div><strong>{room ? `房间 ${room.id}` : "一起打一桌"}</strong>
      <p>{room ? `${room.seats.filter(s => s.human).length} 位真人 · ${connected ? "已同步" : "重连中"}` : "1–4人在线 · 空位由电脑补齐 · 无需注册"}</p></div>
      {room && <button onClick={async () => { const u = new URL(location.href); u.searchParams.set("room", room.id); try { await navigator.clipboard.writeText(u.href); setCopied(true); } catch { setInvite(u.href); } }}>{copied ? "链接已复制" : "复制邀请链接"}</button>}
    </div>
    {invite && <div className="room-entry"><input readOnly aria-label="邀请链接" value={invite} onFocus={e => e.target.select()} /></div>}
    {!active ? <div className="room-entry"><label>昵称<input value={name} maxLength={12} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim()} onClick={() => onCreate(name)}>创建房间</button>
      <label>房间号<input value={id} maxLength={8} placeholder="8位房间号" onChange={e => setId(e.target.value.toUpperCase())} /></label>
      <button disabled={busy || !name.trim() || !/^[A-F0-9]{8}$/.test(id)} onClick={() => onJoin(name, id)}>加入房间</button>
    </div> : room ? <>
      <div className="room-seats">{room.seats.map((s, i) => <div key={i} className={i === 0 ? "room-self" : ""}><strong>{s.name}{i === 0 ? " · 你" : ""}</strong>
        <span>{s.host ? "房主 · " : ""}{s.human ? !s.connected ? "断线托管" : s.autoplay ? "电脑托管" : "在线" : "电脑"}</span></div>)}</div>
      <div className="room-actions">
        {!room.game && (room.isHost ? <button className="primary" disabled={busy} onClick={() => void send({ type: "start" })}>开始牌局</button> : <span>等待房主开局</span>)}
        {room.game && room.game.phase !== "end" && <><span>{seconds}秒 · {room.game.phase === "exchange" ? `换牌 ${room.exchangeReady.filter(Boolean).length}/4` : room.game.phase === "void" ? `定缺 ${room.voidReady.filter(Boolean).length}/4` : "超时自动托管"}</span>
          <button disabled={busy} onClick={() => void send({ type: room.seats[0].autoplay ? "takeback" : "autoplay" })}>{room.seats[0].autoplay ? "收回操作" : "交给电脑"}</button></>}
        <button disabled={busy} onClick={() => void send({ type: "leave" })}>离开房间</button>
      </div>
    </> : <div className="room-actions"><span>正在恢复房间…</span><button onClick={forget}>返回本地牌桌</button></div>}
    {error && <p className="room-error" role="status">{error}</p>}
  </section>;
}
