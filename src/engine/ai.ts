import { evaluate, counts, suit, rank } from "./core";
import type { PublicView, Tile, Action } from "./types";
export type Advice = {
  tile: Tile;
  shanten: number;
  ukeire: number;
  useful: { tile: Tile; left: number }[];
  risk: number;
  utility: number;
  reason: string;
  target: string;
};
export function knownCounts(v: PublicView) {
  return counts([
    ...v.hand,
    ...v.players.flatMap((p) => [
      ...p.river,
      ...p.melds.flatMap((m) => m.tiles),
    ]),
  ]);
}
function danger(v: PublicView, t: Tile) {
  let risk = 0;
  const known = knownCounts(v);
  v.players.forEach((p, i) => {
    if (i === v.self || p.won) return;
    if (v.config.mode === "sichuan" && suit(t) === p.voidSuit) return;
    // A historical discard is evidence, not guaranteed safety: neither mode has riichi furiten.
    let r = 1 + p.melds.length * 0.5 + Math.min(p.river.length, 14) * 0.055;
    if (p.river.includes(t)) r *= 0.32;
    if (known[t] >= 3) r *= 0.45;
    if (t >= 27) {
      r *= 0.75;
      if (known[t] >= 2) r *= 0.6;
    } else {
      const n = rank(t);
      if (n === 1 || n === 9) r *= 0.75;
      const blocked =
        (n >= 3 && known[t - 1] === 4) || (n <= 7 && known[t + 1] === 4);
      if (blocked) r *= 0.65;
      if (
        p.river.some((x) => suit(x) === suit(t) && Math.abs(rank(x) - n) === 3)
      )
        r *= 0.82;
    }
    risk += r;
  });
  return risk;
}
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
      for (let st = 0; st < 3; st++)
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
export function advise(v: PublicView): Advice[] {
  const k = knownCounts(v);
  const forced =
    v.config.mode === "sichuan"
      ? v.hand.filter((t) => suit(t) === v.voidSuit)
      : [];
  const candidates = [...new Set(forced.length ? forced : v.hand)],
    results: Advice[] = [];
  for (const tile of candidates) {
    const h = [...v.hand];
    h.splice(h.indexOf(tile), 1);
    const e = evaluate(h, v.melds, v.config.mode === "mcr");
    const useful = e.useful
      .filter(
        (t) =>
          t < (v.config.mode === "mcr" ? 34 : 27) &&
          (v.config.mode !== "sichuan" || suit(t) !== v.voidSuit),
      )
      .map((t) => ({ tile: t, left: Math.max(0, 4 - k[t]) }));
    const ukeire = useful.reduce((s, t) => s + t.left, 0),
      risk = danger(v, tile),
      target = targets(v, h);
    const voidLeft =
      v.config.mode === "sichuan"
        ? h.filter((t) => suit(t) === v.voidSuit).length
        : 0;
    const defenseWeight =
      v.remaining < 24 && e.shanten >= 2
        ? 3.4
        : v.remaining < 38 && e.shanten >= 1
          ? 1.8
          : 0.65;
    const utility =
      -e.shanten * 18 +
      ukeire * 0.48 -
      risk * defenseWeight +
      target.bonus -
      voidLeft * 4;
    results.push({
      tile,
      shanten: e.shanten,
      ukeire,
      useful,
      risk,
      utility,
      target: target.name,
      reason: forced.length
        ? "定缺要求优先打出缺门牌"
        : `${e.shanten === 0 ? "保持听牌" : `${e.shanten}向听`}；预计${ukeire}张有效进张；${target.name}；${risk < 1.4 ? "相对低风险" : risk < 3 ? "风险适中" : "注意防守"}`,
    });
  }
  return results.sort((a, b) => b.utility - a.utility || a.tile - b.tile);
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
              i === v.self ? { ...p, melds } : p,
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
