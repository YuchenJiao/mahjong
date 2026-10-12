import { counts, decompositions, rawScore, suit, rank } from "./core";
import type { Config, Player, Tile, WinContext, WinScore, Fan } from "./types";
export type RuleSet = {
  id: string;
  title: string;
  tiles: number;
  multiWin: boolean;
  canChow: boolean;
  score: (p: Player, c: Config, ctx: WinContext) => WinScore;
};
function scScore(p: Player, c: Config, ctx: WinContext): WinScore {
  const h = ctx.self ? [...p.hand] : [...p.hand, ctx.winTile];
  const all = [...h, ...p.melds.flatMap((m) => m.tiles)];
  const invalid = (reason: string): WinScore => ({
    fan: 0,
    items: [],
    points: 0,
    legal: false,
    reason,
  });
  if (p.voidSuit < 0) return invalid("请先定缺");
  if (all.some((t) => suit(t) === p.voidSuit))
    return invalid("尚有缺门牌，不能胡牌");
  const cc = counts(h);
  const seven =
    !p.melds.length && h.length === 14 && cc.every((n) => n % 2 === 0);
  const ds = decompositions(h, p.melds);
  if (!seven && !ds.length) return invalid("尚未组成合法胡牌结构");
  if (!c.scoring)
    return {
      fan: 0,
      items: [{ name: "固定胡牌分", value: 1, count: 1 }],
      points: c.base,
      legal: true,
    };
  const roots = counts(all).filter((n) => n === 4).length;
  const flush = new Set(all.map(suit)).size === 1;
  let best: Fan[] = [];
  let bestSum = -1;
  for (const d of seven ? [null, ...ds] : ds) {
    const fs: Fan[] = [];
    const add = (name: string, value: number, count = 1) =>
      fs.push({ name, value, count });
    const gs = d
      ? [
          ...d,
          ...p.melds.map((m) => ({
            kind: m.kind === "chow" ? "chow" : "pung",
            tiles: m.tiles,
          })),
        ]
      : [];
    const allPungs = !!d && gs.every((g) => g.kind !== "chow");
    if (!d) add("七对", 2);
    else if (allPungs) add("对对胡", 1);
    else add("平胡", 0);
    if (flush) add("清一色", 2);
    if (roots) add("根", 1, roots);
    if (c.bonus.single && p.melds.length === 4) add("金钩钓", 1);
    if (
      c.bonus.outside &&
      d &&
      gs.every((g) => g.tiles.some((t) => rank(t) === 1 || rank(t) === 9))
    )
      add("带幺九", 2);
    if (
      c.bonus.all258 &&
      allPungs &&
      all.every((t) => [2, 5, 8].includes(rank(t)))
    ) {
      const i = fs.findIndex((f) => f.name === "对对胡");
      if (i >= 0) fs.splice(i, 1);
      add("将对", 3);
    }
    const sum = fs.reduce((s, f) => s + f.value * f.count, 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = fs;
    }
  }
  const add = (name: string, value: number) =>
    best.push({ name, value, count: 1 });
  if (ctx.rob && c.bonus.rob) add("抢杠胡", 1);
  else if (ctx.kong && ctx.self && c.bonus.kongFlower) add("杠上花", 1);
  else if (ctx.kong && !ctx.self && c.bonus.kongShot) add("杠上炮", 1);
  if (ctx.last && c.bonus[ctx.self ? "lastDraw" : "lastShot"])
    add(ctx.self ? "海底自摸" : "海底点炮", 1);
  if (ctx.heaven && c.bonus.heaven)
    best = [{ name: "天胡", value: 5, count: 1 }];
  if (ctx.earth && c.bonus.earth) best = [{ name: "地胡", value: 5, count: 1 }];
  if (ctx.self && c.selfDraw === "fan") add("自摸加番", 1);
  const uncapped = best.reduce((s, f) => s + f.value * f.count, 0);
  const fan = Math.min(c.cap, uncapped);
  return {
    fan,
    items: best,
    points:
      c.base * 2 ** fan + (ctx.self && c.selfDraw === "base" ? c.base : 0),
    legal: true,
  };
}
function mcrScore(p: Player, c: Config, ctx: WinContext): WinScore {
  const h = [...p.hand];
  if (ctx.self) {
    const at = h.indexOf(ctx.winTile);
    if (at < 0)
      return {
        legal: false,
        fan: 0,
        items: [],
        points: 0,
        reason: "和牌张不存在",
      };
    h.splice(at, 1);
  }
  const flags =
    (ctx.self ? 1 : 0) |
    (ctx.lastCopy ? 2 : 0) |
    ((ctx.self && ctx.kong) || ctx.rob ? 4 : 0) |
    (ctx.last ? 8 : 0) |
    (ctx.heaven ? 16 : 0);
  const r = rawScore(h, p.melds, ctx.winTile, flags, ctx.seat, ctx.wind);
  if (r.total < 0)
    return {
      fan: 0,
      points: 0,
      items: [],
      legal: false,
      reason: "尚未组成合法胡牌结构",
    };
  if (!c.scoring)
    return {
      fan: 0,
      points: c.base,
      items: [{ name: "固定胡牌分", value: 1, count: 1 }],
      legal: true,
    };
  return {
    fan: r.total,
    points: r.total,
    items: r.items,
    legal: c.mcrEightPointMinimum === false || r.total >= 8,
    reason:
      c.mcrEightPointMinimum !== false && r.total < 8
        ? `牌型成立，但仅${r.total}分；本局开启8分起胡限制`
        : undefined,
  };
}
export const rules: Record<string, RuleSet> = {
  sichuan: {
    id: "sichuan",
    title: "四川麻将",
    tiles: 27,
    multiWin: true,
    canChow: false,
    score: scScore,
  },
  mcr: {
    id: "mcr",
    title: "国标麻将",
    tiles: 34,
    multiWin: false,
    canChow: true,
    score: mcrScore,
  },
};
// Register a new RuleSet and add its setup hook in game.ts to extend variants.
export function emptyContext(winTile: Tile): WinContext {
  return {
    winTile,
    self: false,
    kong: false,
    last: false,
    heaven: false,
    earth: false,
    lastCopy: false,
    seat: 0,
    wind: 0,
  };
}
