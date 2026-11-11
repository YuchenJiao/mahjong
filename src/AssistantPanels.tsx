import { tileName as mjFanCatalogTileName } from "./engine/core";
import { routeEstimate, scoreFormula } from "./engine/combination-routes";
import type { ActionAdvice, AssistantReport } from "./engine/assistant";
import type { Config, WinScore } from "./engine/types";
import { tileName } from "./engine/core";
import { Tile } from "./Tile";

const scoreText = (score: WinScore, config: Config) => config.scoring ? `${score.fan}${config.mode === "mcr" ? "分" : "番"}` : `${score.points}固定分`;
export function ActionHints({ actions, config }: { actions: ActionAdvice[]; config: Config }) {
  const best = actions.find(hint => hint.recommended);
  if (!best) return null;
  const target = best.action.tiles?.map(tileName).join("、") ?? (best.action.tile === undefined ? "" : tileName(best.action.tile));
  return <details className="action-hints" aria-label="吃碰杠胡建议">
    <summary><strong>建议：{best.label}{target && " " + target}</strong> · {best.reasons[0]} <small>展开比较</small></summary>
    <div className="action-hint-list">{actions.map((hint,i)=><article key={i} className={hint.recommended?"recommended-action":""}>
      <strong>{hint.recommended?"建议：":""}{hint.label}{hint.action.tiles?` ${hint.action.tiles.map(tileName).join("、")}`:""}
        {hint.score?` · ${scoreText(hint.score,config)}`:""}</strong>
      {hint.reasons.map((reason,k)=><p key={k}>{reason}</p>)}
      {hint.score&&<div className="fan-chips">{hint.score.items.map((fan,k)=><span key={k}>{fan.name} {fan.value*fan.count}{config.mode==="mcr"?"分":"番"}</span>)}</div>}
    </article>)}</div>
  </details>;
}
export function StrategyPanel({ report, config }: { report: AssistantReport; config: Config }) {
  return <section className="strategy-panel" aria-label="实时做牌方向">
    <h3>实时做牌方向</h3>
    <p className="threshold-note">{report.eightPointMinimum?"本局8分起胡：结构成牌之外，还须满足番型门槛。":config.scoring?config.mode==="mcr"?"本局未设置8分起胡门槛，保留实际算番。":"川麻按本局配置算番，胡牌须满足定缺等限制。":"本局固定分结算，优先稳定成牌。"}</p>
    <p>{report.basisDiscard!==undefined?`建议打${tileName(report.basisDiscard)}后，`:"当前"}{report.shanten===0?"结构听牌":`${report.shanten}向听`}。</p>
    {report.waits.length>0&&<div className="wait-table">
      <h4>{report.eightPointMinimum?"常规等待与8分门槛":"常规等待与分数"}</h4>
      <div className="wait-row wait-heading"><span>等待</span><span>未见</span><span>点和</span><span>自摸</span></div>
      {report.waits.map(w=><div className="wait-row" key={w.tile}><span><Tile tile={w.tile} small /></span><span>约{w.left}张</span>
        <span className={w.ron.legal?"legal-score":"short-score"}>{scoreText(w.ron,config)}<small>{w.left===0?"已无余张":w.ron.legal?"达标":"未达标"}</small></span>
        <span className={w.self.legal?"legal-score":"short-score"}>{scoreText(w.self,config)}<small>{w.left===0?"已无余张":w.self.legal?"达标":"未达标"}</small></span></div>)}
    </div>}
    <p className="route-explanation">以下是完成后的示例牌型分数，尚未取得的牌和事件番不算作当前收益。</p>
    {report.routes.length?report.routes.map((route,i)=><article className="route-card" key={route.name}>
      <div className="route-heading"><strong>{i===0?"优先参考：":"备选："}{route.name}</strong><span>还需补入{route.missing}张</span></div>
      <p>点和示例 {scoreText(route.ron,config)}{route.ron.legal?"":"（未达门槛）"} · 自摸示例 {scoreText(route.self,config)}{route.self.legal?"":"（未达门槛）"}</p>
      {config.mode==="mcr"&&config.scoring&&<p className="route-formula">{route.ron.legal?"点和成牌示例：":"自摸成牌示例："}{scoreFormula(route.ron.legal?route.ron:route.self)}</p>}
      {routeEstimate(route)&&<p className="route-estimate">{routeEstimate(route)}</p>}
      <h4>适合保留</h4><div className="plan-tiles">{route.keep.map((t,k)=><Tile key={k} tile={t} small />)}</div>
      <h4>示例尚缺</h4><div className="needed-tiles">{route.needed.map(n=><span key={n.tile}>{tileName(n.tile)}×{n.count}<small>未见约{n.left}张</small></span>)}</div>
      <details><summary>查看成牌示例与番种</summary>
        <p>和牌张：{tileName(route.winTile)}；已副露的牌组继续保留。</p>
        <div className="plan-tiles">{route.example.map((t,k)=><Tile tile={t} key={k} small />)}</div>
        <p>点和：{route.ron.items.map(f=>`${f.name}${f.value*f.count}`).join("、")||"未成有效牌型"}</p>
        <p>自摸：{route.self.items.map(f=>`${f.name}${f.value*f.count}`).join("、")||"未成有效牌型"}</p>
      </details>
    </article>):<p>这轮未找到合适的常见示例路线，不代表无法胡牌；可结合向听、活张和实际等待调整。</p>}
    <p className="strategy-limits">{report.notes.join(" ")}</p>

    {report.fanCatalog&&<details className="fan-catalog"><summary>查看全部番种与成立条件</summary>
      <p>达标示例来自当前可见牌和计分器；未找到示例不代表这个番种无法做成。</p>
      <ul>{report.fanCatalog.map(f=><li key={f.name}><strong>{f.name} {f.value}分</strong> · {f.condition??(f.route?"达标示例还缺 "+f.missing+" 张："+(f.needed?.map(n=>mjFanCatalogTileName(n.tile)+"×"+n.count+"（未见"+n.left+"）").join("、")||"已齐"):"本次未找到达标示例")}</li>)}</ul>
    </details>}
</section>;
}
