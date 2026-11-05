import { useEffect, useState } from "react";
import { Tile } from "./Tile";

export function reconcileOrder(order: readonly number[], tiles: readonly number[]) {
  const remaining = [...tiles], result: number[] = [];
  for (const t of order) { const at = remaining.indexOf(t); if (at >= 0) { result.push(t); remaining.splice(at, 1); } }
  return [...result, ...remaining];
}
export function orderedCards(hand: readonly number[], drawIndex: number, order: readonly number[]) {
  const pool = hand.flatMap((tile, index) => index === drawIndex ? [] : [{ tile, index }]);
  return reconcileOrder(order, pool.map(c => c.tile)).map(t => pool.splice(pool.findIndex(c => c.tile === t), 1)[0]);
}
const KEY = "quiet-mahjong-hand-order";
function savedOrder(stream: string): number[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return v?.stream === stream && Array.isArray(v.order) && v.order.every((t: unknown) => Number.isInteger(t) && Number(t) >= 0 && Number(t) < 34) ? v.order : []; }
  catch { return []; }
}
export function HandRow({ hand, stream, drawIndex, drawId, selected, suggested, canPick, dim, hidden, onPick, onSelect, onOrderChange, onIntegrate, canIntegrate, editable, replay }: {
  hand: number[]; stream: string; drawIndex: number; drawId: number;
  selected: number[]; suggested?: number; canPick: (index: number) => boolean;
  dim: (index: number) => boolean; hidden: (index: number) => boolean;
  onPick: (index: number) => void; onSelect: (index: number) => void; onIntegrate: () => void; editable: boolean; replay: boolean;
  canIntegrate: boolean;
  onOrderChange: (indices: number[]) => void;
}) {
  const [layout, setLayout] = useState(() => ({ stream, order: savedOrder(stream) }));
  const [manual, setManual] = useState(false);
  const cards = orderedCards(hand, drawIndex, layout.stream === stream ? layout.order : savedOrder(stream));
  const values = cards.map(c => c.tile), orderKey = values.join(",");
  const visualIndices = [...cards.map(c=>c.index),...(drawIndex>=0?[drawIndex]:[])];
  useEffect(() => { onOrderChange(visualIndices); }, [stream, visualIndices.join(",")]);
  useEffect(() => {
    setLayout({ stream, order: values });
    if (!replay) try { localStorage.setItem(KEY, JSON.stringify({ stream, order: values })); } catch { /* Ordering is optional. */ }
  }, [stream, orderKey, replay]);
  function move(from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || !editable || from === to || from < 0 || to < 0 || from >= cards.length || to >= cards.length) return;
    const next = [...values]; next.splice(to, 0, next.splice(from, 1)[0]); setLayout({ stream, order: next });
  }
  const selectedAt = selected.length === 1 ? cards.findIndex(c => c.index === selected[0]) : -1;
  const tile = (index: number, drawn = false) => <Tile tile={hand[index]} hidden={hidden(index)} selected={!replay && selected.includes(index)}
    suggested={!replay && suggested === hand[index]} dim={!manual && dim(index)} disabled={!(canPick(index) || manual && editable) || replay}
    onClick={() => manual && editable ? onSelect(index) : onPick(index)} drawn={drawn} />;
  return <>
    <div className="hand-tools">
      <button aria-pressed={manual} disabled={!editable} onClick={() => setManual(v => !v)}>手动理牌{manual ? " · 开" : ""}</button>
      <button disabled={!editable} onClick={() => setLayout({ stream, order: [...values].sort((a,b) => a-b) })}>自动排序</button>
      {manual && <>
        <button aria-label="选中的手牌左移" disabled={!editable || selectedAt <= 0} onClick={() => move(selectedAt, selectedAt-1)}>左移</button>
        <button aria-label="选中的手牌右移" disabled={!editable || selectedAt < 0 || selectedAt >= cards.length-1} onClick={() => move(selectedAt, selectedAt+1)}>右移</button>
        <span>拖动手牌；手机点选后用左移／右移</span>
      </>}
      {drawIndex >= 0 && <button className="integrate-draw" disabled={!editable || !canIntegrate} onClick={onIntegrate}>新摸牌归入手牌</button>}
    </div>
    <div className="human-hand">
      <div className="hand-held">
        {cards.map((c, position) => <div className="hand-card" key={c.index} draggable={manual && editable}
          onDragStart={e => { e.dataTransfer.setData("application/x-mahjong-hand", `${stream}:${position}`); e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={e => { if (manual && editable) e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); const data = e.dataTransfer.getData("application/x-mahjong-hand"), prefix = stream+":";
            if (manual && data.startsWith(prefix)) move(Number(data.slice(prefix.length)), position); }}>
          {tile(c.index)}
        </div>)}
      </div>
      {drawIndex >= 0 && <div className={`drawn-zone ${replay ? "" : "fresh-draw"}`} key={`${stream}:${drawId}`}>
        <span className="drawn-label">新摸牌</span>{tile(drawIndex, true)}
      </div>}
    </div>
  </>;
}
