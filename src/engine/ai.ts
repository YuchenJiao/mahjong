import { evaluate, counts, suit, rank, rawScore } from "./core";
import type { PublicView, Tile, Action, AiDifficulty, PlayStyle, Meld } from "./types";
export type Advice = {
  tile: Tile; shanten: number; effectiveShanten: number; ukeire: number;
  useful: { tile: Tile; left: number }[]; risk: number; utility: number;
  offenseScore: number; defensePenalty: number; futureQuality: number;
  riskFactors: string[]; reason: string; target: string;
};
export type OpponentThreat = { player: number; readiness: number; value: number; flushSuit: number; triplet: boolean };
export type AdviceOptions = { difficulty?: AiDifficulty; style?: PlayStyle };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const valid = (t: number) => Number.isInteger(t) && t >= 0 && t < 34;
export function knownCounts(v: PublicView) {
  // Current rivers and melds represent physical tiles. Historical discards are evidence,
  // not additional copies: a claimed discard is already in its caller's meld.
  return counts([...v.hand, ...v.players.flatMap(p => [...p.river, ...p.melds.flatMap(m => m.tiles)]),
    ...(v.publicWinningTiles ?? [])].filter(valid)).map(n => Math.min(4, n));
}
export function opponentThreats(v: PublicView): OpponentThreat[] {
  return v.players.flatMap((p, i) => {
    if (i === v.self || p.won) return [];
    const history = p.discards ?? p.river, exposed = p.melds.filter(m => !m.concealed);
    const colors = exposed.flatMap(m => m.tiles).filter(t => valid(t) && t < 27);
    const colorCounts = [0,1,2].map(s => colors.filter(t => suit(t) === s).length);
    const dom = colorCounts.indexOf(Math.max(...colorCounts));
    const offColor = history.filter(t => t >= 27 || suit(t) !== dom).length / Math.max(1, history.length);
    const flushSuit = exposed.length >= 2 && colors.length >= 6 && colorCounts[dom] === colors.length && offColor >= .45 ? dom : -1;
    const triplet = exposed.length >= 2 && exposed.every(m => m.kind !== "chow");
    const recentMiddle = history.slice(-3).filter(t => t < 27 && rank(t) >= 3 && rank(t) <= 7).length;
    const readiness = p.melds.length === 4 && p.handCount <= 2 ? .97 : clamp(.1 + p.melds.length * .12 +
      Math.min(history.length, 20) * .011 + (history.length >= 6 ? recentMiddle * .025 : 0) +
      (v.remaining < 25 ? .1 : 0), .08, .9);
    let value = 1;
    if (v.config.scoring) { if (flushSuit >= 0) value *= 2; if (triplet) value *= 1.45; }
    return [{ player: i, readiness, value, flushSuit, triplet }];
  });
}
export function discardRisk(v: PublicView, t: Tile, known = knownCounts(v), threats = opponentThreats(v)) {
  const unseen = (x: number) => Math.max(0, 4 - (known[x] ?? 0));
  const globalDiscards = v.players.reduce((n,p) => n + (p.discards ?? p.river).filter(x => x === t).length, 0);
  const factors: string[] = [];
  if (globalDiscards) factors.push(`全桌已弃${globalDiscards}张同牌`);
  if (known[t] >= 3) factors.push(`已知${known[t]}张同牌，对倒／单吊机会降低`);
  let risk = 0;
  for (const threat of threats) {
    const p = v.players[threat.player], history = p.discards ?? p.river;
    if (v.config.mode === "sichuan" && suit(t) === p.voidSuit) continue;
    // Estimate concealed completion shapes without accessing the concealed hand.
    const pairPotential = unseen(t) / 4;
    let sequencePotential = 0;
    if (t < 27 && !threat.triplet && p.melds.length < 4) {
      for (let st = t - 2; st <= t; st++) {
        if (st < 0 || st % 9 > 6 || suit(st) !== suit(t)) continue;
        const neighbors = [st,st+1,st+2].filter(x => x !== t);
        sequencePotential += unseen(neighbors[0]) * unseen(neighbors[1]) / 16;
      }
    }
    let shape = p.melds.length === 4 ? pairPotential : .65 * pairPotential + .22 * sequencePotential;
    // Special MCR structures and changing waits prevent treating old discards/suji as absolute safety.
    if (v.config.mode === "mcr" && p.melds.length === 0) shape += .04;
    let evidence = 1;
    if (history.slice(-3).includes(t)) evidence *= .5;
    else if (history.includes(t)) evidence *= .72;
    evidence *= Math.max(.65, 1 - globalDiscards * .08);
    if (threat.flushSuit >= 0) {
      evidence *= t < 27 && suit(t) === threat.flushSuit ? 1.55 : .55;
      if (t < 27 && suit(t) === threat.flushSuit) factors.push(`${["", "下家", "对家", "上家"][(threat.player-v.self+4)%4]}副露与弃牌指向同花色`);
    }
    if (threat.readiness > .65) factors.push(`${["", "下家", "对家", "上家"][(threat.player-v.self+4)%4]}较可能听牌`);
    risk += shape * evidence * threat.readiness * threat.value * 3;
  }
  return { risk, factors: [...new Set(factors)] };
}
function danger(v: PublicView, t: Tile) { return discardRisk(v, t).risk; }
function targets(v: PublicView, h: Tile[]) {
  const all = [...h, ...v.melds.flatMap((m) => m.tiles)];
  const c = counts(h),
    suits = [0, 1, 2].map((s) => all.filter((t) => suit(t) === s).length);
  const max = Math.max(...suits);
  const dom = suits.indexOf(max);
  const pairs = c.filter((n) => n >= 2).length;
  const triplets =
    c.filter((n) => n >= 3).length +
    v.melds.filter((m) => m.kind !== "chow").length;
  let bonus = 0,
    name = "保持进张";
  if (v.config.scoring) {
    if (v.config.mode === "sichuan") {
      if (max >= 9 && !v.melds.some((m) => suit(m.tiles[0]) !== dom)) {
        bonus += (max - 8) * 0.55;
        name = "清一色潜力";
      }
      if (!v.melds.length && pairs >= 4) {
        bonus += pairs * 0.25;
        name = "七对潜力";
      }
      if (!v.melds.some((m) => m.kind === "chow") && triplets >= 2) {
        bonus += triplets * 0.35;
        name = "对对胡潜力";
      }
    } else {
      // MCR rewards 8-point paths: concealed play, pure straight and mixed triple chow.
      if (!v.melds.some((m) => !m.concealed)) bonus += 1.3;
        for (let n = 0; n < 7; n++) {
          let filled = 0;
          for (let s = 0; s < 3; s++)
            for (let k = 0; k < 3; k++) if (c[s * 9 + n + k]) filled++;
          if (filled >= 6) {
            bonus = Math.max(bonus, filled * 0.28);
            name = "三色三同顺潜力";
          }
        }
      for (let s = 0; s < 3; s++)
        if (c.slice(s * 9, s * 9 + 9).filter((n) => n > 0).length >= 7) {
          bonus = Math.max(bonus, 1.8);
          name = "清龙潜力";
        }
      if (max >= 9) {
        bonus += 0.7;
        name = "同色做牌";
      }
    }
  }
  return { bonus, name };
}

function usefulTiles(v: PublicView, h: Tile[], melds: Meld[], known: number[], e: ReturnType<typeof evaluate>) {
  const concealed = counts(h);
  return e.useful.filter(t => valid(t) && t < (v.config.mode === "mcr" ? 34 : 27) &&
    (v.config.mode !== "sichuan" || suit(t) !== v.voidSuit))
    .filter(t => !(e.shanten === 0 && v.config.mode === "mcr" && v.config.scoring && v.config.mcrEightPointMinimum !== false) ||
      rawScore(h, melds, t, 1 | (known[t] - concealed[t] >= 3 ? 2 : 0), v.seat, v.wind).total >= 8)
    .map(tile => ({ tile, left: Math.max(0, 4 - known[tile]) }));
}
function followup(v: PublicView, h: Tile[], known: number[], draws: Advice["useful"]) {
  let total = 0, weights = 0;
  for (const draw of [...draws].filter(d => d.left > 0).sort((a,b) => b.left-a.left).slice(0,3)) {
    const hand = [...h, draw.tile], nextKnown = [...known]; nextKnown[draw.tile]++;
    let bestShanten = 99, bestUkeire = 0;
    for (const discard of new Set(hand)) {
      const next = [...hand]; next.splice(next.indexOf(discard),1);
      const e = evaluate(next,v.melds,v.config.mode === "mcr");
      const count = usefulTiles(v,next,v.melds,nextKnown,e).reduce((n,t) => n+t.left,0);
      if (e.shanten < bestShanten || e.shanten === bestShanten && count > bestUkeire) { bestShanten=e.shanten;bestUkeire=count; }
    }
    total += bestUkeire * draw.left; weights += draw.left;
  }
  return weights ? total / weights : 0;
}
const cache = new Map<string, Advice[]>();
export function advise(v: PublicView, options: AdviceOptions = {}): Advice[] {
  const difficulty = options.difficulty ?? v.config.aiDifficulty ?? "advanced", style = options.style ?? "balanced";
  const key = JSON.stringify([v,difficulty,style]), old = cache.get(key);
  if (old) return structuredClone(old);
  const known = knownCounts(v), threats = opponentThreats(v);
  const forced = v.config.mode === "sichuan" ? v.hand.filter(t => suit(t) === v.voidSuit) : [];
  const candidates = [...new Set(forced.length ? forced : v.hand)], results: Advice[] = [];
  const threat = Math.max(0,...threats.map(t => t.readiness * t.value));
  for (const tile of candidates) {
    const h = [...v.hand]; h.splice(h.indexOf(tile),1);
    const e = evaluate(h,v.melds,v.config.mode === "mcr");
    const useful = usefulTiles(v,h,v.melds,known,e), ukeire = useful.reduce((n,t) => n+t.left,0);
    const effectiveShanten = e.shanten === 0 && !ukeire ? 1 : e.shanten;
    const { risk, factors } = discardRisk(v,tile,known,threats);
    const target = difficulty === "easy" ? { bonus: 0, name: "优先成牌" } : targets(v,h);
    const late = v.remaining < 25;
    const baseDefense = style === "attack" ? .12 : style === "defense" ? 2.5 :
      e.shanten <= 0 ? .25 : e.shanten === 1 ? .4 : late ? 1.2 : .6;
    const defensePenalty = difficulty === "easy" ? 0 : risk * baseDefense * (difficulty === "normal" ? .6 : 1) * Math.max(.5, threat);
    const offenseScore = -effectiveShanten * 24 + ukeire * .8 + target.bonus;
    results.push({ tile,shanten:e.shanten,effectiveShanten,ukeire,useful,risk,offenseScore,defensePenalty,
      futureQuality:0,utility:offenseScore-defensePenalty,target:target.name,riskFactors:factors,reason:"" });
  }
  const minimum = Math.min(...results.map(r => r.effectiveShanten));
  // Attack and ordinary balanced play never trade an extra shanten for a small risk reduction.
  const canFold = difficulty !== "easy" && (style === "defense" && threat >= .65 || style === "balanced" && threat > 1.1 && v.remaining < 20 && minimum >= 2);
  if (!canFold) results.forEach(r => { if (r.effectiveShanten > minimum) r.utility -= 1000; });
  if (difficulty === "advanced") {
    const finalists = [...results].filter(r => r.effectiveShanten === minimum).sort((a,b) => b.offenseScore-a.offenseScore).slice(0,3);
    for (const r of finalists) {
      const h=[...v.hand];h.splice(h.indexOf(r.tile),1);
      r.futureQuality=followup(v,h,known,r.useful);
      r.utility += r.futureQuality * .07;
    }
  }
  for (const r of results) r.reason = forced.length ? "定缺要求优先打出缺门牌" :
    `${r.shanten === 0 ? "保持结构听牌" : `${r.shanten}向听`}；约${r.ukeire}张可用进张；${r.target}；` +
    `${style === "attack" ? "偏进攻" : style === "defense" ? "偏防守" : "攻守平衡"}，防守扣分${r.defensePenalty.toFixed(1)}` +
    (r.riskFactors.length ? `；${r.riskFactors.join("、")}` : "") +
    (r.shanten === 0 && r.effectiveShanten > 0 ? v.config.mode === "mcr" && v.config.scoring && v.config.mcrEightPointMinimum !== false
      ? "；目前无剩余且满足8分的常规自摸进张" : "；听牌张已无剩余可用牌" : "");
  results.sort((a,b) => b.utility-a.utility || a.risk-b.risk || a.tile-b.tile);
  if (cache.size >= 256) cache.clear();cache.set(key,structuredClone(results));
  return results;
}
export function chooseResponse(v: PublicView, actions: Action[]): Action {
  const win = actions.find((a) => a.type === "win");
  if (win) return win;
  let best: Action = { type: "pass" },
    bestGain = 0;
  // Passing keeps the current thirteen-tile shape.
  const base = evaluate(v.hand, v.melds, v.config.mode === "mcr");
  for (const a of actions) {
    if (!["pung", "kong", "chow"].includes(a.type)) continue;
    const ts =
      a.type === "chow"
        ? a.tiles!
        : [a.tile!, a.tile!, a.tile!, ...(a.type === "kong" ? [a.tile!] : [])];
    const remove = [...ts];
    remove.splice(remove.indexOf(a.tile!), 1);
    const h = [...v.hand];
    for (const t of remove) h.splice(h.indexOf(t), 1);
    const melds = [
      ...v.melds,
      {
        kind:
          a.type === "chow"
            ? ("chow" as const)
            : a.type === "kong"
              ? ("kong" as const)
              : ("pung" as const),
        tiles: ts,
        from: -1,
        concealed: false,
      },
    ];
    const e =
      a.type === "kong"
        ? evaluate(h, melds, v.config.mode === "mcr")
        : advise({
            ...v,
            hand: h,
            melds,
            players: v.players.map((p, i) =>
              i === v.self ? { ...p, melds } : i === v.lastDiscard?.from && p.river.at(-1) === v.lastDiscard.tile
                ? { ...p, river: p.river.slice(0,-1) } : p,
            ),
          })[0];
    let gain = (base.shanten - e.shanten) * 15;
    if (v.config.mode === "mcr" && v.config.scoring) {
      gain -=
        v.melds.some((m) => !m.concealed) || v.config.mcrEightPointMinimum === false
          ? 1
          : 7;
      const all = [...h, ...melds.flatMap((m) => m.tiles)];
      const c = counts(all);
      const flush = [0, 1, 2].some(
        (s) => all.filter((t) => suit(t) === s).length >= 11,
      );
      const honored = melds.some(
        (m) =>
          m.kind !== "chow" &&
          (m.tiles[0] >= 31 ||
            m.tiles[0] === 27 + v.seat ||
            m.tiles[0] === 27 + v.wind),
      );
      const allPungs =
        melds.every((m) => m.kind !== "chow") &&
        c.filter((n) => n >= 2).length >= 4;
      if (flush || honored || allPungs) gain += 4;
    }
    if (v.config.mode === "sichuan" && v.config.scoring && a.type === "kong")
      gain += 1.5;
    if (gain > bestGain) {
      bestGain = gain;
      best = a;
    }
  }
  return best;
}
export function chooseOwn(v: PublicView, actions: Action[]): Action | null {
  const win = actions.find((a) => a.type === "win");
  if (win) return win;
  const kong =
    actions.find((a) => a.type === "concealedKong") ??
    actions.find((a) => a.type === "addedKong");
  if (!kong || v.remaining < 6) return null;
  // Adding a kong exposes a tile to robbery. Avoid late risky promotions.
  if (
    kong.type === "addedKong" &&
    v.remaining < 28 &&
    danger(v, kong.tile!) > 2
  )
    return null;
  const h = [...v.hand];
  const t = kong.tile!;
  h.splice(h.indexOf(t), 1);
  const before = evaluate(h, v.melds, v.config.mode === "mcr");
  if (kong.type === "concealedKong") {
    const afterHand = [...v.hand];
    for (let j = 0; j < 4; j++) afterHand.splice(afterHand.indexOf(t), 1);
    const after = evaluate(
      afterHand,
      [
        ...v.melds,
        { kind: "kong", tiles: [t, t, t, t], from: v.self, concealed: true },
      ],
      v.config.mode === "mcr",
    );
    if (after.shanten > before.shanten) return null;
  }
  return kong;
}
