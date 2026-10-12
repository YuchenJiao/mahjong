import test, { before } from "node:test";
import assert from "node:assert/strict";
import { initCore } from "../src/engine/core";
import { defaultConfig } from "../src/engine/types";
import type { Action } from "../src/engine/types";
import { discard } from "../src/engine/game";
import { createRoomsApi, stageKey, TURN_MS, NETWORK_GRACE_MS } from "../server/rooms";
import { MemoryRoomStore } from "../server/store-memory";
import { RoomUpdates } from "../src/online/updates";
import type { RoomView } from "../src/online/protocol";
before(async()=>{await initCore();});
function tiles(s:string){const h:number[]=[];for(const m of s.matchAll(/([1-9]+)([mps])|([ESWNCFP])/g)){if(m[1])for(const n of m[1])h.push("mps".indexOf(m[2])*9+Number(n)-1);else h.push(27+"ESWNCFP".indexOf(m[3]));}return h;}
async function fixture(kind: "chow"|"pung"|"kong"|"win") {
  const store=new MemoryRoomStore();let time=1000000;const api=createRoomsApi(store,()=>time);
  async function call(path:string,token?:string,data?:unknown){return api(new Request("http://localhost/api/rooms"+path,{method:data===undefined?"GET":"POST",headers:{...(token?{Authorization:"Bearer "+token}:{}),...(data===undefined?{}:{"Content-Type":"application/json"})},body:data===undefined?undefined:JSON.stringify(data)}));}
  const first=await(await call("",undefined,{name:"房主",config:{...defaultConfig,mode:"mcr",scoring:false}})).json(),id=first.room.id,tokens=[first.token];
  for(let i=1;i<4;i++)tokens.push((await(await call(`/${id}/join`,undefined,{name:"真人"+i})).json()).token);
  await call(`/${id}/command`,tokens[0],{stage:"lobby",requestId:crypto.randomUUID(),command:{type:"start"}});
  const r=(await store.load(id))!,g=r.game!;
  g.phase="turn";g.current=0;g.drawnTile=0;g.discardCount=5;g.callCount=0;
  g.players.forEach(p=>{p.hand=[];p.melds=[];p.river=[];p.discards=[];p.voidSuit=-1;});
  g.players[0].hand=tiles("1123456789m123p9p");
  g.players[1].hand=tiles(kind==="chow"?"23m456p789s55pEEN":kind==="pung"?"11m234p456p789sEE":kind==="kong"?"111m234p456p789sE":"123456789m123p1m");
  g.players[2].hand=tiles("23m456789m123p99s"); // another human can win, keeping the response phase open
  g.players[3].hand=tiles("234m345p567p789sN");
  discard(g,0,0);r.stage=stageKey(g);r.deadline=time+TURN_MS;r.botAt=time+500;
  await store.save({...r,version:r.version+1},r.version);
  const room=(await(await call(`/${id}`,tokens[1])).json()).room as RoomView;
  const action=room.claims.find(a=>a.type===kind);assert.ok(action,kind);
  return {store,api,call,id,tokens,room,action,advance:(ms:number)=>{time+=ms;},get time(){return time;}};
}
test("Clicking chow, pung, kong or win acknowledges the actual response; later polls and retries cannot turn it into pass",async()=>{
  for(const kind of ["chow","pung","kong","win"] as const){
    const f=await fixture(kind), requestId=crypto.randomUUID();
    // Reverse object property order to exercise semantic validation across JSON serializers.
    const reordered=Object.fromEntries(Object.entries(f.action).reverse()) as Action;
    const data={stage:f.room.stage,requestId,command:{type:"claim",action:reordered}};
    const response=await f.call(`/${f.id}/command`,f.tokens[1],data);assert.equal(response.status,200,kind);
    const acknowledged=(await response.json()).room as RoomView;
    assert.equal(acknowledged.game!.pending!.responses[0]!.type,kind);
    assert.equal(acknowledged.game!.events!.filter(e => e.kind !== "discard").length, 0, "unresolved calls are not announced");
    const gate=new RoomUpdates();gate.accept(f.room);
    const pollEpoch=gate.epoch, commandEpoch=gate.beginCommand();gate.accept(acknowledged,commandEpoch);
    assert.equal(gate.accept({...f.room,version:acknowledged.version+1},pollEpoch),false);
    assert.equal(gate.current!.game!.pending!.responses[0]!.type,kind);
    f.advance(1000);
    const later=(await(await f.call(`/${f.id}`,f.tokens[1])).json()).room;
    assert.equal(later.game.pending.responses[0].type,kind);
    assert.equal((await f.call(`/${f.id}/command`,f.tokens[1],data)).status,200);
    // Let the other winner explicitly pass. The original click is then actually applied.
    const other=(await(await f.call(`/${f.id}`,f.tokens[2])).json()).room;
    await f.call(`/${f.id}/command`,f.tokens[2],{stage:other.stage,requestId:crypto.randomUUID(),command:{type:"claim",action:{type:"pass"}}});
    const game=(await f.store.load(f.id))!.game!;
    if(kind==="win"){assert.equal(game.phase,"end");assert.equal(game.winners[0].player,1);}
    else{assert.equal(game.players[1].melds[0].kind,kind==="chow"?"chow":kind==="pung"?"pung":"kong");assert.equal(game.current,1);}
    assert.ok(game.events!.some(e => e.kind === kind && e.actor === 1), "only the applied action produces a public event");
  }
});
test("An already selected call is explicitly cancelled when another player wins; it isn't silently changed to pass",async()=>{
  const f=await fixture("pung");
  await f.call(`/${f.id}/command`,f.tokens[1],{stage:f.room.stage,requestId:crypto.randomUUID(),command:{type:"claim",action:f.action}});
  const other=(await(await f.call(`/${f.id}`,f.tokens[2])).json()).room;
  assert.ok(other.claims.some((a:Action)=>a.type==="win"));
  await f.call(`/${f.id}/command`,f.tokens[2],{stage:other.stage,requestId:crypto.randomUUID(),command:{type:"claim",action:{type:"win"}}});
  const g=(await f.store.load(f.id))!.game!;assert.equal(g.winners[0].player,2);
  assert.ok(g.log.some(s=>s.includes("选择碰")&&s.includes("胡牌优先")));
  assert.equal(g.events!.some(e=>e.kind==="pung"),false,"cancelled pung must not be spoken");
  assert.ok(g.events!.some(e=>e.kind==="win"&&e.actor===2));
});
test("Network grace accepts a live click at the deadline, but cannot replay a claim from a different stage",async()=>{
  const f=await fixture("pung");f.advance(TURN_MS+NETWORK_GRACE_MS-100);
  // A real heartbeat renews the seat; it does not auto-pass inside the network grace period.
  const r=(await f.store.load(f.id))!;r.seats.forEach(s=>{if(s)s.seen=f.time;});await f.store.save({...r,version:r.version+1},r.version);
  const data={stage:f.room.stage,requestId:crypto.randomUUID(),command:{type:"claim",action:f.action}};
  assert.equal((await f.call(`/${f.id}/command`,f.tokens[1],data)).status,200);
  assert.equal((await f.call(`/${f.id}/command`,f.tokens[2],{...data,requestId:crypto.randomUUID(),stage:"old-stage"})).status,409);
});
test("Room difficulty is host-controlled and backend assistant styles are personal read-only requests",async()=>{
  const f=await fixture("pung"),before=(await f.store.load(f.id))!;
  const change={stage:f.room.stage,requestId:crypto.randomUUID(),command:{type:"difficulty",difficulty:"easy"}};
  assert.equal((await f.call(`/${f.id}/command`,f.tokens[1],change)).status,403);
  assert.equal((await f.call(`/${f.id}/command`,f.tokens[0],change)).status,200);
  assert.equal((await f.store.load(f.id))!.game!.config.aiDifficulty,"easy");
  const r=(await f.store.load(f.id))!;r.game!.phase="turn";r.game!.pending=null;r.game!.current=1;
  r.game!.players[1].hand.push(14);r.stage=stageKey(r.game);await f.store.save({...r,version:r.version+1},r.version);
  const version=(await f.store.load(f.id))!.version;
  for(const style of ["attack","balanced","defense"]){
    const response=await f.call(`/${f.id}/analyze`,f.tokens[1],{style,stage:r.stage});assert.equal(response.status,200);
    const advice=await response.json();assert.ok(advice.analysis.length>0);assert.equal(advice.style,style);
    assert.ok(advice.analysis.every((a:{tile:number})=>r.game!.players[1].hand.includes(a.tile)));
  }
  assert.equal((await f.store.load(f.id))!.version,version); // style changes neither the game nor its clock
  assert.equal((await f.call(`/${f.id}/analyze`,undefined,{style:"attack"})).status,401);
});
