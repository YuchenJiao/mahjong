import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrategyPanel } from "../src/AssistantPanels";
import test,{before} from "node:test";
import assert from "node:assert/strict";
import {initCore,counts} from "../src/engine/core";
import {defaultConfig,type PublicView} from "../src/engine/types";
import {newGame,publicView} from "../src/engine/game";
import {rules,emptyContext} from "../src/engine/rules";
import {directionRoutes} from "../src/engine/assistant";
import {completionProbability,scoreFormula,enhanceRoutes} from "../src/engine/combination-routes";
before(initCore);
function view(hand:number[]):PublicView {
  const g=newGame({...defaultConfig,mode:"mcr"},undefined,4);
  g.players.forEach(p=>{p.river=[];p.melds=[];});g.players[0].hand=hand;
  return publicView(g,0);
}
function score(v:PublicView,h:number[],t:number,self:boolean) {
  const hand=[...h];if(!self)hand.splice(hand.indexOf(t),1);
  return rules.mcr.score({
    name:"",hand,melds:v.melds,river:[],voidSuit:-1,
    won:false,score:0,roundDelta:0
  },v.config,{...emptyContext(t),self,seat:v.seat,wind:v.wind});
}
test("A nearby closed route combines only 1/2/4-point items to reach eight",()=>{
  const target=[1,2,3,1,2,3,11,12,13,19,20,21,13,13],hand=[...target];
  hand.splice(hand.indexOf(12),1);hand.splice(hand.indexOf(21),1);hand.push(30);
  const v=view(hand),routes=directionRoutes(v);
  const r=routes.find(r=>r.name.startsWith("小番组合")&&r.missing<=2)!;
  assert.ok(r,"nearby small-fan combination must be generated");
  const s=r.ron.legal?r.ron:r.self;
  assert.ok(s.fan>=8);assert.ok(s.items.every(f=>f.value<8));
  assert.equal(s.fan,s.items.reduce((n,f)=>n+f.value*f.count,0));
  assert.match(scoreFormula(s),/＝\d+分/);
});
test("An open two-tile-away plan finds pungs plus dragon points without changing exposed groups",()=>{
  const v=view([3,4,31,31]);
  v.melds=[1,13,25].map(t=>({
    kind:"pung",tiles:[t,t,t],from:3,concealed:false
  }));
  v.players[0].melds=v.melds;
  const before=JSON.stringify(v);
  const r=directionRoutes(v).find(r=>r.name.startsWith("小番组合")&&r.missing<=2)!;
  assert.ok(r);const s=r.ron.legal?r.ron:r.self;
  assert.ok(s.items.some(f=>f.name==="碰碰和"));
  assert.ok(s.items.some(f=>f.name==="箭刻"));
  assert.ok(s.items.every(f=>f.value<8));
  assert.equal(r.example.length,5);assert.equal(JSON.stringify(v),before);
});
test("Probability accounts for physical abundance and multiplicity, not just missing count",()=>{
  assert.ok(Math.abs(completionProbability(10,[{count:2,left:2}],2)-1/45)<1e-12);
  assert.ok(Math.abs(completionProbability(10,[
    {count:1,left:4},{count:1,left:4}
  ],2)-16/45)<1e-12);
  assert.ok(Math.abs(completionProbability(6,[
    {count:1,left:2},{count:1,left:2}
  ],3)-.6)<1e-12);
  assert.equal(completionProbability(10,[{count:2,left:1}],8),0);
  assert.equal(completionProbability(10,[{count:2,left:4}],1),0);
  assert.equal(completionProbability(10,[],0),1);
});
test("All generated examples have real total scores, no future event bonuses and available physical tiles",()=>{
  const v=view([1,2,3,1,2,3,11,13,19,20,13,13,30]),before=JSON.stringify(v);
  for(const r of directionRoutes(v)){
    assert.ok(r.ron.legal||r.self.legal);
    assert.deepEqual(r.ron,score(v,r.example,r.winTile,false));
    assert.deepEqual(r.self,score(v,r.example,r.winTile,true));
    assert.ok(counts([...r.example,...v.melds.flatMap(m=>m.tiles)]).every(n=>n<=4));
    assert.ok(r.needed.every(n=>n.count<=n.left));
    assert.ok([...r.ron.items,...r.self.items].every(f=>![
      "杠上开花","抢杠和","妙手回春","海底捞月"
    ].includes(f.name)));
  }
  assert.equal(JSON.stringify(v),before);
  const r=directionRoutes(v);
  if(r.length){r[0].needed=[];assert.notDeepEqual(directionRoutes(v),r);}
});
test("Uniform target probability ranks same-distance candidates with different live availability",()=>{
  const v=view([1,2,3,1,2,3,11,13,19,20,13,13,30]);
  const base=directionRoutes(v)[0];
  const a={...base,name:"稀缺样例",needed:[{tile:0,count:2,left:2}],missing:2};
  const b={...base,name:"充足样例",needed:[
    {tile:7,count:1,left:4},{tile:8,count:1,left:4}
  ],missing:2};
  const ranked=enhanceRoutes(v,[a,b],()=>({
    legal:false,fan:0,points:0,items:[]
  }));
  assert.equal(ranked[0].name,"充足样例");
});
test("Disabling scoring retains the existing fixed-score route behavior",()=>{
  const v=view([1,2,3,1,2,3,11,13,19,20,13,13,30]);v.config.scoring=false;
  const existing=directionRoutes(v);
  assert.deepEqual(enhanceRoutes(v,existing,()=>{
    throw Error("unneeded scoring");
  }),existing);
});
test("Strategy UI exposes the sum of small items and labels the target probability honestly",()=>{
  const v=view([1,2,3,1,2,3,11,13,19,20,13,13,30]),routes=directionRoutes(v);
  const html=renderToStaticMarkup(createElement(StrategyPanel,{
    config:v.config,report:{
      shanten:1,waits:[],routes,actions:[],eightPointMinimum:true,notes:[]
    }
  }));
  assert.match(html,/小番组合/);assert.match(html,/route-formula/);
  assert.match(html,/非整体胡牌率/);assert.match(html,/＝[89]|＝1[0-9]/);
});
