import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCore } from "../src/engine/core";
import { defaultConfig } from "../src/engine/types";
import { chooseExchange, chooseVoid, publicView } from "../src/engine/game";
import { advise, chooseOwn, chooseResponse } from "../src/engine/ai";
import { createRoomsApi, DISCONNECT_MS, TURN_MS, NETWORK_GRACE_MS, tickRoom, roomView, stageKey } from "../server/rooms";
import { MemoryRoomStore } from "../server/store-memory";
import { SqliteRoomStore } from "../server/store-sqlite";
import { withCors } from "../server/cors";
import type { RoomView, RoomCommand } from "../src/online/protocol";
before(async () => { await initCore(); });
function request(path: string, token?: string, body?: unknown) {
  return new Request("http://localhost/api/rooms" + path, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
function setup(mode: "sichuan" | "mcr" = "sichuan") {
  const store = new MemoryRoomStore(); let time = 1000000;
  const api = createRoomsApi(store, () => time);
  return { store, api, get time() { return time; }, advance(ms = 1000) { time += ms; },
    async create() { return (await api(request("", undefined, { name: "房主", config: { ...defaultConfig, mode, mcrEightPointMinimum: false } }))).json() as Promise<{ token: string; room: RoomView }>; },
    async read(id: string, token: string) { const r = await api(request("/" + id, token)); assert.equal(r.status, 200); return (await r.json()).room as RoomView; },
    async send(id: string, token: string, view: RoomView, command: RoomCommand, requestId = crypto.randomUUID()) {
      return api(request(`/${id}/command`, token, { stage: view.stage, command, requestId }));
    } };
}
test("Rooms allow 1–4 players, protect seats, transfer host and serialize concurrent joins", async () => {
  const s = setup(), first = await s.create(), id = first.room.id;
  assert.equal(first.room.seats.filter(p => p.human).length, 1);
  assert.equal((await s.api(request("/" + id))).status, 401);
  const joined = await Promise.all(Array.from({ length: 4 }, (_, i) => s.api(request(`/${id}/join`, undefined, { name: `玩家${i}` }))));
  assert.deepEqual(joined.map(r => r.status).sort(), [200, 200, 200, 409]);
  const guest = await joined.find(r => r.status === 200)!.json();
  assert.equal((await s.send(id, guest.token, guest.room, { type: "start" })).status, 403);
  const host = await s.read(id, first.token);
  assert.equal(host.seats.filter(p => p.human).length, 4);
  assert.equal((await s.send(id, first.token, host, { type: "leave" })).status, 200);
  assert.equal((await s.api(request("/" + id, first.token))).status, 401);
  const remaining = await s.read(id, guest.token);
  assert.equal(remaining.seats.filter(p => p.host).length, 1);
});
test("Room views hide the wall, seeds, opponent hands, concealed kongs, actions and active replay", async () => {
  const s = setup("mcr"), first = await s.create(), id = first.room.id;
  assert.equal((await s.send(id, first.token, first.room, { type: "start" })).status, 200);
  const stored = await s.store.load(id); assert.ok(stored?.game);
  assert.equal(JSON.stringify(stored).includes(first.token), false);
  stored.game.players[1].melds = [{ kind: "kong", tiles: [2,2,2,2], from: 1, concealed: true }];
  stored.game.events = [{id:1,actor:2,kind:"discard",tile:0},{id:2,actor:1,kind:"kong"}];
  stored.game.players[2].won = true; stored.game.players[2].hand = [0,0,1,2,3];
  stored.game.winners.push({ player: 2, from: 1, tile: 0, self: false, received: 1, score: { fan: 0, items: [], points: 1, legal: true } });
  const view = roomView(stored, 0, s.time).game!;
  assert.equal(view.seed, 0); assert.ok(view.wall.every(t => t === -1));
  assert.ok(view.players[1].hand.every(t => t === -1));
  assert.deepEqual(view.players[1].melds[0].tiles, [-1,-1,-1,-1]);
  assert.equal(view.players[2].hand.filter(t => t === 0).length, 1);
  assert.equal(view.players[2].hand.filter(t => t === -1).length, 4);
  assert.equal(view.frames.length, 0);
  assert.deepEqual(view.events!.at(-1),{id:2,actor:1,kind:"kong"});
  const rotated = roomView(stored, 1, s.time).game!;
  assert.deepEqual(rotated.players[0].hand, stored.game.players[1].hand);
  assert.equal(rotated.dealer, (stored.game.dealer + 3) % 4);
  assert.deepEqual(rotated.events,[{id:1,actor:1,kind:"discard",tile:0},{id:2,actor:0,kind:"kong"}]);
  stored.game.phase = "end";
  const ended = roomView(stored, 0, s.time).game!;
  assert.deepEqual(ended.players[1].hand, stored.game.players[1].hand);
  assert.ok(ended.frames.length > 0);
});
test("Commands are idempotent, stale moves and actions outside a player's seat are rejected", async () => {
  const s = setup("mcr"), first = await s.create(), id = first.room.id;
  const uid = crypto.randomUUID();
  assert.equal((await s.send(id, first.token, first.room, { type: "start" }, uid)).status, 200);
  const view = await s.read(id, first.token), before = (await s.store.load(id))!.game!;
  assert.equal((await s.send(id, first.token, first.room, { type: "start" }, uid)).status, 200);
  assert.equal((await s.store.load(id))!.game!.round, before.round);
  assert.equal((await s.send(id, first.token, first.room, { type: "discard", tile: view.game!.players[0].hand[0] })).status, 409);
  assert.equal((await s.send(id, first.token, view, { type: "discard", tile: 99 })).status, 400);
  const tile = view.game!.players[0].hand[0], discardId = crypto.randomUUID();
  assert.equal((await s.send(id, first.token, view, { type: "discard", tile }, discardId)).status, 200);
  assert.equal((await s.send(id, first.token, view, { type: "discard", tile }, discardId)).status, 200);
  assert.equal((await s.store.load(id))!.game!.discardCount, 1);
  assert.equal((await s.api(request(`/${id}/join`, undefined, { name: "后来者" }))).status, 409);
});
test("Disconnected and timed-out humans are entrusted; resume preserves the hand and takeback renews the timer", async () => {
  const s = setup("mcr"), first = await s.create(), id = first.room.id;
  await s.send(id, first.token, first.room, { type: "start" });
  s.advance(DISCONNECT_MS + 1);
  const resumed = await s.read(id, first.token);
  assert.equal(resumed.seats[0].autoplay, true);
  assert.equal(resumed.game!.players[0].river.length, 1);
  assert.equal((await s.send(id, first.token, resumed, { type: "takeback" })).status, 200);
  assert.equal((await s.read(id, first.token)).seats[0].autoplay, false);
  const r = (await s.store.load(id))!;
  r.game!.current = 0; r.game!.phase = "turn"; r.game!.pending = null;
  r.stage = `${r.game!.round}:turn:0:${r.game!.frames.length}`;
  r.deadline = s.time - NETWORK_GRACE_MS - 1; r.botAt = s.time + 100000;
  tickRoom(r, s.time); assert.equal(r.seats[0]!.auto, true);
  await s.store.save({ ...r, version: r.version + 1 }, r.version);
  const view = roomView(r, 0, s.time);
  await s.send(id, first.token, view, { type: "takeback" });
  assert.equal((await s.store.load(id))!.deadline, s.time + TURN_MS);
});
test("SQLite room and reconnect credentials survive a real service store restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mahjong-room-")), path = join(dir, "rooms.sqlite");
  let store = new SqliteRoomStore(path), api = createRoomsApi(store);
  try {
    const created = await (await api(request("", undefined, { name: "持久房主", config: { mode: "mcr" } }))).json();
    store.close(); store = new SqliteRoomStore(path); api = createRoomsApi(store);
    const response = await api(request("/" + created.room.id, created.token));
    assert.equal(response.status, 200); assert.equal((await response.json()).room.isHost, true);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
test("Cross-origin API only permits configured frontend origins", async () => {
  const request = new Request("https://api.example/api/rooms", { method: "OPTIONS", headers: { Origin: "https://game.example" } });
  assert.equal((await withCors(request, [], async () => new Response())).status, 403);
  const permitted = await withCors(request, ["https://game.example"], async () => new Response());
  assert.equal(permitted.status, 204); assert.equal(permitted.headers.get("Access-Control-Allow-Origin"), "https://game.example");
});
test("Both modes finish complete online games with 1, 2, 3 and 4 independent human sessions", async () => {
  for (const mode of ["sichuan", "mcr"] as const) for (const humans of [1,2,3,4]) {
    const s = setup(mode), first = await s.create(), id = first.room.id, tokens = [first.token];
    for (let i = 1; i < humans; i++) {
      const joined = await (await s.api(request(`/${id}/join`, undefined, { name: `真人${i}` }))).json(); tokens.push(joined.token);
    }
    await s.send(id, first.token, first.room, { type: "start" });
    let ended = false;
    for (let step = 0; step < 1000; step++) {
      s.advance();
      for (const token of tokens) {
        const view = await s.read(id, token), g = view.game!;
        if (g.phase === "end") { ended = true; assert.equal(g.players.reduce((sum, p) => sum + p.score, 0), 0); break; }
        assert.equal(g.frames.length, 0); assert.ok(g.wall.every(t => t === -1));
        let c: RoomCommand | undefined;
        if (g.phase === "exchange" && !view.exchangeReady[0]) c = { type: "exchange", tiles: chooseExchange(g.players[0].hand) };
        else if (g.phase === "void" && !view.voidReady[0]) c = { type: "void", suit: chooseVoid(g.players[0]) };
        else if (view.claims.length) c = { type: "claim", action: chooseResponse(publicView(g, 0), view.claims) };
        else if (g.phase === "turn" && g.current === 0 && !g.players[0].won) {
          const v = publicView(g, 0), a = chooseOwn(v, view.actions);
          c = a ? { type: "act", action: a } : { type: "discard", tile: advise(v)[0].tile };
        }
        if (c) assert.equal((await s.send(id, token, view, c)).status, 200, `${mode} ${humans} ${c.type}`);
      }
      if (ended) break;
    }
    assert.ok(ended, `${mode} ${humans} humans deadlocked`);
    const final = await s.read(id, first.token);
    assert.ok(final.game!.frames.length > 0);
    assert.equal((await s.send(id, first.token, final, { type: "next" })).status, 200);
    assert.equal((await s.read(id, first.token)).game!.round, 2);
  }
});
test("Each computer difficulty finishes both rule modes through the room API",async()=>{
  for(const mode of ["sichuan","mcr"] as const)for(const difficulty of ["easy","normal","advanced"] as const){
    const s=setup(mode),first=await s.create(),id=first.room.id;
    await s.send(id,first.token,first.room,{type:"difficulty",difficulty});
    await s.send(id,first.token,first.room,{type:"start"});
    const begun=await s.read(id,first.token);
    await s.send(id,first.token,begun,{type:"autoplay"});
    let finished=false;
    for(let turn=0;turn<800;turn++){
      s.advance();const state=await s.read(id,first.token);
      assert.equal(state.config.aiDifficulty,difficulty);
      if(state.game!.phase==="end"){
        assert.equal(state.game!.players.reduce((sum,p)=>sum+p.score,0),0);finished=true;break;
      }
    }
    assert.ok(finished,`${mode}/${difficulty} did not terminate`);
  }
});
