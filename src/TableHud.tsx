import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tileName } from "./engine/core";
import { compareCalls } from "./engine/call-impact";
import type { ActionAdvice, AssistantReport } from "./engine/assistant";
import type { Advice } from "./engine/ai";
import { allowedDiscards, hasSeparateDraw } from "./engine/game";
import type { Action, Game, PublicView, PlayStyle } from "./engine/types";
import type { RoomCommand } from "./online/protocol";

export type AutoPrefs = { discard: boolean; pass: boolean; win: boolean };
export const autoOff: AutoPrefs = {discard:false,pass:false,win:false};
export function automaticCommand(game: Game, turn: boolean, own: Action[], claims: Action[], prefs: AutoPrefs): RoomCommand | null {
  const win = (turn ? own : claims).find(a => a.type === "win");
  if (win) return prefs.win ? {type:turn ? "act" : "claim",action:win} : null;
  if (!turn) return prefs.pass && claims.length && claims.every(a => ["chow","pung","kong","pass"].includes(a.type))
    ? {type:"claim",action:{type:"pass"}} : null;
  const tile=game.drawnTile;
  return prefs.discard && tile !== null && hasSeparateDraw(game,0) && allowedDiscards(game,0).includes(tile)
    ? {type:"discard",tile,fromDraw:true} : null;
}
export function AutoControls({value,change}:{value:AutoPrefs;change:(prefs:AutoPrefs)=>void}) {
  return <div className="auto-controls" role="group" aria-label="自动托管">
    <span>自动</span>
    {([["discard","摸切","只打出尚未归入手牌的合法摸牌；有胡牌机会时暂停"],["pass","跳过吃碰杠","自动过掉仅有吃碰杠的响应，保留胡牌"],["win","胡牌","有合法的胡牌机会时自动胡牌"]] as const).map(([key,label,tip])=>
      <button key={key} type="button" aria-pressed={value[key]} title={tip} onClick={()=>change({...value,[key]:!value[key]})}>{label}</button>)}
  </div>;
}
export function TableTip({label,children}:{label:ReactNode;children:ReactNode|((close:()=>void)=>ReactNode)}) {
  const [mode,setMode]=useState<"preview"|"pinned"|null>(null);
  const open=mode!==null,id=useId(),leave=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep=()=>clearTimeout(leave.current);
  const release=()=>{keep();leave.current=setTimeout(()=>setMode(v=>v==="preview"?null:v),180);};
  useEffect(()=>()=>clearTimeout(leave.current),[]);
  const anchor=useRef<HTMLButtonElement>(null), box=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!open)return;
    const position=()=>{
      if(!anchor.current||!box.current)return;
      const a=anchor.current.getBoundingClientRect(), b=box.current;
      b.style.left=Math.max(8,Math.min(a.left,innerWidth-b.offsetWidth-8))+"px";
      const h=b.offsetHeight, above=a.top-h-8;
      b.style.top=Math.max(8,Math.min(above>=8?above:a.bottom+8,innerHeight-h-8))+"px";
    };
    position();
    const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(position);
    if(box.current)observer?.observe(box.current);
    window.addEventListener("scroll",position,true);window.addEventListener("resize",position);
    return ()=>{observer?.disconnect();window.removeEventListener("scroll",position,true);window.removeEventListener("resize",position);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{
      const t=e.target as Node;
      if(!anchor.current?.contains(t)&&!box.current?.contains(t))setMode(null);
    };
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.stopPropagation();setMode(null);anchor.current?.focus();}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape,true);
    return ()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape,true);};
  },[open]);
  return <>
    <button type="button" ref={anchor} className="tip-trigger" aria-expanded={open} aria-controls={open?id:undefined}
      onPointerEnter={e=>{if(e.pointerType==="mouse"){keep();setMode(v=>v??"preview");}}} onPointerLeave={release}
      onClick={()=>{keep();setMode(v=>v==="pinned"?null:"pinned");}}>{label}</button>
    {open&&createPortal(<div className="table-tip" id={id} ref={box} onPointerEnter={keep} onPointerLeave={release}>{typeof children==="function"?children(()=>setMode(null)):children}</div>,document.body)}
  </>;
}
export function TableSheet({close,children}:{close:()=>void;children:ReactNode}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const d=dialog.current!;
    if(typeof d.showModal==="function")d.showModal();
    else d.setAttribute("open","");
    return ()=>{if(typeof d.close==="function")d.close();else d.removeAttribute("open");};
  },[]);
  return <dialog className="table-sheet" ref={dialog} aria-label="助手、牌谱与规则" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <div className="sheet-inner"><button type="button" className="sheet-close" onClick={close}>关闭</button>{children}</div>
  </dialog>;
}

type Useful = {tile:number;left:number};
export function HandTips({report,advice,waiting,details}:{
  report:AssistantReport|null;advice?:Advice;waiting?:{shanten:number;useful:Useful[]}|null;details:()=>void;
}) {
  const waits=report?.waits??[], ready=waits.length>0;
  const useful=ready?waits:advice?.useful??waiting?.useful??[];
  const basis=ready?report?.basisDiscard:advice?.tile;
  return <div className="hand-tips" aria-label="牌局提示">
    <TableTip label="做牌方向">{close=><>
      <strong>做牌方向</strong>
      {report?.routes.length?report.routes.slice(0,2).map(r=>{
        const odds=(r as typeof r & {odds?:{draws:number;probability:number}}).odds;
        return <div className="tip-route" key={r.name}><b>{r.name}</b><span>样例还需 {r.missing} 张</span>
          {odds&&<small>{odds.draws}摸内补齐约 {odds.probability>0&&odds.probability<.001?"<0.1%":(odds.probability*100).toFixed(1)+"%"}</small>}</div>;
      }):<p>当前没有可展示的路线。</p>}
      <button type="button" onClick={()=>{close();details();}}>完整分析</button>
    </>}</TableTip>
  </div>;
}
export function ActionTip({actions,view,style,routes}:{actions:ActionAdvice[];view:PublicView|null;style:PlayStyle;routes?:AssistantReport["routes"]}) {
  const result=useMemo(()=>view?compareCalls(view,actions,style,routes):null,[view,actions,style,routes]);
  const best=result?.best??actions.find(a=>a.recommended);
  if(!best)return null;
  const label=(a:ActionAdvice)=>a.label+(a.action.tiles?" "+a.action.tiles.map(tileName).join("、"):a.action.tile!==undefined?" "+tileName(a.action.tile):"");
  const detail=(a:ActionAdvice)=>{
    const impact=result?.comparisons.get(a);
    return <>{impact&&<><strong className={impact.worse?"call-caution":""}>{impact.headline}</strong>{impact.details.map((r,i)=><p key={i}>{r}</p>)}</>}
      {a.reasons.filter(r=>r!==result?.before&&r!==impact?.headline&&!impact?.details.includes(r)).map((r,i)=><p key={i} className="tip-foot">{r}</p>)}</>;
  };
  return <TableTip label={"建议："+label(best)}>
    <strong>建议：{label(best)}</strong>
    {result?.before&&<p className="call-before">{result.before}</p>}
    {detail(best)}
    {actions.filter(a=>a!==best).map((a,i)=><details key={i} open={actions.length<=4&&!!result?.comparisons.has(a)}><summary>{label(a)}</summary>{detail(a)}</details>)}
  </TableTip>;
}
