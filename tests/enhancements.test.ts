import test, { before } from "node:test";
import assert from "node:assert/strict";
import { initCore, counts, sortHand } from "../src/engine/core";
import { newGame, publicView, integrateDraw, discard, hasSeparateDraw, winScore } from "../src/engine/game";
import { winningWaits, directionRoutes, buildAssistantReport, actionGuidance } from "../src/engine/assistant";
import { defaultConfig, type Meld } from "../src/engine/types";
import { emptyContext, rules } from "../src/engine/rules";
import { orderedCards, reconcileOrder } from "../src/HandRow";
import { createRoomsApi, roomView, stageKey, tickRoom } from "../server/rooms";
import { MemoryRoomStore } from "../server/store-memory";
before(initCore);
function tiles(s: string) { const out:number[]=[];for(const m of s.matchAll(/([1-9]+)([mps])|([ESWNCFP])/g)){if(m[1])for(const n of m[1])out.push("mps".indexOf(m[2])*9+Number(n)-1);else out.push(27+"ESWNCFP".indexOf(m[3]));}return out; }
const game=()=>newGame({...defaultConfig,mode:"mcr"},undefined,719);
const melds=():Meld[]=>["123m","456p","678s"].map(s=>({kind:"chow",tiles:tiles(s),from:3,concealed:false}));
function waiting(){const g=game();g.players.forEach(p=>{p.melds=[];p.river=[];});g.players[0].hand=tiles("34p99s");g.players[0].melds=melds();g.current=1;g.drawnTile=null;g.drawState=null;return g;}

test("Separate draw identity, manual integration and replay preserve the actual hand",()=>{
  const g=game(), before=[...g.players[0].hand],stage=stageKey(g),id=g.drawState!.id;
  assert.equal(hasSeparateDraw(g,0),true);assert.equal(hasSeparateDraw(g,1),false);
  assert.throws(()=>integrateDraw(g,1,id));assert.throws(()=>integrateDraw(g,0,id+1));
  integrateDraw(g,0,id);
  assert.deepEqual(g.players[0].hand,before);assert.equal(hasSeparateDraw(g,0),false);
  assert.equal(stageKey(g),stage);assert.equal(g.frames.at(-1)!.layoutOnly,true);
  assert.deepEqual(g.events!.at(-1),{id:1,actor:0,kind:"integrate"});
  assert.equal(g.frames.at(-1)!.drawnTile,g.drawnTile);
  assert.equal(g.frames.at(-1)!.drawState!.separated,false);
  assert.throws(()=>integrateDraw(g,0,id));
  const t=g.drawnTile!;discard(g,0,t,false);
  assert.deepEqual(g.events!.at(-1),{id:2,actor:0,kind:"discard",tile:t,fromDraw:false});
});
test("Draw discard and hand discard are distinct even for identical tile faces",()=>{
  const a=game(),draw=a.drawnTile!;discard(a,0,draw,true);
  assert.equal(a.events!.some(e=>e.kind==="integrate"),false);assert.equal(a.events!.at(-1)!.fromDraw,true);assert.ok(a.frames.at(-1)!.label.includes("摸切"));
  const b=game(),other=b.players[0].hand.find(t=>t!==b.drawnTile)!;
  const unchanged=JSON.stringify(b);assert.throws(()=>discard(b,0,other,true));assert.equal(JSON.stringify(b),unchanged);
  b.players[0].hand=[...b.players[0].hand.slice(0,-1),b.drawnTile!];sortHand(b.players[0].hand);
  if(b.players[0].hand.filter(t=>t===b.drawnTile).length<2)b.players[0].hand[0]=b.drawnTile!;
  discard(b,0,b.drawnTile!,false);
  assert.deepEqual(b.events!.map(e=>e.kind),["integrate","discard"]);assert.equal(b.events!.at(-1)!.fromDraw,false);
});
test("Manual order reconciles multisets and maps duplicate faces to canonical indices",()=>{
  assert.deepEqual(reconcileOrder([3,1,3,7],[1,2,3,3]),[3,1,3,2]);
  assert.deepEqual(orderedCards([1,1,2,4],1,[4,1,2]),[{tile:4,index:3},{tile:1,index:0},{tile:2,index:2}]);
  assert.deepEqual(orderedCards([1,1,2,4],-1,[4,1,2]),[{tile:4,index:3},{tile:1,index:0},{tile:2,index:2},{tile:1,index:1}]);
});
test("Waiting guidance distinguishes structural waits, eight-point legal waits and fixed scores",()=>{
  const g=waiting(),v=publicView(g,0),strict=winningWaits(v),w=strict.find(w=>w.tile===tiles("5p")[0])!;
  assert.ok(w);assert.ok(w.ron.fan>0&&w.ron.fan<8);assert.equal(w.ron.legal,false);assert.equal(w.self.legal,false);
  v.config={...v.config,mcrEightPointMinimum:false};const relaxed=winningWaits(v).find(x=>x.tile===w.tile)!;
  assert.equal(relaxed.ron.legal,true);assert.equal(relaxed.ron.fan,w.ron.fan);
  v.config={...v.config,scoring:false};const fixed=winningWaits(v).find(x=>x.tile===w.tile)!;
  assert.equal(fixed.ron.legal,true);assert.equal(fixed.ron.points,v.config.base);
});
test("Visible last-copy scoring is included, without counting concealed copies as exposed",()=>{
  const g=waiting(),tile=tiles("2p")[0],v=publicView(g,0),base=winningWaits(v).find(w=>w.tile===tile)!;
  v.players[1].river=[tile,tile,tile];const last=winningWaits(v).find(w=>w.tile===tile)!;
  assert.ok(last.ron.items.some(f=>f.name==="和绝张"));assert.equal(last.left,1);assert.ok(last.ron.fan>base.ron.fan);
  v.players[1].river=[];v.players[1].melds=[{kind:"kong",tiles:[-1,-1,-1,-1],concealed:true,from:1}];
  assert.equal(winningWaits(v).find(w=>w.tile===tile)!.ron.items.some(f=>f.name==="和绝张"),false);
});
test("Every direction example is a legal native-scored completion with honest missing counts",()=>{
  for(const seed of [4,27,719]){
    const g=newGame({...defaultConfig,mode:"mcr"},undefined,seed),v=publicView(g,0);v.hand.splice(v.hand.indexOf(g.drawnTile!),1);
    const routes=directionRoutes(v);assert.ok(routes.length>0);
    for(const r of routes){
      const c=counts(r.example),owned=counts(v.hand);
      assert.equal(r.missing,c.reduce((n,num,t)=>n+Math.max(0,num-owned[t]),0));
      assert.equal(r.needed.reduce((n,x)=>n+x.count,0),r.missing);assert.ok(r.needed.every(n=>n.count<=n.left));
      assert.ok(r.ron.legal||r.self.legal);assert.ok(r.example.length===14);
      for(const self of [false,true]){
        const hand=[...r.example];if(!self)hand.splice(hand.indexOf(r.winTile),1);
        const actual=rules.mcr.score({...g.players[0],hand},g.config,{...emptyContext(r.winTile),self,seat:v.seat,wind:v.wind});
        assert.deepEqual(self?r.self:r.ron,actual);
      }
    }
  }
});
test("Assistant is read-only and insensitive to concealed opponent tiles and wall order",()=>{
  const g=game(),before=JSON.stringify(g),first=buildAssistantReport(g,0,"defense");
  assert.equal(JSON.stringify(g),before);assert.ok(first?.routes.length);
  const hidden=structuredClone(g);for(let i=1;i<4;i++)hidden.players[i].hand=hidden.players[i].hand.map((_,k)=>(k+i)%34);
  hidden.wall.reverse();hidden.seed=999;
  assert.deepEqual(buildAssistantReport(hidden,0,"defense"),first);
  first!.notes.push("consumer mutation");assert.notDeepEqual(buildAssistantReport(g,0,"defense"),first);
});
test("Action advice compares calls and pass, recommends legal win and describes higher-score risk",()=>{
  const g=waiting(),v=publicView(g,0);v.lastDiscard={tile:tiles("5p")[0],from:3};
  const before=JSON.stringify(v),actions=actionGuidance(v,[{type:"chow",tile:v.lastDiscard.tile,tiles:tiles("345p")},{type:"pass"}],"balanced");
  assert.equal(JSON.stringify(v),before);assert.equal(actions.length,2);assert.equal(actions.filter(a=>a.recommended).length,1);
  assert.equal(typeof actions.find(a=>a.action.type==="chow")!.afterShanten,"number");
  const closed=publicView(game(),0);closed.hand=tiles("123m34p123sEECCF");closed.lastDiscard={tile:tiles("5p")[0],from:3};
  const closedHints=actionGuidance(closed,[{type:"chow",tile:closed.lastDiscard.tile,tiles:tiles("345p")}],"balanced");
  assert.ok(closedHints.flatMap(a=>a.reasons).some(s=>s.includes("副露")));
  g.config.mcrEightPointMinimum=false;g.current=0;g.players[0].hand.push(tiles("5p")[0]);g.drawnTile=tiles("5p")[0];g.discardCount=5;
  const score=winScore(g,0,true);assert.equal(score.legal,true);
  const report=buildAssistantReport(g,0)!;assert.equal(report.actions[0].action.type,"win");assert.equal(report.actions[0].recommended,true);
  assert.deepEqual(report.actions[0].score,score);assert.ok(report.actions.find(a=>a.action.type==="pass")!.reasons.some(s=>s.includes("风险")||s.includes("不保证")));
});
function request(path:string,token?:string,body?:unknown){return new Request("http://localhost/api/rooms"+path,{method:body===undefined?"GET":"POST",headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});}
test("Two online seats observe draw integration without its face or a renewed deadline; guidance endpoint is read-only",async()=>{
  const store=new MemoryRoomStore(),now=1000000,api=createRoomsApi(store,()=>now);
  const first=await(await api(request("",undefined,{name:"Host",config:{...defaultConfig,mode:"mcr"}}))).json(),id=first.room.id;
  const guest=await(await api(request(`/${id}/join`,undefined,{name:"Guest"}))).json();
  const cmd=(token:string,stage:string,command:unknown)=>api(request(`/${id}/command`,token,{stage,command,requestId:crypto.randomUUID()}));
  assert.equal((await cmd(first.token,first.room.stage,{type:"start"})).status,200);
  let r=(await store.load(id))!,stage=r.stage,deadline=r.deadline;
  const hidden=roomView(r,1,now).game!;assert.equal(hidden.drawnTile,null);assert.deepEqual(hidden.drawState,{actor:3,id:0,separated:true});assert.ok(hidden.players[3].hand.every(t=>t===-1));
  const snapshot=JSON.stringify(r),analysis=await api(request(`/${id}/analyze`,guest.token,{stage,style:"attack"}));
  assert.equal(analysis.status,200);const analyzed=await analysis.json();assert.ok(analyzed.guidance?.routes.length);assert.deepEqual(analyzed.analysis,[]);assert.equal(JSON.stringify(await store.load(id)),snapshot);
  assert.equal((await cmd(guest.token,stage,{type:"integrateDraw",drawId:0})).status,400);
  assert.equal((await cmd(first.token,stage,{type:"integrateDraw",drawId:0})).status,200);
  r=(await store.load(id))!;assert.equal(r.stage,stage);assert.equal(r.deadline,deadline);
  tickRoom(r,now+10);assert.equal(r.deadline,deadline);assert.equal(r.stage,stage);
  const view=roomView(r,1,now);assert.equal(view.game!.drawnTile,null);assert.equal(view.game!.drawState!.separated,false);
  assert.deepEqual(view.game!.events!.at(-1),{id:1,actor:3,kind:"integrate"});assert.ok(view.game!.players[3].hand.every(t=>t===-1));
  assert.equal((await cmd(first.token,stage,{type:"discard",tile:r.game!.drawnTile,fromDraw:false})).status,200);
  r=(await store.load(id))!;assert.equal(roomView(r,1,now).game!.events!.filter(e=>e.kind==="discard")[0].fromDraw,false);
});

test("Open-hand routes preserve exposed sets and match actual scoring exclusions",()=>{
  const g=waiting(),v=publicView(g,0),routes=directionRoutes(v);
  for(const r of routes){
    assert.equal(r.example.length,5);assert.ok(r.ron.legal||r.self.legal);
    assert.ok(!r.ron.items.some(f=>f.name==="门前清"||f.name==="不求人"));
    assert.ok(counts([...r.example,...v.melds.flatMap(m=>m.tiles)]).every(n=>n<=4));
  }
  // A less constrained open hand must have at least one concrete route.
  v.melds=v.melds.slice(0,1);v.hand=tiles("123p123sEEFF");
  const open=directionRoutes(v);assert.ok(open.length>0);
  for(const r of open){assert.equal(r.example.length,11);assert.ok(r.ron.legal||r.self.legal);}
});
test("Sichuan guidance respects the missing suit and does not invent MCR-only menqing bonuses",()=>{
  const g=newGame({...defaultConfig,mode:"sichuan",scoring:false},undefined,4);g.phase="turn";g.current=1;g.players[0].voidSuit=2;
  g.players[0].hand=tiles("123m123p789p3345m");g.players[0].melds=[];
  const v=publicView(g,0),report=buildAssistantReport(g,0)!;
  assert.equal(report.eightPointMinimum,false);assert.ok(report.waits.length>0);assert.ok(report.waits.every(w=>w.tile<18));
  for(const r of report.routes)assert.ok(r.example.every(t=>t<18));
  v.lastDiscard={tile:0,from:3};v.hand=tiles("113m123p789p3345m");
  const hints=actionGuidance(v,[{type:"pung",tile:0}],"balanced");
  assert.equal(hints.flatMap(h=>h.reasons).some(s=>s.includes("门前清")||s.includes("不求人")),false);
});
