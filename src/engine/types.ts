export type Tile = number;
export type Mode = "sichuan" | "mcr";
export type AiDifficulty = "easy" | "normal" | "advanced";
export type PlayStyle = "attack" | "balanced" | "defense";
export type Meld = {
  kind: "chow" | "pung" | "kong";
  tiles: Tile[];
  from: number;
  concealed: boolean;
  added?: boolean;
};
export const BONUS = {
  kongFlower: "杠上花",
  kongShot: "杠上炮",
  rob: "抢杠胡",
  lastDraw: "海底自摸",
  lastShot: "海底点炮",
  single: "金钩钓",
  outside: "带幺九",
  all258: "将对",
  heaven: "天胡",
  earth: "地胡",
} as const;
export type Config = {
  mode: Mode;
  scoring: boolean;
  mcrEightPointMinimum: boolean;
  aiDifficulty: AiDifficulty;
  base: number;
  cap: number;
  selfDraw: "base" | "fan";
  bonus: Record<string, boolean>;
};
export const defaultConfig: Config = {
  mode: "sichuan",
  scoring: true,
  mcrEightPointMinimum: true,
  aiDifficulty: "advanced",
  base: 1,
  cap: 5,
  selfDraw: "base",
  bonus: Object.fromEntries(Object.keys(BONUS).map((k) => [k, true])),
};
export type Player = {
  name: string;
  hand: Tile[];
  melds: Meld[];
  river: Tile[];
  discards?: Tile[];
  voidSuit: number;
  won: boolean;
  score: number;
  roundDelta: number;
};
export type Fan = { name: string; value: number; count: number };
export type WinScore = {
  fan: number;
  items: Fan[];
  points: number;
  legal: boolean;
  reason?: string;
};
export type Action = {
  type:
    "pass" | "win" | "pung" | "chow" | "kong" | "addedKong" | "concealedKong";
  tile?: Tile;
  tiles?: Tile[];
  meldIndex?: number;
};
export type WinContext = {
  self: boolean;
  winTile: Tile;
  kong: boolean;
  rob?: boolean;
  last: boolean;
  heaven: boolean;
  earth: boolean;
  lastCopy: boolean;
  seat: number;
  wind: number;
};
export type Payment = {
  from: number;
  to: number;
  amount: number;
  kind: "hu" | "kong" | "pig" | "ready" | "refund";
  note: string;
  refunded?: boolean;
};
export type Winner = {
  eventId?: string;
  player: number;
  from: number;
  tile: Tile;
  self: boolean;
  score: WinScore;
  received: number;
};
export type Pending = {
  tile: Tile;
  from: number;
  rob: boolean;
  kongShot: boolean;
  last: boolean;
  earth: boolean;
  actions: Action[][];
  responses: (Action | null)[];
  meldIndex?: number;
};
export type Frame = {
  label: string;
  players: Player[];
  current: number;
  remaining: number;
  phase: string;
  round: number;
  dealer: number;
  wind: number;
  lastTile?: Tile;
  lastFrom?: number;
};
// Confirmed, public actions only. Concealed kongs never carry a tile.
export type TableEvent = {
  id: number;
  actor: number;
  kind: "discard" | "chow" | "pung" | "kong" | "win";
  tile?: Tile;
  self?: boolean;
};
export type Game = {
  version: 3;
  config: Config;
  players: Player[];
  wall: Tile[];
  phase: "exchange" | "void" | "turn" | "claim" | "rob" | "end";
  current: number;
  dealer: number;
  round: number;
  wind: number;
  exchangeDir: number;
  drawnTile: Tile | null;
  kongDraw: boolean;
  discardCount: number;
  callCount: number;
  pending: Pending | null;
  log: string[];
  events?: TableEvent[];
  payments: Payment[];
  winners: Winner[];
  frames: Frame[];
  endReason: string;
  seed: number;
  previous: Frame[][];
};
export type PublicView = {
  publicWinningTiles?: Tile[];
  lastDiscard?: { tile: Tile; from: number };
  config: Config;
  self: number;
  hand: Tile[];
  melds: Meld[];
  voidSuit: number;
  seat: number;
  wind: number;
  remaining: number;
  players: {
    melds: Meld[];
    river: Tile[];
    discards?: Tile[];
    voidSuit: number;
    won: boolean;
    handCount: number;
  }[];
};
