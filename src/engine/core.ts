import createCore from "./mcrcore.js";
import type { Fan, Tile, Meld } from "./types";
type Core = {
  ccall: (
    name: string,
    ret: string,
    args: string[],
    values: unknown[],
  ) => string;
};
let core: Core | undefined;
let coreReady: Promise<void> | undefined;
export function initCore(options: Record<string, unknown> = {}): Promise<void> {
  return (coreReady ??= Promise.resolve()
    .then(() => createCore(options))
    .then((value: Core) => {
      if (typeof value?.ccall !== "function") throw new Error("规则引擎初始化未完成");
      core = value;
    })
    .catch((error: unknown) => {
      coreReady = undefined;
      throw error;
    }));
}
export function isCoreReady() { return core !== undefined; }
export class CoreNotReadyError extends Error {
  constructor() { super("规则引擎尚未就绪，请等待加载完成"); this.name = "CoreNotReadyError"; }
}
function requireCore(): Core {
  if (!core) throw new CoreNotReadyError();
  return core;
}
export const suit = (t: Tile) => (t < 27 ? Math.floor(t / 9) : 3);
export const rank = (t: Tile) => (t < 27 ? (t % 9) + 1 : 0);
export const tileName = (t: Tile) =>
  t < 27
    ? `${rank(t)}${["万", "筒", "条"][suit(t)]}`
    : ["东", "南", "西", "北", "中", "发", "白"][t - 27];
export const counts = (ts: Tile[]) => {
  const c = Array(34).fill(0) as number[];
  ts.forEach((t) => c[t]++);
  return c;
};
export const sortHand = (h: Tile[]) => h.sort((a, b) => a - b);
const honors = ["E", "S", "W", "N", "C", "F", "P"];
export const tileCode = (t: Tile) =>
  t < 27 ? `${rank(t)}${["m", "p", "s"][suit(t)]}` : honors[t - 27];
export function handCode(hand: Tile[], melds: Meld[]) {
  return (
    melds
      .map((m) => {
        const src = m.concealed ? 0 : 1;
        const offer = m.kind === "chow" ? 1 : m.added ? 5 : src;
        return `[${m.tiles.map(tileCode).join("")}${offer || ""}]`;
      })
      .join("") + hand.map(tileCode).join("")
  );
}
export function rawScore(
  hand: Tile[],
  melds: Meld[],
  win: Tile,
  flags = 0,
  seat = 0,
  wind = 0,
): { total: number; items: Fan[] } {
  return JSON.parse(
    requireCore().ccall(
      "mj_score",
      "string",
      ["string", "number", "number", "number"],
      [handCode(hand, melds) + tileCode(win), flags, seat, wind],
    ),
  );
}
const cache = new Map<string, { shanten: number; useful: Tile[] }>();
export function evaluate(hand: Tile[], melds: Meld[], mcr: boolean) {
  const key =
    handCode(
      [...hand].sort((a, b) => a - b),
      melds,
    ) + (mcr ? "M" : "S");
  const old = cache.get(key);
  if (old) return old;
  const r = JSON.parse(
    requireCore().ccall(
      "mj_eval",
      "string",
      ["string", "number"],
      [handCode(hand, melds), mcr ? 31 : 1],
    ),
  ) as { shanten: number; useful: number[] };
  r.useful = r.useful.map((i) =>
    i < 9 ? i : i < 18 ? i + 9 : i < 27 ? i - 9 : i,
  );
  // Sichuan seven pairs permits a four-of-a-kind to be two pairs.
  if (!mcr && melds.length === 0) {
    const c = counts(hand);
    const pairs = c.reduce((s, n) => s + Math.floor(n / 2), 0);
    const sp = 6 - pairs;
    const useful = c.flatMap((n, t) => (n % 2 === 1 ? [t] : []));
    if (sp < r.shanten) {
      r.shanten = sp;
      r.useful = useful;
    } else if (sp === r.shanten)
      r.useful = [...new Set([...r.useful, ...useful])];
  }
  if (cache.size > 12000) cache.clear();
  cache.set(key, r);
  return r;
}
export function fanReference(): { name: string; value: number }[] {
  return JSON.parse(requireCore().ccall("mj_fans", "string", [], []));
}
export function scoreString(
  text: string,
  flags = 0,
  seat = 0,
  wind = 0,
): { total: number; items: Fan[] } {
  return JSON.parse(
    requireCore().ccall(
      "mj_score",
      "string",
      ["string", "number", "number", "number"],
      [text, flags, seat, wind],
    ),
  );
}
export type Group = { tiles: Tile[]; kind: "chow" | "pung" | "pair" };
export function decompositions(hand: Tile[], melds: Meld[]): Group[][] {
  const c = counts(hand),
    need = 4 - melds.length,
    result: Group[][] = [];
  function walk(groups: Group[], pair: boolean) {
    let t = c.findIndex((n) => n > 0);
    if (t < 0) {
      if (pair && groups.length === need + 1) result.push(groups);
      return;
    }
    if (groups.length >= need + 1) return;
    if (!pair && c[t] >= 2) {
      c[t] -= 2;
      walk([...groups, { kind: "pair", tiles: [t, t] }], true);
      c[t] += 2;
    }
    if (c[t] >= 3) {
      c[t] -= 3;
      walk([...groups, { kind: "pung", tiles: [t, t, t] }], pair);
      c[t] += 3;
    }
    if (t < 27 && t % 9 <= 6 && c[t + 1] && c[t + 2]) {
      c[t]--;
      c[t + 1]--;
      c[t + 2]--;
      walk([...groups, { kind: "chow", tiles: [t, t + 1, t + 2] }], pair);
      c[t]++;
      c[t + 1]++;
      c[t + 2]++;
    }
  }
  walk([], false);
  return result;
}
