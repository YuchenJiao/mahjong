import { initCore, suit } from "../src/engine/core";
import { advise, chooseOwn, chooseResponse } from "../src/engine/ai";
import { newGame, exchangeAll, voidAll, chooseExchange, chooseVoid, publicView,
  ownActions, act, discard, respond, advance } from "../src/engine/game";
import type { Game, Config, Frame, Meld } from "../src/engine/types";
import type { RoomCommand, RoomView } from "../src/online/protocol";
import { configInput, object, InputError } from "./validation";

export const TURN_MS = 45000, SETUP_MS = 60000, DISCONNECT_MS = 15000, ROOM_TTL = 2 * 3600000;
type Seat = { name: string; hash: string; seen: number; auto: boolean };
export type RoomRecord = {
  id: string; version: number; host: number; config: Config; seats: (Seat | null)[];
  game: Game | null; exchanges: (number[] | null)[]; voids: (number | null)[];
  stage: string; deadline: number; botAt: number; expires: number;
  commands: string[];
};
export interface RoomStore {
  load(id: string): Promise<RoomRecord | null>;
  save(room: RoomRecord, expected: number): Promise<boolean>;
  prune(now: number): Promise<void>;
  count(): Promise<number>;
}
class RoomError extends Error { constructor(message: string, public status = 400) { super(message); } }
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const random = (bytes = 24) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
async function hash(token: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(n => n.toString(16).padStart(2, "0")).join("");
}
function name(x: unknown) {
  if (typeof x !== "string" || !x.trim() || x.trim().length > 12 || /[\p{C}]/u.test(x)) throw new RoomError("昵称须为1–12个字符");
  return x.trim();
}
export function stageKey(g: Game | null) { return g ? `${g.round}:${g.phase}:${g.current}:${g.frames.length}` : "lobby"; }
function clock(r: RoomRecord, now: number) {
  const stage = stageKey(r.game);
  if (r.stage !== stage) {
    r.stage = stage;
    r.deadline = now + (r.game?.phase === "exchange" || r.game?.phase === "void" ? SETUP_MS : TURN_MS);
    r.botAt = now + 500;
  }
}
function automated(r: RoomRecord, seat: number) { return !r.seats[seat] || r.seats[seat]!.auto; }
function waiting(r: RoomRecord, i: number) {
  const g = r.game;
  if (!g || g.phase === "end" || g.players[i].won) return false;
  if (g.phase === "exchange") return r.exchanges[i] === null;
  if (g.phase === "void") return r.voids[i] === null;
  if (g.pending) return g.pending.responses[i] === null;
  return g.phase === "turn" && g.current === i;
}
export function tickRoom(r: RoomRecord, now: number) {
  clock(r, now);
  r.seats.forEach((s, i) => {
    if (s && (now - s.seen > DISCONNECT_MS || (now >= r.deadline && waiting(r, i)))) s.auto = true;
  });
  const g = r.game;
  if (!g || g.phase === "end" || now < r.botAt) return;
  if (g.phase === "exchange") {
    r.exchanges.forEach((v, i) => { if (v === null && automated(r, i)) r.exchanges[i] = chooseExchange(g.players[i].hand); });
    if (r.exchanges.every(v => v !== null)) exchangeAll(g, r.exchanges as number[][]);
  } else if (g.phase === "void") {
    r.voids.forEach((v, i) => { if (v === null && automated(r, i)) r.voids[i] = chooseVoid(g.players[i]); });
    if (r.voids.every(v => v !== null)) voidAll(g, r.voids as number[]);
  } else if (g.pending) {
    for (let i = 0; i < 4; i++) if (g.pending.responses[i] === null && automated(r, i))
      respond(g, i, chooseResponse(publicView(g, i), g.pending.actions[i]));
    advance(g);
  } else if (g.phase === "turn" && automated(r, g.current)) {
    const i = g.current, v = publicView(g, i), a = chooseOwn(v, ownActions(g, i));
    if (a) act(g, i, a); else discard(g, i, advise(v)[0].tile);
  }
  r.botAt = now + 500;
  clock(r, now);
}
function rename(r: RoomRecord) {
  r.game?.players.forEach((p, i) => { p.name = r.seats[i]?.name ?? ["电脑东", "电脑南", "电脑西", "电脑北"][i]; });
}
function command(r: RoomRecord, seat: number, c: RoomCommand, now: number) {
  if (c.type === "leave") {
    r.seats[seat] = null;
    if (r.host === seat) r.host = r.seats.findIndex(s => s !== null);
    rename(r); return;
  }
  const s = r.seats[seat]!;
  if (c.type === "takeback" || c.type === "autoplay") {
    s.auto = c.type === "autoplay";
    if (c.type === "takeback" && waiting(r, seat)) r.deadline = now +
      (r.game?.phase === "exchange" || r.game?.phase === "void" ? SETUP_MS : TURN_MS);
    return;
  }
  if (c.type === "start" || c.type === "next") {
    if (r.host !== seat) throw new RoomError("只有房主可开局", 403);
    if (c.type === "start" ? r.game !== null : r.game?.phase !== "end") throw new RoomError("当前不能开始下一局", 409);
    r.game = newGame(r.config, r.game ?? undefined, undefined,
      () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296);
    r.exchanges = Array(4).fill(null); r.voids = Array(4).fill(null);
    rename(r);
    r.game.frames[0].players.forEach((p, i) => { p.name = r.game!.players[i].name; });
    clock(r, now); return;
  }
  if (s.auto) throw new RoomError("请先收回操作", 409);
  const g = r.game;
  if (!g || g.phase === "end") throw new RoomError("牌局尚未开始或已结束", 409);
  if (c.type === "exchange") {
    if (g.phase !== "exchange" || r.exchanges[seat] !== null || !Array.isArray(c.tiles) || c.tiles.length !== 3 || new Set(c.tiles.map(suit)).size !== 1) throw new RoomError("请选择三张同花色手牌");
    const h = [...g.players[seat].hand];
    for (const t of c.tiles) { const at = h.indexOf(t); if (at < 0) throw new RoomError("选牌不在手中"); h.splice(at, 1); }
    r.exchanges[seat] = [...c.tiles];
  } else if (c.type === "void") {
    if (g.phase !== "void" || r.voids[seat] !== null || ![0, 1, 2].includes(c.suit)) throw new RoomError("当前不能定缺");
    r.voids[seat] = c.suit;
  } else if (c.type === "discard") discard(g, seat, c.tile);
  else if (c.type === "act") act(g, seat, c.action);
  else if (c.type === "claim") { respond(g, seat, c.action); advance(g); }
  else throw new RoomError("未知操作");
  clock(r, now);
}
export function roomView(r: RoomRecord, self: number, now: number): RoomView {
  const order = [0, 1, 2, 3].map(i => (i + self) % 4), at = (i: number) => (i - self + 4) % 4;
  const rotateMeld = (m: Meld) => ({ ...m, from: at(m.from) });
  const rotateFrame = (f: Frame): Frame => ({ ...f, players: order.map(i => ({ ...clone(f.players[i]), melds: f.players[i].melds.map(rotateMeld) })), current: at(f.current), dealer: at(f.dealer), lastFrom: f.lastFrom === undefined ? undefined : at(f.lastFrom) });
  const g = r.game;
  let safe: Game | null = null;
  if (g) {
    const reveal = g.phase === "end";
    safe = {
      ...clone(g), seed: 0, wall: Array(g.wall.length).fill(-1),
      current: at(g.current), dealer: at(g.dealer),
      drawnTile: g.current === self || reveal ? g.drawnTile : null,
      players: order.map(i => {
        const p = g.players[i], w = g.winners.find(w => w.player === i), winning = p.hand.lastIndexOf(w?.tile ?? -1);
        return { ...clone(p), hand: p.hand.map((t, k) => reveal || i === self || (p.won && k === winning) ? t : -1),
          melds: p.melds.map(m => ({ ...rotateMeld(m), tiles: !reveal && i !== self && m.concealed ? m.tiles.map(() => -1) : [...m.tiles] })) };
      }),
      winners: g.winners.map(w => ({ ...clone(w), player: at(w.player), from: at(w.from) })),
      payments: g.payments.map(p => ({ ...p, from: at(p.from), to: at(p.to) })),
      pending: g.pending ? { ...clone(g.pending), from: at(g.pending.from),
        actions: order.map(i => i === self ? clone(g.pending!.actions[i]).map(a => ({ ...a, tiles: a.tiles ? [...a.tiles] : undefined })) : []),
        responses: order.map(i => g.pending!.responses[i] === null ? null : { type: "pass" }) } : null,
      frames: reveal ? g.frames.map(rotateFrame) : [],
      previous: g.previous.map(fs => fs.map(rotateFrame)),
    };
  }
  return { id: r.id, isHost: r.host === self, selfSeat: self, version: r.version, stage: r.stage,
    serverTime: now, deadline: r.deadline, config: r.config, game: safe,
    seats: order.map(i => ({ name: r.seats[i]?.name ?? ["电脑东", "电脑南", "电脑西", "电脑北"][i], human: !!r.seats[i], connected: !!r.seats[i] && now - r.seats[i]!.seen <= DISCONNECT_MS, autoplay: automated(r, i), host: r.host === i })),
    exchangeReady: order.map(i => r.exchanges[i] !== null), voidReady: order.map(i => r.voids[i] !== null),
    actions: g ? clone(ownActions(g, self)) : [],
    claims: g?.pending && g.pending.responses[self] === null ? clone(g.pending.actions[self]) : [] };
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
export function createRoomsApi(store: RoomStore, now = () => Date.now()) {
  return async (req: Request): Promise<Response> => {
    try {
      const path = new URL(req.url).pathname, match = /^\/api\/rooms(?:\/([A-F0-9]{8})(?:\/(join|command))?)?\/?$/.exec(path);
      if (!match) throw new RoomError("房间接口不存在", 404);
      const [, id, route] = match;
      const method = !id || route ? "POST" : "GET";
      if (req.method !== method) return new Response(null, { status: 405, headers: { Allow: method } });
      let data: Record<string, unknown> = {};
      if (method === "POST") {
        if (!req.headers.get("content-type")?.startsWith("application/json")) throw new RoomError("请使用JSON请求", 415);
        const text = await req.text();
        if (new TextEncoder().encode(text).length > 16384) throw new RoomError("请求过大", 413);
        data = object(JSON.parse(text));
      }
      const time = now();
      await initCore();
      if (!id) {
        await store.prune(time);
        if (await store.count() >= 200) throw new RoomError("房间已满，请稍后再试", 429);
        const token = random(), player: Seat = { name: name(data.name), hash: await hash(token), seen: time, auto: false };
        for (let i = 0; i < 8; i++) {
          const room: RoomRecord = { id: random(4).toUpperCase(), version: 0, host: 0, config: configInput(data.config),
            seats: [player, null, null, null], game: null, exchanges: Array(4).fill(null), voids: Array(4).fill(null), stage: "lobby", deadline: 0, botAt: 0, expires: time + ROOM_TTL, commands: [] };
          if (await store.save(room, -1)) return json({ token, room: roomView(room, 0, time) }, 201);
        }
        throw new RoomError("房间创建失败，请重试", 503);
      }
      const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const tokenHash = await hash(bearer);
      const joinToken = route === "join" ? random() : "", joinHash = joinToken ? await hash(joinToken) : "";
      for (let attempt = 0; attempt < 8; attempt++) {
        const r = await store.load(id);
        if (!r || r.expires <= time) throw new RoomError("房间不存在或已过期", 404);
        const expected = r.version;
        let seat = r.seats.findIndex(s => s?.hash === tokenHash);
        if (route === "join") {
          if (r.game && r.game.phase !== "end") throw new RoomError("请等本局结束后再加入", 409);
          seat = r.seats.findIndex(s => s === null);
          if (seat < 0) throw new RoomError("四个座位已满", 409);
          r.seats[seat] = { name: name(data.name), hash: joinHash, seen: time, auto: false };
          if (r.host < 0) r.host = seat;
        } else {
          if (seat < 0 || bearer.length !== 48) throw new RoomError("无法验证座位，请使用原浏览器重连", 401);
          // Mark an absent seat as entrusted before renewing its heartbeat.
          if (time - r.seats[seat]!.seen > DISCONNECT_MS) r.seats[seat]!.auto = true;
          r.seats[seat]!.seen = time;
        }
        if (route === "command") {
          if (typeof data.requestId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(data.requestId)) throw new RoomError("操作编号无效");
          const key = `${seat}:${data.requestId}`;
          if (r.commands.includes(key)) return json({ room: roomView(r, seat, time) });
          const c = object(data.command) as unknown as RoomCommand;
          const administrative = ["leave", "takeback", "autoplay", "start", "next"].includes(c.type);
          if (!administrative && data.stage !== r.stage) throw new RoomError("牌局已变化，请重试当前操作", 409);
          // Preserve the grace deadline on live commands; only the polling path executes bot moves.
          if (!administrative && waiting(r, seat) && time >= r.deadline) { r.seats[seat]!.auto = true; throw new RoomError("操作已超时，请收回操作", 409); }
          command(r, seat, c, time);
          r.commands.push(key); r.commands = r.commands.slice(-80);
        } else tickRoom(r, time);
        r.expires = time + ROOM_TTL; r.version++;
        if (await store.save(r, expected)) return json({ ...(joinToken ? { token: joinToken } : {}), room: roomView(r, seat, time) });
      }
      throw new RoomError("房间忙，请重试", 409);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "联机请求失败" }, e instanceof RoomError ? e.status : e instanceof InputError || e instanceof SyntaxError ? 400 : 400);
    }
  };
}
