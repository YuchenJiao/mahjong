import { counts, evaluate, suit, tileName, sortHand } from "./core";
import { advise, discardRisk, knownCounts } from "./ai";
import { ownActions, publicView, winScore } from "./game";
import { emptyContext, rules } from "./rules";
import type { Action, Game, Meld, PlayStyle, PublicView, WinScore } from "./types";

export type WaitAdvice = { tile: number; left: number; ron: WinScore; self: WinScore };
export type RouteAdvice = {
  name: string; missing: number; needed: { tile: number; count: number; left: number }[];
  keep: number[]; example: number[]; core: number[]; ron: WinScore; self: WinScore; winTile: number;
};
export type ActionAdvice = {
  action: Action; label: string; recommended: boolean; reasons: string[];
  afterShanten?: number; legalWaits?: number; score?: WinScore; executable: boolean;
};
export type AssistantReport = {
  shanten: number; basisDiscard?: number; waits: WaitAdvice[]; routes: RouteAdvice[];
  actions: ActionAdvice[]; eightPointMinimum: boolean; notes: string[];
};

function exactScore(v: PublicView, complete: number[], melds: Meld[], winTile: number, self: boolean): WinScore {
  const hand = [...complete];
  if (!self) hand.splice(hand.indexOf(winTile), 1);
  const exposed = v.players.reduce((n,p) => n+p.river.filter(t=>t===winTile).length+p.melds.filter(m=>!m.concealed).flatMap(m=>m.tiles).filter(t=>t===winTile).length,0);
  return rules[v.config.mode].score({ name: "", hand, melds, river: [], voidSuit: v.voidSuit, won: false, score: 0, roundDelta: 0 }, v.config,
    { ...emptyContext(winTile), self, seat: v.seat, wind: v.wind, lastCopy: exposed >= 3 });
}
export function winningWaits(v: PublicView): WaitAdvice[] {
  if (v.hand.length % 3 !== 1) return [];
  const owned = counts([...v.hand, ...v.melds.flatMap(m => m.tiles)]), known = knownCounts(v);
  const result: WaitAdvice[] = [];
  for (let tile = 0; tile < (v.config.mode === "mcr" ? 34 : 27); tile++) {
    if (owned[tile] >= 4 || v.config.mode === "sichuan" && suit(tile) === v.voidSuit) continue;
    const complete = [...v.hand, tile], ron = exactScore(v, complete, v.melds, tile, false), self = exactScore(v, complete, v.melds, tile, true);
    // Negative native scores and invalid Sichuan shapes are never legal waits.
    if (ron.legal || self.legal || v.config.mode === "mcr" && (ron.fan > 0 || self.fan > 0)) result.push({ tile, left: Math.max(0, 4-known[tile]), ron, self });
  }
  return result;
}
type Group = number[];
const allGroups: Group[] = [
  ...Array.from({length: 34}, (_,t) => [t,t,t]),
  ...Array.from({length: 3}, (_,s) => Array.from({length: 7}, (_,n) => [s*9+n,s*9+n+1,s*9+n+2])).flat(),
];
const groupKey = (g: number[]) => g.slice(0,3).join(",");
const fixedGroups = (v: PublicView) => v.melds.map(m => m.kind === "chow" ? [...m.tiles].sort((a,b)=>a-b) : Array(3).fill(m.tiles[0]) as number[]);
function concealedTarget(v: PublicView, groups: Group[]): number[] | null {
  const remaining = groups.map(g => [...g]);
  for (const g of fixedGroups(v)) {
    const at = remaining.findIndex(r => groupKey(r) === groupKey(g));
    if (at < 0) return null;
    remaining.splice(at,1);
  }
  const hand = remaining.flat();
  if (counts([...hand,...v.melds.flatMap(m=>m.tiles)]).some(n=>n>4)) return null;
  sortHand(hand); return hand;
}
export function directionRoutes(v: PublicView): RouteAdvice[] {
  const handCounts = counts(v.hand), known = knownCounts(v), limit = v.config.mode === "mcr" ? 34 : 27;
  const permitted = (t: number) => t < limit && (v.config.mode !== "sichuan" || suit(t) !== v.voidSuit);
  type Core = { name: string; groups: Group[]; extra?: Group[]; pairs?: number[] };
  const cores: Core[] = [];
  if (v.config.mode === "mcr") {
    for (let n=0;n<7;n++) cores.push({ name: "三色三同顺", groups: [0,1,2].map(s=>[s*9+n,s*9+n+1,s*9+n+2]) });
    for (let s=0;s<3;s++) cores.push({ name: "清龙", groups: [0,3,6].map(n=>[s*9+n,s*9+n+1,s*9+n+2]) });
    for (const colors of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])
      cores.push({ name: "花龙", groups: colors.map((s,k)=>[s*9+k*3,s*9+k*3+1,s*9+k*3+2]) });
  }
  const support = (g: Group) => { const c=counts(g);return c.reduce((sum,n,t)=>sum+Math.min(n,handCounts[t]),0); };
  const pungs = allGroups.filter(g=>g[0]===g[1] && permitted(g[0])).sort((a,b)=>support(b)-support(a));
  const own = fixedGroups(v);
  // Add practical triplet and flush paths, preserving every already exposed set.
  if (own.every(g=>g[0]===g[1])) {
    const selected = [...own];
    for (const g of pungs) if (selected.length<3 && !selected.some(x=>groupKey(x)===groupKey(g))) selected.push(g);
    if (selected.length===3) cores.push({ name: "碰碰和方向", groups: selected, extra: pungs });
    if (v.config.mode === "mcr" && own.length<=2) {
      for (const honor of [...new Set([31,32,33,27+v.seat,27+v.wind])]) {
        const selected = [...own];
        if (!selected.some(g=>g[0]===honor)) selected.push([honor,honor,honor]);
        for (const g of pungs) if (selected.length<3 && !selected.some(x=>groupKey(x)===groupKey(g))) selected.push(g);
        if (selected.length===3) cores.push({ name: "碰碰和＋字牌刻子", groups: selected, extra: pungs });
      }
    }
  }
  for (let s=0;s<3;s++) {
    if (!permitted(s*9)) continue;
    for (const mixed of v.config.mode === "mcr" ? [false,true] : [false]) {
      const inSuit = (t:number) => suit(t)===s || mixed && t>=27;
      if (own.some(g=>g.some(t=>!inSuit(t)))) continue;
      const groups=allGroups.filter(g=>g.every(inSuit)).sort((a,b)=>support(b)-support(a));
      const selected=[...own];
      for (const g of groups) if(selected.length<3 && !selected.some(x=>groupKey(x)===groupKey(g))) selected.push(g);
      if (selected.length===3) cores.push({name: mixed ? "混一色方向" : "清一色方向",groups:selected,extra:groups,pairs:Array.from({length:limit},(_,t)=>t).filter(inSuit)});
    }
  }
  const routes: RouteAdvice[] = [];
  function assess(name:string, target:number[], core:number[]): RouteAdvice | null {
    const c=counts(target), needed=c.flatMap((n,t)=>n>handCounts[t]?[{tile:t,count:n-handCounts[t],left:Math.max(0,4-known[t])}]:[]);
    if (needed.some(n=>n.count>n.left)) return null;
    const winTile=needed[0]?.tile ?? target.at(-1)!;
    const ron=exactScore(v,target,v.melds,winTile,false), self=exactScore(v,target,v.melds,winTile,true);
    if (!ron.legal && !self.legal) return null;
    return { name, missing:needed.reduce((n,t)=>n+t.count,0), needed,keep:v.hand.filter(t=>{if(c[t]>0){c[t]--;return true;}return false;}),example:target,core,ron,self,winTile };
  }
  for (const core of cores) {
    // A three-set core has only one free set; two incompatible calls block it.
    const unmatched=[...fixedGroups(v)], base=[...core.groups];
    for(const g of base){const at=unmatched.findIndex(x=>groupKey(x)===groupKey(g));if(at>=0)unmatched.splice(at,1);}
    if(unmatched.length>1)continue;
    const extras=unmatched.length?[unmatched[0]]:core.extra??allGroups.filter(g=>g.every(permitted));
    const shortlist:{target:number[];missing:number}[]=[];
    for(const extra of extras){
      const base=concealedTarget(v,[...core.groups,extra]);if(!base)continue;
      const c=counts(base), physical=counts([...base,...v.melds.flatMap(m=>m.tiles)]);let baseMissing=0,blocked=false;
      for(let t=0;t<limit;t++){const need=Math.max(0,c[t]-handCounts[t]);if(need>4-known[t]){blocked=true;break;}baseMissing+=need;}
      if(blocked)continue;
      for(const pair of core.pairs??Array.from({length:limit},(_,t)=>t).filter(permitted)){
        const pairNeed=Math.max(0,c[pair]+2-handCounts[pair]);
        if(physical[pair]+2>4||pairNeed>4-known[pair])continue;
        const missing=baseMissing-Math.max(0,c[pair]-handCounts[pair])+pairNeed;
        if(shortlist.length<6 || missing<shortlist.at(-1)!.missing){const target=[...base,pair,pair];sortHand(target);shortlist.push({target,missing});shortlist.sort((a,b)=>a.missing-b.missing);if(shortlist.length>6)shortlist.pop();}
      }
    }
    for(const candidate of shortlist){const route=assess(core.name,candidate.target,core.groups.flat());if(route){routes.push(route);break;}}
  }
  if (!v.melds.length) {
    const pairs=Array.from({length:limit},(_,t)=>t).filter(t=>permitted(t)&&Math.max(0,2-handCounts[t])<=4-known[t]).sort((a,b)=>Math.min(2,handCounts[b])-Math.min(2,handCounts[a]) || (4-known[b])-(4-known[a]) || a-b).slice(0,7);
    if(pairs.length===7){const target=pairs.flatMap(t=>[t,t]);sortHand(target);const r=assess("七对",target,target);if(r)routes.push(r);}
  }
  for (const wait of winningWaits(v).filter(w=>w.left>0&&(w.ron.legal||w.self.legal))) {
    const complete=[...v.hand,wait.tile];sortHand(complete);
    const score=wait.ron.legal?wait.ron:wait.self, fan=[...score.items].sort((a,b)=>b.value*b.count-a.value*a.count)[0]?.name??"合法和牌";
    const r=assess(`现有听牌 · ${fan}`,complete,complete);if(r)routes.push(r);
  }
  const best=new Map<string,RouteAdvice>();
  for(const route of routes.sort((a,b)=>a.missing-b.missing || Number(b.ron.legal)-Number(a.ron.legal) || b.ron.fan-a.ron.fan))if(!best.has(route.name))best.set(route.name,route);
  return [...best.values()].slice(0,3);
}
function discardBasis(v: PublicView, style: PlayStyle) {
  if(v.hand.length%3!==2)return {v,discard:undefined as number|undefined};
  const choice=advise(v,{style,difficulty:"advanced"})[0];
  if(!choice)return {v,discard:undefined as number|undefined};
  const hand=[...v.hand];hand.splice(hand.indexOf(choice.tile),1);
  return {discard:choice.tile,v:{...v,hand,players:v.players.map((p,i)=>i===v.self?{...p,river:[...p.river,choice.tile]}:p)}};
}
function afterAction(v:PublicView,a:Action):PublicView {
  const hand=[...v.hand],melds=v.melds.map(m=>({...m,tiles:[...m.tiles]}));
  if(a.type==="addedKong"){
    hand.splice(hand.indexOf(a.tile!),1);const m=melds[a.meldIndex!];m.kind="kong";m.added=true;m.tiles.push(a.tile!);
  }else{
    const ts=a.type==="chow"?a.tiles!:Array(a.type==="pung"?3:4).fill(a.tile!);
    const remove=[...ts];if(a.type!=="concealedKong")remove.splice(remove.indexOf(a.tile!),1);
    for(const t of remove)hand.splice(hand.indexOf(t),1);
    melds.push({kind:a.type==="chow"?"chow":a.type==="pung"?"pung":"kong",tiles:ts,from:v.lastDiscard?.from??v.self,concealed:a.type==="concealedKong"});
  }
  const claimed = ["chow","pung","kong"].includes(a.type);
  return {...v,hand,melds,players:v.players.map((p,i)=>i===v.self?{...p,melds}:claimed&&i===v.lastDiscard?.from&&p.river.at(-1)===v.lastDiscard.tile?{...p,river:p.river.slice(0,-1)}:p)};
}
const names:Record<Action["type"],string>={pass:"过／继续摸打",win:"胡",chow:"吃",pung:"碰",kong:"杠",addedKong:"补杠",concealedKong:"暗杠"};
export function actionGuidance(v:PublicView, actions:Action[], style:PlayStyle, currentWin?:WinScore):ActionAdvice[] {
  if(!actions.length)return [];
  const basis=discardBasis(v,style), before=evaluate(basis.v.hand,v.melds,v.config.mode==="mcr").shanten;
  const scored:{advice:ActionAdvice;utility:number}[]=[];
  for(const action of actions){
    if(action.type==="pass")continue;
    if(action.type==="win"){
      scored.push({utility:10000,advice:{action,label:names.win,recommended:false,executable:true,score:currentWin,reasons:[`当前可合法胡牌${currentWin?v.config.scoring?`，${currentWin.fan}${v.config.mode==="mcr"?"分":"番"}`:`，固定胡牌分${currentWin.points}`:""}；兑现本次收益，避免后续被他家截胡或流局。`]}});continue;
    }
    const next=discardBasis(afterAction(v,action),style).v, after=evaluate(next.hand,next.melds,v.config.mode==="mcr").shanten;
    const waits=after===0?winningWaits(next):[],available=waits.filter(w=>w.ron.legal||w.self.legal).reduce((n,w)=>n+w.left,0);
    const opens=["chow","pung","kong"].includes(action.type)&&v.melds.every(m=>m.concealed);
    const kong=["kong","addedKong","concealedKong"].includes(action.type);
    const reasons=[`${names[action.type]}后${after===0?"结构听牌":`${after}向听`}（当前${before}向听）${after===0?`；常规合法和牌进张约${available}张`:""}。`];
    if(opens)reasons.push(v.config.mode==="mcr"?"副露后不再计门前清／不求人，需保留其他可达到起胡门槛的番型。":"副露会锁定牌组，后续做七对或换做其他牌型的空间减少。");
    if(kong)reasons.push("杠后补牌未知；杠上开花等事件番需实际发生才计入。");
    if(action.type==="addedKong")reasons.push("补杠可能被抢杠胡，尤其注意已副露或晚局对手。");
    const gated=v.config.mode==="mcr"&&v.config.scoring&&v.config.mcrEightPointMinimum!==false;
    if(gated&&after===0&&!available)reasons.push("结构听牌但当前看不到仍有余张且达到8分的常规和牌进张，宜慎重副露。");
    const utility=(before-after)*30+available*.3+(kong&&v.config.mode==="sichuan"?1:0)-(opens&&gated?2:0)-(gated&&after===0&&!available?100:0)-(action.type==="addedKong"?discardRisk(v,action.tile!).risk:0);
    scored.push({utility,advice:{action,label:names[action.type],recommended:false,reasons,afterShanten:after,legalWaits:available,executable:true}});
  }
  const passReasons=[v.config.mode==="mcr"?"保留当前手牌与门清条件，继续观察后续进张；等待会消耗机会。":"保留当前手牌与变牌空间，继续观察后续进张；等待会消耗机会。"];
  if(currentWin){
    const higher=winningWaits(basis.v).filter(w=>w.left>0&&Math.max(w.self.fan,w.ron.fan)>currentWin.fan).slice(0,4);
    passReasons.unshift(higher.length?`继续摸打后，${higher.map(w=>`${tileName(w.tile)}（常规最高${Math.max(w.self.fan,w.ron.fan)}${v.config.mode==="mcr"?"分":"番"}，约${w.left}张）`).join("、")}有提升空间；这些牌不保证能摸到或等到。`:"未发现仍有余张的更高分常规等待；追大通常还需改牌，存在被截胡或流局风险。");
  }
  scored.push({utility:0,advice:{action:{type:"pass"},label:actions.some(a=>a.type==="pass")?"过": "继续摸打（需先出牌）",recommended:false,reasons:passReasons,executable:actions.some(a=>a.type==="pass")}});
  scored.sort((a,b)=>b.utility-a.utility);
  scored[0].advice.recommended=true;
  return scored.map(r=>r.advice);
}
const cache=new Map<string,AssistantReport>();
export function buildAssistantReport(g:Game,seat:number,style:PlayStyle="balanced"):AssistantReport|null {
  if(["exchange","void","end"].includes(g.phase)||g.players[seat].won)return null;
  const v=publicView(g,seat), legal=g.phase==="turn"&&g.current===seat?ownActions(g,seat):g.pending?.responses[seat]===null?[...g.pending.actions[seat],{type:"pass"} as Action]:[];
  const currentWin=legal.some(a=>a.type==="win")?winScore(g,seat,g.phase==="turn"):undefined;
  const key=JSON.stringify([v,legal,currentWin,style]),old=cache.get(key);if(old)return structuredClone(old);
  const basis=discardBasis(v,style),shanten=evaluate(basis.v.hand,basis.v.melds,v.config.mode==="mcr").shanten;
  const report:AssistantReport={shanten,basisDiscard:basis.discard,waits:shanten===0?winningWaits(basis.v):[],routes:directionRoutes(basis.v),actions:actionGuidance(v,legal,style,currentWin),
    eightPointMinimum:v.config.mode==="mcr"&&v.config.scoring&&v.config.mcrEightPointMinimum!==false,
    notes:["目标距离是示例成牌还需补入的张数，不等于向听数；示例不保证可达。","示例分数已按实际番型互斥规则计算，可见绝张按当前公开牌判断；不预计杠上花、海底等未来事件番。"]};
  if(cache.size>=64)cache.clear();cache.set(key,structuredClone(report));return report;
}
