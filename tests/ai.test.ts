import test, { before } from "node:test";
import assert from "node:assert/strict";
import { initCore, evaluate } from "../src/engine/core";
import { defaultConfig } from "../src/engine/types";
import type { PublicView, Game, Action } from "../src/engine/types";
import { advise, knownCounts, discardRisk, opponentThreats } from "../src/engine/ai";
import { newGame, publicView, discard, respond, advance } from "../src/engine/game";
import { configInput } from "../server/validation";
before(async () => { await initCore(); });
function tiles(s: string) {
  const h: number[] = [];
  for (const m of s.matchAll(/([1-9]+)([mps])|([ESWNCFP])/g)) {
    if (m[1]) for (const n of m[1]) h.push("mps".indexOf(m[2])*9+Number(n)-1);
    else h.push(27+"ESWNCFP".indexOf(m[3]));
  }
  return h;
}
function view(hand: string): PublicView {
  return { config: {...defaultConfig,mode:"mcr",scoring:false}, self:0,hand:tiles(hand),melds:[],voidSuit:-1,
    seat:0,wind:0,remaining:40, players:Array.from({length:4},()=>({melds:[],river:[],discards:[],voidSuit:-1,won:false,handCount:13})) };
}
test("Physical visible counts don't duplicate claimed history; public winning tiles are accounted for", () => {
  const v=view("123456789m356p99s");
  v.players[1].melds=[{kind:"pung",tiles:[13,13,13],from:2,concealed:false}];
  v.players[2].discards=[13];v.players[2].river=[];
  v.publicWinningTiles=[4];
  const k=knownCounts(v);
  assert.equal(k[13],4); // our five dots + the exposed pung; the claimed discard is not a fifth copy
  assert.equal(k[4],2); // our five characters + one publicly shown winning tile
});
test("Attack preserves the two-sided live wait rather than discarding a useful connector", () => {
  const v=view("123456789m356p99s");
  const result=advise(v,{style:"attack",difficulty:"advanced"});
  assert.equal(result[0].tile,11); // discard 3 dots, keep 56 rather than the 35 closed wait
  assert.equal(result[0].shanten,0);assert.equal(result[0].ukeire,8);
  assert.ok(result.filter(a=>a.effectiveShanten>0).every(a=>a.utility<result[0].utility));
});
test("A globally discarded six dots beats nine dots when both discard choices retain a single wait", () => {
  const v=view("123456m789s69pEEE");v.players[1].river=[14];v.players[1].discards=[14];
  const result=advise(v,{style:"balanced"});
  const six=result.find(a=>a.tile===14)!,nine=result.find(a=>a.tile===17)!;
  assert.equal(six.shanten,nine.shanten);assert.equal(six.shanten,0);
  const noDiscard = structuredClone(v);noDiscard.players[1].river=[];noDiscard.players[1].discards=[];
  assert.ok(six.risk<discardRisk(noDiscard,14).risk);assert.ok(six.ukeire>nine.ukeire);
  assert.equal(result[0].tile,14);assert.ok(six.reason.includes("全桌已弃1张同牌"));
});
test("Defense adapts to exposed ready hands and style changes without observing hidden hands", () => {
  const v=view("123456789m356p99s");v.remaining=16;v.config.scoring=true;v.config.mcrEightPointMinimum=false;
  v.players[1].melds=tiles("222777888p").reduce((m,t,i,ts)=>{if(i%3===0)m.push({kind:"pung",tiles:ts.slice(i,i+3),from:2,concealed:false});return m;},[] as PublicView["melds"]);
  v.players[1].river=tiles("19m19sEE");v.players[1].discards=[...v.players[1].river];v.players[1].handCount=4;
  assert.ok(opponentThreats(v)[0].readiness>.6);assert.equal(opponentThreats(v)[0].flushSuit,1);
  const attack=advise(v,{style:"attack"}),defense=advise(v,{style:"defense"});
  const a=attack.find(a=>a.tile===11)!,d=defense.find(a=>a.tile===11)!;
  assert.ok(d.defensePenalty>a.defensePenalty*5);assert.notEqual(a.reason,d.reason);
  assert.ok(discardRisk(v,11).risk>discardRisk(v,26).risk);
  v.config.mode="sichuan";v.players[1].voidSuit=1;
  const withOpponent=discardRisk(v,11).risk;v.players[1].won=true;
  assert.equal(discardRisk(v,11).risk,withOpponent); // a void suit contributes no win risk
});
test("All difficulty levels are deterministic and only return legal own-hand discards", () => {
  const g=newGame({...defaultConfig,mode:"mcr",mcrEightPointMinimum:false},undefined,421);
  const v=publicView(g,0);
  for(const difficulty of ["easy","normal","advanced"] as const){
    const first=advise(v,{difficulty});assert.deepEqual(first,advise(v,{difficulty}));
    assert.ok(first.every(a=>v.hand.includes(a.tile)&&Number.isFinite(a.utility)));
    if(difficulty==="easy")assert.ok(first.every(a=>a.defensePenalty===0&&a.futureQuality===0));
  }
  assert.equal(configInput({mode:"mcr"}).aiDifficulty,"advanced");
  assert.throws(()=>configInput({mode:"mcr",aiDifficulty:"magic"}));
});
test("An exhausted structural wait does not outrank a live wait",()=>{
  const v=view("123456789m69pEEE");v.players[1].river=[17,17,17];v.players[1].discards=[17,17,17];
  const result=advise(v,{style:"attack"});
  const dead=result.find(a=>a.tile===14)!,live=result.find(a=>a.tile===17)!;
  assert.equal(dead.shanten,0);assert.equal(dead.ukeire,0);assert.equal(dead.effectiveShanten,1);
  assert.equal(live.shanten,0);assert.equal(live.ukeire,3);assert.equal(result[0].tile,17);
});
test("Live public view records historical claimed discards, and multi-ron exposes one physical tile", () => {
  const g=newGame({...defaultConfig,scoring:false},undefined,82);
  g.phase="turn";g.current=0;g.drawnTile=0;
  g.players.forEach(p=>{p.melds=[];p.river=[];p.discards=[];p.voidSuit=2;});
  g.players[0].hand=tiles("1123456789m123p9p");g.players[1].hand=tiles("123456789m123p1m");
  g.players[2].hand=tiles("123456789m123p1m");g.players[3].hand=tiles("2233445566778p");
  discard(g,0,0);respond(g,1,{type:"win"});respond(g,2,{type:"win"});
  if(g.pending!.responses[3]===null)respond(g,3,{type:"pass"});advance(g);
  assert.deepEqual(g.players[0].river,[]);assert.deepEqual(g.players[0].discards,[0]);
  assert.deepEqual(publicView(g,3).publicWinningTiles,[0]);
  assert.deepEqual(publicView(g,1).publicWinningTiles,[]); // own hand already contains that physical winning tile
});
