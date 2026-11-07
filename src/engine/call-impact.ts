import { evaluate, suit, tileName } from "./core";
import { afterAction, discardBasis, directionRoutes, winningWaits, type ActionAdvice, type RouteAdvice, type WaitAdvice } from "./assistant";
import type { PlayStyle, PublicView } from "./types";

const active = (w: WaitAdvice) => w.left > 0 && (w.ron.legal || w.self.legal);
const total = (waits: WaitAdvice[]) => waits.filter(active).reduce((n,w)=>n+w.left,0);
const name = (r?: RouteAdvice) => r?.name.replace(/^现有听牌 · /,"") ?? "暂无明确达标路线";
const clean = (r: RouteAdvice) => /门前清|不求人/.test(name(r));
const locked = (r: RouteAdvice, v: PublicView): string | undefined => {
  const open = v.melds.filter(m=>!m.concealed), label = name(r);
  if (/十三幺|全不靠|七星不靠|七对|连七对/.test(label) && v.melds.length) return "这个牌型不能有已固定的吃、碰或杠";
  if (/碰碰[和胡]/.test(label) && v.melds.some(m=>m.kind==="chow")) return "顺子副露与碰碰和需要的刻子或杠冲突";
  if ((clean(r) || /四暗刻/.test(label)) && open.length) return "副露破坏了原牌型的门清或全暗刻条件";
  if (/一色/.test(label) && !/双龙|同顺|步高|同刻/.test(label)) {
    const color=[...r.core,...r.example].find(t=>t>=0&&t<27);
    if (color!==undefined && v.melds.some(m=>m.tiles.some(t=>t<27?suit(t)!==suit(color):/清一色/.test(label))))
      return "固定牌组与原来的花色路线冲突";
  }
};
const same = (a: RouteAdvice,b: RouteAdvice) => name(a)===name(b) &&
  (!/清一色|混一色/.test(name(a)) || suit([...a.core,...a.example].find(t=>t<27)??27)===suit([...b.core,...b.example].find(t=>t<27)??27));
const odds = (r: RouteAdvice) => (r as RouteAdvice & {odds?:{draws:number;probability:number}}).odds;
function trend(a: RouteAdvice,b: RouteAdvice) {
  const x=odds(a),y=odds(b);
  if(x && y && x.draws===y.draws && Number.isFinite(x.probability) && Number.isFinite(y.probability)) {
    const p=(n:number)=>n>0&&n<.001?"<0.1%":(100*n).toFixed(1)+"%";
    return `${y.probability>x.probability?"更容易补齐":y.probability<x.probability?"更难补齐":"补齐机会接近"}；${x.draws}摸内补齐约 ${p(x.probability)} → ${p(y.probability)}`;
  }
  return `${b.missing<a.missing?"示例距离缩短":b.missing>a.missing?"示例距离变远":"示例距离不变"}；还缺 ${a.missing} → ${b.missing} 张（距离不等于胡牌概率）`;
}
export function compareCalls(v: PublicView, actions: ActionAdvice[], style: PlayStyle, shownRoutes?: RouteAdvice[]) {
  const calls=actions.filter(a=>!["pass","win"].includes(a.action.type));
  const original=actions.find(a=>a.recommended);
  if (!calls.length) return {best:original,before:"",comparisons:new Map<ActionAdvice,{headline:string;details:string[];worse:boolean}>()};
  const base=discardBasis(v,style), baseWaits=winningWaits(base.v), current=shownRoutes?.[0]??directionRoutes(base.v)[0];
  const beforeShanten=evaluate(base.v.hand,base.v.melds,v.config.mode==="mcr").shanten;
  const describe=(w:WaitAdvice)=>`${tileName(w.tile)}（${w.left}张未见）`;
  const comparisons=new Map(calls.map(item=>{
    const a=item.action, moved=afterAction(v,a), next=discardBasis(moved,style);
    const isKong=/kong$/i.test(a.type), nextWaits=winningWaits(next.v), routes=directionRoutes(next.v);
    const nextShanten=evaluate(next.v.hand,next.v.melds,v.config.mode==="mcr").shanten;
    const obstacle=current&&locked(current,next.v);
    const retained=current&&!obstacle?routes.find(r=>same(current,r)):undefined;
    const target=retained??routes[0], beforeLeft=total(baseWaits), afterLeft=total(nextWaits);
    const prefix=isKong?"补牌前":next.discard!==undefined?`若打${tileName(next.discard)}`:"操作后";
    const headline=`${prefix}：${obstacle?"需换方向 → ":""}${name(target)}`;
    const details:string[]=[];
    if(obstacle)details.push(`原方向「${name(current)}」不可继续：${obstacle}。`);
    else if(current && !retained)details.push(`这次未找到「${name(current)}」的达标示例；${target?`可改看「${name(target)}」`:"暂时没有明确的替代路线"}。`);
    if(current && retained)details.push(`可继续「${name(current)}」；${trend(current,retained)}。`);
    else if(target)details.push(`「${name(target)}」示例还缺 ${target.missing} 张。`);
    const lost=baseWaits.filter(active).flatMap(w=>{
      const n=nextWaits.find(x=>x.tile===w.tile);
      const methods=[w.ron.legal&&!n?.ron.legal?"点和":"",w.self.legal&&!n?.self.legal?"自摸":""].filter(Boolean).join("／");
      if(!n)return [`${tileName(w.tile)}不再成牌`];
      if(!n.left)return [`${tileName(w.tile)}已无未见张`];
      return methods?[`${tileName(w.tile)}${methods}不达标`]:[];
    });
    if(lost.length)details.push(`原等待受影响：${lost.join("、")}。`);
    if(beforeLeft || afterLeft)details.push(`可胡未见张：${beforeLeft} → ${afterLeft}。${afterLeft?" 现在等 "+nextWaits.filter(active).map(describe).join("、")+"。":""}`);
    else if(nextShanten===0)details.push("结构听牌，但没有仍有未见张且能按当前规则胡的常规等待。");
    else details.push(`向听：${beforeShanten} → ${nextShanten}。`);
    if(isKong)details.push("补牌及其后的出牌会改变结果，未把未知补牌或事件番算进去。");
    const worse=beforeLeft>afterLeft || (!!obstacle && afterLeft<=beforeLeft && nextShanten>=beforeShanten);
    return [item,{headline,details,worse}] as const;
  }));
  const pass=actions.find(a=>a.action.type==="pass");
  const best=original&&comparisons.get(original)?.worse ? actions.find(a=>comparisons.has(a)&&!comparisons.get(a)!.worse&&(a.afterShanten??99)<beforeShanten)??pass??original : original;
  const before=`现在：${base.discard!==undefined?`若打${tileName(base.discard)}，`:""}${name(current)}${current?`（示例还缺 ${current.missing} 张）`:""}`;
  return {best,before,comparisons};
}
export function explainCalls(v:PublicView,actions:ActionAdvice[],style:PlayStyle):ActionAdvice[] {
  if(!actions.some(a=>!["win","pass"].includes(a.action.type)))return actions;
  const result=compareCalls(v,actions,style);
  return actions.map(a=>{
    const impact=result.comparisons.get(a);
    return {...a,recommended:a===result.best,reasons:[result.before,...(impact?[impact.headline,...impact.details]:[]),...a.reasons]};
  });
}
