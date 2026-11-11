import { counts, evaluate } from "./core";
import { knownCounts } from "./ai";
import type { RouteAdvice } from "./assistant";
import type { PublicView, WinScore } from "./types";

export type RouteOdds={draws:number;probability:number};
export type PlannedRoute=RouteAdvice & {odds:RouteOdds};
type Score=(hand:number[],tile:number,self:boolean)=>WinScore;
function choose(n:number,k:number) {
  if(k<0||k>n)return 0;
  let r=1;
  for(let i=1;i<=Math.min(k,n-k);i++)r=r*(n-i+1)/i;
  return r;
}
// Probability of collecting the missing tiles of one concrete target.
export function completionProbability(pool:number,needs:{count:number;left:number}[],draws:number) {
  if(!Number.isInteger(pool)||pool<0)return 0;
  const h=Math.min(pool,Math.max(0,draws));
  if(needs.some(n=>n.count>n.left)||needs.reduce((n,x)=>n+x.count,0)>h)return 0;
  if(!needs.length)return 1;
  let ways=Array(h+1).fill(0);ways[0]=1;
  for(const need of needs){
    const next=Array(h+1).fill(0);
    for(let taken=0;taken<=h;taken++)if(ways[taken])
      for(let k=need.count;k<=Math.min(need.left,h-taken);k++)
        next[taken+k]+=ways[taken]*choose(need.left,k);
    ways=next;
  }
  const other=pool-needs.reduce((n,x)=>n+x.left,0),denominator=choose(pool,h);
  if(other<0||!denominator)return 0;
  return Math.max(0,Math.min(1,ways.reduce((n,w,k)=>n+w*choose(other,h-k),0)/denominator));
}
export function scoreFormula(score:WinScore) {
  return score.items.map(f=>f.name+" "+f.value*f.count).join("＋")+"＝"+score.fan+"分";
}
export function routeScore(r:RouteAdvice){
  return [r.ron,r.self].find(s=>s.legal&&s.items.some(f=>f.name===r.name))??(r.ron.legal?r.ron:r.self);
}
export function routeEstimate(route:RouteAdvice) {
  const odds=(route as RouteAdvice & {odds?:RouteOdds}).odds;
  if(!odds)return "";
  const p=odds.probability>0&&odds.probability<.001?"<0.1%":(odds.probability*100).toFixed(1)+"%";
  return "未来"+odds.draws+"次自摸补齐此示例缺牌："+p+"（模型估计，非整体胡牌率）";
}
export function enhanceRoutes(v:PublicView,existing:RouteAdvice[],score:Score,all=false):RouteAdvice[] {
  if(v.config.mode!=="mcr"||!v.config.scoring)return existing;
  const owned=counts(v.hand),fixed=counts(v.melds.flatMap(m=>m.tiles)),known=knownCounts(v);
  const left=known.map(n=>Math.max(0,4-n)),pool=left.reduce((a,b)=>a+b,0);
  const active=v.players.filter(p=>!p.won).length;
  const draws=Math.min(8,Math.ceil(v.remaining/Math.max(1,active)));
  const odds=(r:RouteAdvice):PlannedRoute=>({...r,odds:(r as Partial<PlannedRoute>).odds??{draws,probability:completionProbability(pool,r.needed,draws)}});
  const legal=(s:WinScore)=>s.legal&&s.items.length>0;
  const routes:RouteAdvice[]=[...existing];
  const groups=[
    ...Array.from({length:34},(_,t)=>[t,t,t]),
    ...Array.from({length:3},(_,s)=>Array.from({length:7},(_,n)=>[
      s*9+n,s*9+n+1,s*9+n+2
    ])).flat()
  ];
  type State={
    c:number[];missing:number;scarcity:number;
    pungs:number;mask:number;honors:number
  };
  let beam:State[]=[];
  const maxMissing=Math.min(7,Math.max(3,evaluate(v.hand,v.melds,true).shanten+2));
  for(let pair=0;pair<34;pair++){
    const missing=Math.max(0,2-owned[pair]);
    if(fixed[pair]+2>4||missing>left[pair])continue;
    const c=Array(34).fill(0);c[pair]=2;
    beam.push({
      c,missing,scarcity:missing/Math.max(1,left[pair]),pungs:0,
      mask:pair<27?1<<Math.floor(pair/9):0,honors:Number(pair>=27)
    });
  }
  const cost=(a:State,b:State)=>a.missing-b.missing||a.scarcity-b.scarcity;
  for(let depth=0;depth<4-v.melds.length;depth++){
    const unique=new Map<string,State>();
    for(const state of beam)for(const group of groups){
      const c=[...state.c];
      let missing=state.missing,scarcity=state.scarcity,valid=true;
      for(const t of group){
        const was=Math.max(0,c[t]-owned[t]);c[t]++;
        const need=Math.max(0,c[t]-owned[t]);
        missing+=need-was;scarcity+=(need-was)/Math.max(1,left[t]);
        if(c[t]+fixed[t]>4||need>left[t]||missing>maxMissing){
          valid=false;break;
        }
      }
      if(!valid)continue;
      const next={
        c,missing,scarcity,pungs:state.pungs+Number(group[0]===group[1]),
        mask:state.mask|(group[0]<27?1<<Math.floor(group[0]/9):0),
        honors:state.honors+Number(group[0]>=27)
      };
      const id=c.join(""),prior=unique.get(id);
      if(!prior||cost(next,prior)<0)unique.set(id,next);
    }
    const sorted=[...unique.values()].sort(cost),selected=sorted.slice(0,96);
    const ids=new Set(selected.map(s=>s.c.join("")));
    const buckets=new Map<string,number>();
    for(const s of sorted){
      if(selected.length>=160)break;
      const bucket=s.pungs+":"+s.mask+":"+s.honors;
      if((buckets.get(bucket)??0)>=3||ids.has(s.c.join("")))continue;
      buckets.set(bucket,(buckets.get(bucket)??0)+1);
      selected.push(s);ids.add(s.c.join(""));
    }
    beam=selected;
  }
  for(const state of beam){
    const target=state.c.flatMap((n,t)=>Array(n).fill(t));
    const needed=state.c.flatMap((n,t)=>n>owned[t]?[
      {tile:t,count:n-owned[t],left:left[t]}
    ]:[]);
    const wins=needed.length?needed.map(n=>n.tile):[...new Set(target)];
    let best:RouteAdvice|undefined;
    for(const winTile of wins){
      const ron=score(target,winTile,false),self=score(target,winTile,true);
      const bestScore=legal(ron)?ron:legal(self)?self:null;
      if(!bestScore||bestScore.items.some(f=>f.value>=8))continue;
      const c=[...state.c];
      const route:RouteAdvice={
        name:"小番组合 · "+(ron.legal?"点和":"自摸"),
        missing:state.missing,needed,
        keep:v.hand.filter(t=>c[t]>0?(c[t]--,true):false),
        example:target,core:target,ron,self,winTile
      };
      if(!best||Number(ron.legal)>Number(best.ron.legal)||
        ron.legal===best.ron.legal&&bestScore.fan>(
          best.ron.legal?best.ron.fan:best.self.fan
        ))best=route;
    }
    if(best)routes.push(best);
  }
  const namedValue=(r:RouteAdvice)=>routeScore(r).items.find(f=>r.name.includes(f.name))?.value??0;
  const ranked=routes.filter(r=>r.needed.every(n=>n.count<=left[n.tile]))
    .map(odds).sort((a,b)=>b.odds.probability-a.odds.probability||a.missing-b.missing||Number(b.ron.legal)-Number(a.ron.legal)||routeScore(b).fan-routeScore(a).fan||namedValue(b)-namedValue(a)||a.name.localeCompare(b.name));
  const byName=new Map<string,PlannedRoute>();
  for(const r of ranked)if(!byName.has(r.name))byName.set(r.name,r);
  if(all)return [...byName.values()];
  const result=[...byName.values()].slice(0,4);
  const combo=[...byName.values()].find(r=>r.name.startsWith("小番组合"));
  if(combo&&!result.some(r=>r.name===combo.name)){if(result.length===4)result.pop();result.push(combo);}
  return result;
}
