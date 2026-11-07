import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointer } from "react";
import { createPortal } from "react-dom";
import { counts, tileName } from "./engine/core";
import { knownCounts, type Advice } from "./engine/ai";
import type { AssistantReport } from "./engine/assistant";
import type { PublicView } from "./engine/types";
import { TableTip } from "./TableHud";

export function tileFacts(view:PublicView,report:AssistantReport|null,advice?:Advice,waiting?:{useful:{tile:number;left:number}[]}|null) {
  const known=knownCounts(view), held=counts([...view.hand,...view.melds.flatMap(m=>m.tiles)]);
  const useful=advice?.useful??waiting?.useful??[];
  return Array.from({length:view.config.mode==="mcr"?34:27},(_,tile)=>{
    const wait=report?.waits.find(w=>w.tile===tile);
    const routes=report?.routes.flatMap((r,i)=>r.needed.some(n=>n.tile===tile)?[{name:r.name,priority:i}]:[])??[];
    const legal=!!wait&&(wait.ron.legal||wait.self.legal), progress=useful.some(u=>u.tile===tile);
    const left=Math.max(0,4-known[tile]);
    const missing=view.config.mode==="sichuan"&&Math.floor(tile/9)===view.voidSuit;
    const priority=missing||left===0?1000:legal?0:progress?10:routes.length?20+routes[0].priority:100;
    const tags=[missing?"定缺牌：不能用于胡牌":"",wait?legal?`可${wait.ron.legal?"点和":""}${wait.ron.legal&&wait.self.legal?"／":""}${wait.self.legal?"自摸":""}`:"结构等待，但当前计分未达起胡门槛":progress?"有效进张":""].filter(Boolean);
    const basis=report?.basisDiscard??advice?.tile;
    return {tile,left,known:known[tile],held:held[tile],priority,tags,routes,basis};
  }).sort((a,b)=>a.priority-b.priority||b.left-a.left||a.tile-b.tile);
}
type Fact=ReturnType<typeof tileFacts>[number];
function FactBody({fact}:{fact:Fact}) {
  return <>
    <strong>{tileName(fact.tile)} · {fact.left}张未见</strong>
    <p>你持有 {fact.held} 张 · 已知共 {fact.known} 张</p>
    {fact.tags.length>0&&<p>{fact.tags.join("；")}{fact.basis!==undefined?`（按打${tileName(fact.basis)}后）`:""}</p>}
    {fact.routes.length>0&&<p>方向所需：{fact.routes.map(r=>r.name).join("、")}</p>}
    <small>未见张可能在对手手里，并非牌墙保证剩余。</small>
  </>;
}
export function MissingTiles({facts}:{facts:Fact[]}) {
  const missing=facts.filter(f=>!f.held);
  return <TableTip label="未持有牌">
    <strong>未持有牌 · 按当前需要优先</strong>
    <p className="tip-foot">可胡 → 有效进张 → 当前方向缺牌 → 其他；绝张和定缺牌排后。</p>
    <ul className="missing-tiles">{missing.map(f=><li key={f.tile} className={f.left?"":"exhausted"}>
      <b>{tileName(f.tile)}</b><span>{f.left}张未见</span>
      <small>{f.tags.join("；")||f.routes.map(r=>r.name).join("、")||"其他牌"}</small>
    </li>)}</ul>
    {!missing.length&&<p>当前持有所有牌种。</p>}
    <p className="tip-foot">含手牌和自己固定牌组；已持有的牌直接悬停或长按牌面查看。</p>
  </TableTip>;
}
export function TileLens({facts,children,enabled=true}:{facts:Fact[];children:ReactNode;enabled?:boolean}) {
  const root=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null);
  const [target,setTarget]=useState<HTMLElement|null>(null);
  const hold=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),dismiss=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const origin=useRef<{x:number;y:number;tile:HTMLElement}|null>(null), consumed=useRef<HTMLElement|null>(null);
  const tileAt=(e:EventTarget|null)=> e instanceof Element?e.closest<HTMLElement>("[data-tile-face]"):null;
  const cancel=()=>{clearTimeout(hold.current);origin.current=null;};
  useEffect(()=>()=>{clearTimeout(hold.current);clearTimeout(dismiss.current);},[]);
  useEffect(()=>{
    if(!target)return;
    const close=()=>setTarget(null);
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close();};
    document.addEventListener("pointerdown",outside);window.addEventListener("scroll",close,true);window.addEventListener("resize",close);document.addEventListener("keydown",close);
    return ()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("scroll",close,true);window.removeEventListener("resize",close);document.removeEventListener("keydown",close);};
  },[target]);
  useLayoutEffect(()=>{
    if(!target||!panel.current)return;
    const p=panel.current,a=target.getBoundingClientRect();
    p.style.left=Math.max(8,Math.min(a.left,innerWidth-p.offsetWidth-8))+"px";
    p.style.top=Math.max(8,Math.min(a.top-p.offsetHeight-8>=8?a.top-p.offsetHeight-8:a.bottom+8,innerHeight-p.offsetHeight-8))+"px";
  });
  const down=(e:ReactPointer)=>{
    consumed.current=null;cancel();clearTimeout(dismiss.current);setTarget(null);
    const t=tileAt(e.target);if(!enabled||!t||e.pointerType==="mouse")return;
    origin.current={x:e.clientX,y:e.clientY,tile:t};
    hold.current=setTimeout(()=>{if(origin.current?.tile===t){consumed.current=t;setTarget(t);}},350);
  };
  const fact=enabled&&target?.isConnected?facts.find(f=>f.tile===Number(target.dataset.tileFace)):undefined;
  return <div className="table" ref={root}
    onPointerOver={e=>{if(enabled&&e.pointerType==="mouse")setTarget(tileAt(e.target));}}
    onPointerOut={e=>{if(e.pointerType==="mouse"&&tileAt(e.relatedTarget)!==target)setTarget(null);}}
    onPointerDownCapture={down}
    onPointerMoveCapture={e=>{const o=origin.current;if(o&&Math.hypot(e.clientX-o.x,e.clientY-o.y)>9){cancel();consumed.current=null;setTarget(null);}}}
    onPointerUpCapture={e=>{cancel();if(e.pointerType!=="mouse")dismiss.current=setTimeout(()=>setTarget(null),2200);}}
    onPointerCancelCapture={()=>{cancel();consumed.current=null;setTarget(null);}}
    onDragStartCapture={()=>{cancel();setTarget(null);}}
    onClickCapture={e=>{if(consumed.current&&consumed.current===tileAt(e.target)){e.preventDefault();e.stopPropagation();consumed.current=null;}}}
    onContextMenu={e=>{if(consumed.current){e.preventDefault();}}}
    onFocusCapture={e=>{const t=tileAt(e.target);if(enabled&&t?.matches(":focus-visible"))setTarget(t);}}
    onBlurCapture={()=>setTarget(null)}>
    {children}
    {fact&&createPortal(<div ref={panel} className="table-tip tile-face-tip" role="tooltip"><FactBody fact={fact}/></div>,document.body)}
  </div>;
}
