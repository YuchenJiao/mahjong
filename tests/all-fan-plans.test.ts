import test, {before} from "node:test";
import assert from "node:assert/strict";
import {initCore,fanReference,scoreString,counts} from "../src/engine/core";
import {newGame,publicView} from "../src/engine/game";
import {defaultConfig,type Meld,type PublicView} from "../src/engine/types";
import {buildAssistantReport,directionRoutes} from "../src/engine/assistant";
import {fanPlanCatalog,verifiedFanRoutes} from "../src/engine/fan-plans";
import {emptyContext,rules} from "../src/engine/rules";
import corpus from "./mcr-corpus.json";

before(initCore);
const tiles=(text:string)=>[...text.matchAll(/([1-9]+)([mps])|([ESWNCFP])/g)]
  .flatMap(([,n,s,h])=>h?[27+"ESWNCFP".indexOf(h)]:[...n].map(x=>"mps".indexOf(s)*9+ +x-1));
function setup(hand:number[],melds:Meld[]=[],seat=0,wind=0){
  const g=newGame({...defaultConfig,mode:"mcr",scoring:true,mcrEightPointMinimum:true},undefined,4);
  g.players[0].hand=hand;
  g.players[0].melds=melds;
  return {g,v:{...publicView(g,0),seat,wind}};
}
function verified(v:PublicView){
  return verifiedFanRoutes(v,(complete,t,self)=>{
    const hand=[...complete];if(!self)hand.splice(hand.indexOf(t),1);
    return rules.mcr.score({name:"",hand,melds:v.melds,river:[],voidSuit:-1,won:false,score:0,roundDelta:0},
      v.config,{...emptyContext(t),self,seat:v.seat,wind:v.wind});
  });
}
test("Recommends both knitted honor routes in the reported screenshot hand",()=>{
  const {g}=setup([0,3,4,5,11,24,25,26,27,28,30,31,32,33]);
  const r=buildAssistantReport(g,0)!;
  assert.ok(r.routes.some(x=>x.name==="七星不靠"));
  assert.ok(r.routes.some(x=>x.name==="全不靠"));
  assert.ok(r.fanCatalog?.some(x=>x.name==="十三幺"&&x.route));
  assert.equal(r.fanCatalog?.length,fanReference().length);
});
test("Hard restrictions: fixed sets rule out closed structures; four visible copies rule out a target",()=>{
  const {v}=setup(tiles("119m19s19pESWNCF"));
  assert.ok(verified(v).some(r=>r.name==="十三幺"&&r.missing===1));
  v.players[1].river=[33,33,33,33];
  assert.ok(!verified(v).some(r=>r.name==="十三幺"));
  const exposed=setup(tiles("19m19s19pESWN"),[{kind:"pung",tiles:[31,31,31],from:1,concealed:false}]).v;
  assert.ok(!verified(exposed).some(r=>["十三幺","全不靠","七星不靠","连七对","九莲宝灯"].includes(r.name)));
});
test("Every shape family has a near-ready example verified by the real scoring engine",()=>{
  const want=new Set(fanPlanCatalog([]).filter(f=>!f.condition).map(f=>f.name));
  const cases=corpus.map(x=>{
    const normal=x.flags&1;
    const total=scoreString(x.text,normal,x.seat,x.wind);
    const hits=total.total>=8?total.items.filter(f=>want.has(f.name)).map(f=>f.name):[];
    const melds:Meld[]=[...x.text.matchAll(/\[([^\]]+)\]/g)].map(([,str])=>{
      const ts=tiles(str);
      return {tiles:ts,kind:ts.length===4?"kong":ts[0]===ts[1]?"pung":"chow",
        from:1,concealed:ts.length===4&&!/[1-9]$/.test(str)};
    });
    const h=tiles(x.text.replace(/\[[^\]]+\]/g,""));
    return {x, hits, melds,h};
  }).filter(x=>x.hits.length);
  assert.equal(want.size,62);
  let tries=0;
  while(want.size){
    cases.sort((a,b)=>b.hits.filter(x=>want.has(x)).length-a.hits.filter(x=>want.has(x)).length);
    const c=cases.shift();
    if(!c||!c.hits.some(x=>want.has(x)))break;
    const {v}=setup(c.h.slice(0,-1),c.melds,c.x.seat,c.x.wind);
    for(const r of verified(v)){
      if(r.missing===1)want.delete(r.name);
      assert.ok([r.ron,r.self].some(s=>s.legal&&s.items.some(f=>f.name===r.name)));
      assert.ok(r.needed.every(n=>n.count<=n.left));
      assert.ok(counts([...r.example,...v.melds.flatMap(m=>m.tiles)]).every(n=>n<=4));
    }
    tries++;
  }
  assert.deepEqual([...want],[],`Uncovered after ${tries} native corpus witnesses`);
});
test("Disabled scoring leaves the existing fixed score behavior and suppresses the catalog",()=>{
  const {g,v}=setup(tiles("119m19s19pESWNCF"));
  g.config.scoring=false;v.config.scoring=false;
  assert.equal(buildAssistantReport(g,0)?.fanCatalog,undefined);
  assert.ok(directionRoutes(v).every(r=>(r.ron.legal?r.ron:r.self).items[0].name==="固定胡牌分"));
});
