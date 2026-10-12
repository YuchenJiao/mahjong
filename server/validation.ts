import { BONUS, defaultConfig } from "../src/engine/types";
import type {
  Config,
  Meld,
  Player,
  PublicView,
  WinContext,
} from "../src/engine/types";
import { counts } from "../src/engine/core";

export class InputError extends Error {}
type Obj = Record<string, unknown>;
export function object(x: unknown): Obj {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw new InputError("Expected a JSON object");
  return x as Obj;
}
function integer(x: unknown, low: number, high: number): number {
  if (typeof x !== "number" || !Number.isInteger(x) || x < low || x > high)
    throw new InputError(`Expected an integer in ${low}..${high}`);
  return x;
}
function boolean(x: unknown): boolean {
  if (typeof x !== "boolean") throw new InputError("Expected boolean");
  return x;
}
export function configInput(x: unknown): Config {
  const o = object(x);
  if (o.mode !== "sichuan" && o.mode !== "mcr")
    throw new InputError("Unknown mode");
  const bonus: Record<string, boolean> = { ...defaultConfig.bonus };
  if (o.bonus !== undefined) {
    const b = object(o.bonus);
    for (const k of Object.keys(BONUS)) if (k in b) bonus[k] = boolean(b[k]);
  }
  const selfDraw = o.selfDraw ?? "base";
  if (selfDraw !== "base" && selfDraw !== "fan")
    throw new InputError("Invalid selfDraw");
  return {
    mode: o.mode,
    scoring: o.scoring === undefined ? true : boolean(o.scoring),
    mcrEightPointMinimum:
      o.mcrEightPointMinimum === undefined ? true : boolean(o.mcrEightPointMinimum),
    base: o.base === undefined ? 1 : integer(o.base, 1, 100),
    cap: o.cap === undefined ? 5 : integer(o.cap, 3, 6),
    selfDraw,
    bonus,
  };
}
function tiles(x: unknown, config: Config, max: number): number[] {
  if (!Array.isArray(x) || x.length > max)
    throw new InputError("Invalid tile array length");
  return x.map((t) => integer(t, 0, config.mode === "sichuan" ? 26 : 33));
}
function meldInput(x: unknown, config: Config, allowHidden: boolean): Meld {
  const o = object(x);
  if (!["chow", "pung", "kong"].includes(o.kind as string))
    throw new InputError("Unknown meld");
  const kind = o.kind as Meld["kind"],
    ts = tiles(o.tiles, config, 4);
  const concealed = o.concealed === undefined ? false : boolean(o.concealed);
  if (allowHidden && concealed && kind === "kong" && ts.length === 0)
    return { kind, tiles: [], from: integer(o.from ?? 0, 0, 3), concealed };
  if (ts.length !== (kind === "kong" ? 4 : 3))
    throw new InputError("Wrong meld tile count");
  if (kind === "chow") {
    if (
      config.mode === "sichuan" ||
      ts[0] >= 27 ||
      ts[0] % 9 > 6 ||
      ts[1] !== ts[0] + 1 ||
      ts[2] !== ts[0] + 2 ||
      concealed
    )
      throw new InputError("Invalid chow");
  } else if (!ts.every((t) => t === ts[0]))
    throw new InputError("Pung/kong tiles must match");
  if (kind !== "kong" && concealed)
    throw new InputError("Only kong can be concealed");
  const added = o.added === undefined ? false : boolean(o.added);
  if (added && (kind !== "kong" || concealed))
    throw new InputError("Invalid added kong");
  return {
    kind,
    tiles: ts,
    from: integer(o.from ?? 0, 0, 3),
    concealed,
    added,
  };
}
function meldsInput(x: unknown, config: Config, allowHidden = false): Meld[] {
  if (!Array.isArray(x) || x.length > 4)
    throw new InputError("Invalid meld array");
  return x.map((m) => meldInput(m, config, allowHidden));
}
function checkHand(hand: number[], melds: Meld[], expected: number) {
  if (hand.length + melds.length * 3 !== expected)
    throw new InputError(`Hand plus 3×melds must equal ${expected}`);
  if (counts([...hand, ...melds.flatMap((m) => m.tiles)]).some((n) => n > 4))
    throw new InputError("More than four copies of one tile");
}
export function scoreInput(x: unknown): {
  player: Player;
  config: Config;
  context: WinContext;
} {
  const o = object(x),
    config = configInput(o.config),
    p = object(o.player),
    c = object(o.context);
  const hand = tiles(p.hand, config, 14),
    melds = meldsInput(p.melds ?? [], config);
  const self = boolean(c.self);
  checkHand(hand, melds, self ? 14 : 13);
  const winTile = integer(c.winTile, 0, config.mode === "sichuan" ? 26 : 33);
  if (self && !hand.includes(winTile))
    throw new InputError("Self draw tile must be in hand");
  if (
    !self &&
    counts([...hand, ...melds.flatMap((m) => m.tiles)])[winTile] >= 4
  )
    throw new InputError("Winning tile would be a fifth copy");
  const context: WinContext = {
    self,
    winTile,
    kong: false,
    rob: false,
    last: false,
    heaven: false,
    earth: false,
    lastCopy: false,
    seat: integer(c.seat ?? 0, 0, 3),
    wind: integer(c.wind ?? 0, 0, 3),
  };
  for (const key of [
    "kong",
    "rob",
    "last",
    "heaven",
    "earth",
    "lastCopy",
  ] as const)
    if (key in c) context[key] = boolean(c[key]);
  return {
    config,
    context,
    player: {
      name: "API",
      hand,
      melds,
      river: [],
      voidSuit: integer(
        p.voidSuit ?? (config.mode === "sichuan" ? 2 : -1),
        -1,
        2,
      ),
      won: false,
      score: 0,
      roundDelta: 0,
    },
  };
}
export function viewInput(x: unknown): PublicView {
  const o = object(x),
    config = configInput(o.config),
    self = integer(o.self ?? 0, 0, 3);
  const hand = tiles(o.hand, config, 14),
    melds = meldsInput(o.melds ?? [], config);
  checkHand(hand, melds, 14);
  if (!Array.isArray(o.players) || o.players.length !== 4)
    throw new InputError("Four public player observations required");
  const players = o.players.map((value, i) => {
    const p = object(value);
    return {
      melds: i === self ? melds : meldsInput(p.melds ?? [], config, true),
      river: tiles(p.river ?? [], config, 136),
      voidSuit: integer(p.voidSuit ?? -1, -1, 2),
      won: p.won === undefined ? false : boolean(p.won),
      handCount: integer(p.handCount ?? 13, 0, 18),
    };
  });
  // Construct a new observation explicitly: incoming wall/opponent hand fields are never passed to AI.
  return {
    config,
    self,
    hand,
    melds,
    voidSuit: integer(o.voidSuit ?? -1, -1, 2),
    seat: integer(o.seat ?? 0, 0, 3),
    wind: integer(o.wind ?? 0, 0, 3),
    remaining: integer(o.remaining ?? 60, 0, 136),
    players,
  };
}
