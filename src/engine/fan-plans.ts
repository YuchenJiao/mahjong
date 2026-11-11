import { counts, fanReference, rank, suit } from "./core";
import { knownCounts } from "./ai";
import { completionProbability } from "./combination-routes";
import type { RouteAdvice } from "./assistant";
import type { PublicView, WinScore } from "./types";

type Score = (hand:number[],tile:number,self:boolean)=>WinScore;
type Group = number[];
type Filter = (g:Group)=>boolean;
type Seed = { groups:Group[]; pair?:number; filter?:Filter; closed?:boolean };
const seq=(n:number,start=0)=>Array.from({length:n},(_,i)=>i+start);
const tiles=seq(34), suits=seq(3), winds=seq(4,27), dragons=seq(3,31), honors=[...winds,...dragons];
const terminal=(t:number)=>rank(t)===1||rank(t)===9;
const yaojiu=(t:number)=>t>=27||terminal(t);
const pung=(t:number)=>[t,t,t], chow=(t:number)=>[t,t+1,t+2];
const pungs=tiles.map(pung), chows=suits.flatMap(s=>seq(7,s*9).map(chow)), groups=[...chows,...pungs];
const isPung=(g:Group)=>g[0]===g[1], isChow=(g:Group)=>g[0]!==g[1];
const within=(f:(t:number)=>boolean):Filter=>g=>g.every(f);
const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const knitted=permutations.map(p=>p.flatMap((s,i)=>[0,3,6].map(n=>s*9+i+n)));
const key=(g:Group)=>g.join(",");
const names=()=>fanReference().map(f=>f.name);
const ruleNotes:Record<number,string>={
  4:"四副已成立的杠",16:"三副已成立的杠",43:"摸到牌墙最后一张并自摸",44:"胡最后一张弃牌",
  45:"杠后补牌自摸",46:"抢他人补杠的牌",51:"四副明牌，点和单钓将牌",
  52:"两副暗杠",55:"保持门清并自摸",56:"两副明杠",57:"和公开已见三张的第四张",
  61:"保持门清并点和",66:"一副暗杠",73:"一副明杠",76:"仅听边张",
  77:"仅听嵌张",78:"仅听将牌",79:"实际自摸",80:"本游戏未启用花牌",81:"一副明杠加一副暗杠"
};
export function fanPlanCatalog(routes:RouteAdvice[]){
  const found=new Map<string,RouteAdvice>();
  for(const r of routes)for(const score of [r.ron,r.self])if(score.legal)
    for(const f of score.items)if(!found.has(f.name))found.set(f.name,r);
  return fanReference().map(({name,value},i)=>{
    const r=found.get(name);
    return {name,value,condition:ruleNotes[i],route:r?.name,missing:r?.missing,needed:r?.needed};
  });
}
const seeds=new Map<number,Seed[]>();
const add=(id:number,groups:Group[]=[],o:Omit<Seed,"groups">={})=>{
  const list=seeds.get(id)??[];list.push({groups,...o});seeds.set(id,list);
};
const only=(id:number,f:(t:number)=>boolean)=>add(id,[],{filter:within(f)});
const combos=(xs:number[],n:number):number[][]=>!n?[[]]:xs.flatMap((x,i)=>combos(xs.slice(i+1),n-1).map(rest=>[x,...rest]));
const repeats=(x:number,n:number)=>Array(n).fill(x) as number[];
add(0,winds.map(pung));add(1,dragons.map(pung));
only(2,t=>[19,20,21,23,25,32].includes(t));
only(7,terminal);only(10,t=>t>=27);only(17,yaojiu);
add(11,[],{filter:isPung,closed:true});add(32,[],{closed:true});add(65,[],{closed:true});
add(42);add(47,[],{filter:isPung});add(54,[],{filter:g=>g.some(yaojiu)});
add(30,[],{filter:g=>g.some(t=>rank(t)===5)});
add(50);add(62,[],{filter:g=>g.length===2?g[0]<27:isChow(g)});
for(const t of winds)add(8,winds.filter(x=>x!==t).map(pung),{pair:t});
for(const t of dragons)add(9,dragons.filter(x=>x!==t).map(pung),{pair:t});
for(const list of combos(winds,3))add(37,list.map(pung));
for(const list of combos(dragons,2))add(53,list.map(pung));
for(const t of dragons)add(58,[pung(t)]);
for(const t of tiles.filter(yaojiu))add(72,[pung(t)]);
for(const [id,lo,hi] of [[20,2,8],[24,7,9],[25,4,6],[26,1,3],[35,6,9],[36,1,4],[67,2,8]]){
  only(id,t=>rank(t)>=lo&&rank(t)<=hi&&(id!==20||rank(t)%2===0));
}
only(39,t=>[10,11,12,13,14,17,18,20,21,22,23,25,26,33].includes(t));
only(75,t=>t<27);
for(const s of suits){
  const b=s*9;
  only(21,t=>suit(t)===s);only(48,t=>suit(t)===s||t>=27);only(74,t=>suit(t)!==s);
  add(12,[chow(b),chow(b),chow(b+6),chow(b+6)],{pair:b+4});
  add(27,[chow(b),chow(b+3),chow(b+6)]);
  add(71,[chow(b),chow(b+6)]);
  for(const x of seq(7,b)){
    for(const [id,n] of [[13,4],[22,3],[68,2]])add(id,repeats(x,n).map(chow));
    if(x+3<=b+6)add(70,[chow(x),chow(x+3)]);
    for(const d of [1,2])for(const [id,n] of [[15,4],[29,3]])
      if(x+d*(n-1)<=b+6)add(id,seq(n).map(i=>chow(x+d*i)));
  }
  for(const x of seq(9,b))for(const [id,n] of [[14,4],[23,3]])
    if(x+n-1<=b+8)add(id,seq(n,x).map(pung));
}
for(const p of permutations){
  const [a,b,c]=p.map(i=>i*9);
  add(28,[chow(a),chow(a+6),chow(b),chow(b+6)],{pair:c+4});
  add(38,[chow(a),chow(b+3),chow(c+6)]);
  for(const n of seq(9)){
    add(31,[a,b,c].map(s=>pung(s+n)));
    if(n<=6)add(41,[pung(a+n),pung(b+n+1),pung(c+n+2)]);
    if(n<=6){add(40,[a,b,c].map(s=>chow(s+n)));add(69,[chow(a+n),chow(b+n)]);}
    if(n<=4)add(49,[chow(a+n),chow(b+n+1),chow(c+n+2)]);
    add(64,[pung(a+n),pung(b+n)]);
  }
}
for(const t of seq(27))for(const g of chows.filter(g=>g.includes(t)))add(63,[pung(t),g]);
for(const t of tiles)add(63,[],{pair:t});

export function verifiedFanRoutes(v:PublicView,score:Score):RouteAdvice[]{
  if(v.config.mode!=="mcr"||!v.config.scoring)return [];
  const catalog=names(), held=counts(v.hand), fixed=counts(v.melds.flatMap(m=>m.tiles));
  const left=knownCounts(v).map(n=>Math.max(0,4-n));
  const pool=left.reduce((a,b)=>a+b,0), draws=Math.min(8,Math.ceil(v.remaining/Math.max(1,v.players.filter(p=>!p.won).length)));
  const locked=v.melds.map(m=>m.kind==="chow"?[...m.tiles].sort((a,b)=>a-b):pung(m.tiles[0]));
  const lockedKeys=locked.map(key), open=v.melds.filter(m=>!m.concealed).length;
  const targetSize=14-3*locked.length;
  const families=new Map<number,Map<string,State>>();
  type State={c:number[];cost:number};
  const empty:State={c:tiles.map(()=>0),cost:0};
  const weight=left.map(n=>1+(4-n)*.19);
  function more(s:State,g:Group):State|null{
    const c=[...s.c];let cost=s.cost;
    for(const t of g){
      if(++c[t]+fixed[t]>4||c[t]>held[t]+left[t])return null;
      if(c[t]>held[t])cost+=weight[t];
    }
    return {c,cost};
  }
  function top<T extends {cost:number}>(items:T[],max:number){return items.sort((a,b)=>a.cost-b.cost).slice(0,max);}
  function save(id:number,s:State|null){
    if(!s||s.cost>13)return;
    let m=families.get(id);if(!m)families.set(id,m=new Map());
    const k=s.c.join("");
    if(m.has(k))return;
    if(m.size>=12){
      const last=[...m].reduce((a,b)=>a[1].cost>b[1].cost?a:b);
      if(last[1].cost<=s.cost)return;
      m.delete(last[0]);
    }
    m.set(k,s);
  }
  const enter=(id:number,ts:number[])=>save(id,more(empty,ts));
  const regular=new Map(seeds);
  for(const [id,t] of [[59,27+v.wind],[60,27+v.seat]])regular.set(id,[{groups:[pung(t)]}]);
  for(const [id,list] of regular){
    const opts=list.flatMap(seed=>{
      if(seed.closed&&open>4-(id===11?4:id===32?3:2))return [];
      const accepts=(g:Group)=>!seed.filter||seed.filter(g);
      if(!locked.every(accepts))return [];
      const rest=[...lockedKeys], needed:Group[]=[];
      for(const g of seed.groups){
        const i=rest.indexOf(key(g));if(i>=0)rest.splice(i,1);else needed.push(g);
      }
      const free=4-locked.length-needed.length;
      if(free<0)return [];
      const s=more(empty,[...needed.flat(),...(seed.pair===undefined?[]:[seed.pair,seed.pair])]);
      return s?[{...s,seed,free,accepts}]:[];
    });
    for(const o of top(opts,10)){
      let beam:State[]=o.seed.pair===undefined?
        top(tiles.flatMap(t=>{const g=[t,t],n=o.accepts(g)?more(o,g):null;return n?[n]:[];}),7):[o];
      const allowed=groups.filter(o.accepts);
      for(let i=0;i<o.free;i++){
        const next=new Map<string,State>();
        for(const state of beam)for(const g of allowed){
          const n=more(state,g);if(n)next.set(n.c.join(""),n);
        }
        beam=top([...next.values()],7);
      }
      for(const state of beam)save(id,state);
    }
  }
  if(!locked.length){
    const orphans=tiles.filter(yaojiu);
    for(const t of orphans)enter(6,[...orphans,t]);
    for(const s of suits){
      const b=s*9,gate=[b,b,b,...seq(7,b+1),b+8,b+8,b+8];
      for(const t of seq(9,b))enter(3,[...gate,t]);
      for(const start of seq(3,b))enter(5,seq(7,start).flatMap(t=>[t,t]));
    }
    let beam:State[]=[empty];
    for(let i=0;i<7;i++){
      const next=new Map<string,State>();
      for(const s of beam)for(const t of tiles){
        const n=more(s,[t,t]);if(n)next.set(n.c.join(""),n);
      }
      beam=top([...next.values()],12);
    }
    for(const s of beam)save(18,s);
    for(const k of knitted){
      for(const n of combos(k,7))enter(19,[...honors,...n]);
      for(const n of combos([...k,...honors],14))if(!honors.every(t=>n.includes(t)))enter(33,n);
    }
  }
  if(locked.length<=1)for(const k of knitted){
    const base=more(empty,k);if(!base)continue;
    const sets=locked.length?[[]]:groups;
    for(const g of sets){
      const s=more(base,g);if(!s)continue;
      for(const t of tiles)save(34,more(s,[t,t]));
    }
  }
  const checked=new Map<string,{ron:WinScore;self:WinScore}>();
  const best=new Map<string,RouteAdvice & {odds:{draws:number;probability:number}}>();
  const rankTargets=new Map<string,{needed:RouteAdvice["needed"];missing:number;probability:number}>();
  function details(s:State){
    const k=s.c.join(""), old=rankTargets.get(k);if(old)return old;
    const needed=s.c.flatMap((n,t)=>n>held[t]?[{tile:t,count:n-held[t],left:left[t]}]:[]);
    const value={needed,missing:needed.reduce((a,x)=>a+x.count,0),probability:completionProbability(pool,needed,draws)};
    rankTargets.set(k,value);return value;
  }
  for(const [id,list] of families){
    const sorted=[...list.values()].sort((a,b)=>details(b).probability-details(a).probability||details(a).missing-details(b).missing||a.cost-b.cost);
    for(const s of sorted){
      const hand=s.c.flatMap((n,t)=>repeats(t,n));if(hand.length!==targetSize)continue;
      const {needed,missing,probability}=details(s);
      const prior=best.get(catalog[id]);
      if(prior&&(prior.odds.probability>probability||prior.odds.probability===probability&&prior.missing<=missing))break;
      const last=needed.length?needed.map(n=>n.tile):[...new Set(hand)];
      const copies=[...s.c],keep=v.hand.filter(t=>copies[t]-->0);
      let hit=false;
      for(const winTile of last){
        const k=s.c.join("")+":"+winTile;
        let w=checked.get(k);
        if(!w){w={ron:score(hand,winTile,false),self:score(hand,winTile,true)};checked.set(k,w);}
        const verified=[w.ron,w.self].filter(x=>x.legal).flatMap(x=>x.items.map(f=>f.name));
        for(const name of new Set(verified)){
          if(!catalog.includes(name)||Object.hasOwn(ruleNotes,catalog.indexOf(name)))continue;
          const r={name,missing,needed,keep,example:hand,core:hand,winTile,...w,odds:{draws,probability}};
          const old=best.get(name);
          if(!old||probability>old.odds.probability||probability===old.odds.probability&&missing<old.missing)best.set(name,r);
        }
        if(verified.includes(catalog[id])){hit=true;break;}
      }
      if(hit)break;
    }
  }
  return [...best.values()];
}
