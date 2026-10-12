import { counts, suit, tileName, sortHand } from "./core";
import { rules, emptyContext } from "./rules";
import { defaultConfig } from "./types";
import type {
  Game,
  Config,
  Player,
  Tile,
  Action,
  Pending,
  WinContext,
  WinScore,
  PublicView,
  Frame,
  TableEvent,
} from "./types";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function log(g: Game, s: string) {
  g.log.push(s);
}
function emit(g: Game, event: Omit<TableEvent, "id">) {
  g.events ??= [];
  g.events.push({ ...event, id: g.events.length + 1 });
}
function frame(g: Game, label: string) {
  g.frames.push({
    label,
    players: clone(g.players),
    current: g.current,
    remaining: g.wall.length,
    phase: g.phase,
    round: g.round,
    dealer: g.dealer,
    wind: g.wind,
    lastTile: g.pending?.tile,
    lastFrom: g.pending?.from,
  });
}
function rng(g: Game) {
  let x = g.seed;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  g.seed = x >>> 0;
  return g.seed / 4294967296;
}
export function newGame(config: Config, prior?: Game, seed?: number, entropy?: () => number): Game {
  const round = prior ? prior.round + 1 : 1;
  let dealer = prior
    ? config.mode === "mcr"
      ? (prior.dealer + 1) % 4
      : prior.winners.length
        ? prior.winners.filter(
            (w) =>
              w.from === prior.winners[0].from &&
              w.tile === prior.winners[0].tile,
          ).length > 1
          ? prior.winners[0].from
          : prior.winners[0].player
        : prior.dealer
    : 0;
  const g: Game = {
    version: 3,
    config: clone({ ...defaultConfig, ...config }),
    players: ["你", "清风", "竹影", "月白"].map((name, i) => ({
      name,
      hand: [],
      melds: [],
      river: [],
      discards: [],
      voidSuit: -1,
      won: false,
      score: prior?.players[i].score ?? 0,
      roundDelta: 0,
    })),
    wall: [],
    phase: config.mode === "sichuan" ? "exchange" : "turn",
    current: dealer,
    dealer,
    round,
    wind: config.mode === "mcr" ? Math.floor((round - 1) / 4) % 4 : 0,
    exchangeDir: 0,
    drawnTile: null,
    kongDraw: false,
    discardCount: 0,
    callCount: 0,
    pending: null,
    log: [],
    events: [],
    payments: [],
    winners: [],
    frames: [],
    endReason: "",
    seed: (seed ?? (Math.random() * 4294967295) >>> 0) || 1,
    previous: prior ? [...prior.previous, prior.frames].slice(-3) : [],
  };
  for (let t = 0; t < rules[config.mode].tiles; t++)
    for (let j = 0; j < 4; j++) g.wall.push(t);
  for (let i = g.wall.length - 1; i > 0; i--) {
    let j = Math.floor((entropy ? entropy() : rng(g)) * (i + 1));
    [g.wall[i], g.wall[j]] = [g.wall[j], g.wall[i]];
  }
  for (let j = 0; j < 13; j++)
    for (let i = 0; i < 4; i++) g.players[i].hand.push(g.wall.pop()!);
  g.drawnTile = g.wall.pop()!;
  g.players[dealer].hand.push(g.drawnTile);
  g.players.forEach((p) => sortHand(p.hand));
  g.exchangeDir = [1, 2, 3][Math.floor((entropy ? entropy() : rng(g)) * 3)];
  log(
    g,
    `第${round}局 · ${rules[config.mode].title} · ${g.players[dealer].name}坐庄`,
  );
  frame(g, "开局发牌");
  return g;
}
export function chooseExchange(hand: Tile[]): Tile[] {
  const by = [0, 1, 2].map((s) => hand.filter((t) => suit(t) === s));
  const available = by
    .filter((h) => h.length >= 3)
    .sort((a, b) => a.length - b.length);
  const h = available[0];
  const c = counts(h);
  return [...h]
    .sort(
      (a, b) =>
        c[a] * 5 -
        (a % 9 === 0 || a % 9 === 8 ? 2 : 0) -
        (c[b] * 5 - (b % 9 === 0 || b % 9 === 8 ? 2 : 0)),
    )
    .slice(0, 3);
}
export function doExchange(g: Game, selected: Tile[]) {
  exchangeAll(g, g.players.map((p, i) => i === 0 ? selected : chooseExchange(p.hand)));
}
export function exchangeAll(g: Game, sets: Tile[][]) {
  if (
    g.phase !== "exchange" ||
    sets.length !== 4 ||
    sets.some((selected) => selected.length !== 3 || new Set(selected.map(suit)).size !== 1)
  )
    throw Error("请选择三张同花色牌");
  sets.forEach((selected, seat) => {
    const h = [...g.players[seat].hand];
    for (const t of selected) {
      const at = h.indexOf(t);
      if (at < 0) throw Error("选牌不存在");
      h.splice(at, 1);
    }
  });
  sets.forEach((ts, i) =>
    ts.forEach((t) => {
      let at = g.players[i].hand.indexOf(t);
      g.players[i].hand.splice(at, 1);
    }),
  );
  sets.forEach((ts, i) => g.players[(i + g.exchangeDir) % 4].hand.push(...ts));
  g.players.forEach((p) => sortHand(p.hand));
  // After swapping, the dealer's fourteen tiles are all initial tiles.
  g.drawnTile = g.players[g.dealer].hand.at(-1)!;
  g.phase = "void";
  log(
    g,
    `换三张完成 · ${g.exchangeDir === 2 ? "对家交换" : g.exchangeDir === 1 ? "逆时针交换" : "顺时针交换"}`,
  );
  frame(g, "换三张完成");
}
export function doVoid(g: Game, s: number) {
  voidAll(g, g.players.map((p, i) => i === 0 ? s : chooseVoid(p)));
}
export function chooseVoid(p: Player) {
  return [0, 1, 2].sort((a, b) => p.hand.filter((t) => suit(t) === a).length -
    p.hand.filter((t) => suit(t) === b).length)[0];
}
export function voidAll(g: Game, suits: number[]) {
  if (g.phase !== "void" || suits.length !== 4 || suits.some((s) => ![0, 1, 2].includes(s)))
    throw Error("请选择定缺花色");
  g.players.forEach((p, i) => (p.voidSuit = suits[i]));
  g.phase = "turn";
  log(
    g,
    `定缺：${g.players.map((p) => `${p.name}缺${["万", "筒", "条"][p.voidSuit]}`).join(" / ")}`,
  );
  frame(g, "四家定缺");
}
function activeNext(g: Game, i: number) {
  for (let j = 1; j <= 4; j++) {
    let at = (i + j) % 4;
    if (!g.players[at].won) return at;
  }
  return i;
}
export function seatOf(g: Game, i: number) {
  return (i - g.dealer + 4) % 4;
}
function exposedCount(g: Game, t: Tile) {
  return g.players.reduce(
    (n, p) =>
      n +
      p.river.filter((x) => x === t).length +
      p.melds
        .filter((m) => !m.concealed)
        .flatMap((m) => m.tiles)
        .filter((x) => x === t).length +
      (p.won ? p.hand.filter((x) => x === t).length : 0),
    0,
  );
}
export function context(g: Game, i: number, self: boolean): WinContext {
  const pending = g.pending;
  const t = self ? g.drawnTile : pending?.tile;
  return {
    self,
    winTile: t ?? -1,
    kong: self ? g.kongDraw : !!pending?.kongShot,
    rob: !self && !!pending?.rob,
    last: self ? g.wall.length === 0 : !!pending?.last,
    heaven: self && g.discardCount === 0 && g.callCount === 0 && i === g.dealer,
    earth: !self && !!pending?.earth,
    lastCopy: exposedCount(g, t ?? -1) >= 3,
    seat: seatOf(g, i),
    wind: g.wind,
  };
}
export function winScore(g: Game, i: number, self: boolean): WinScore {
  const ctx = context(g, i, self);
  if (ctx.winTile < 0)
    return {
      legal: false,
      fan: 0,
      points: 0,
      items: [],
      reason: "没有可胡的牌",
    };
  // Discard being claimed is in the river, so only the *other* exposed copies count.
  if (!self && !g.pending?.rob)
    ctx.lastCopy = exposedCount(g, ctx.winTile) - 1 >= 3;
  return rules[g.config.mode].score(g.players[i], g.config, ctx);
}
export function allowedDiscards(g: Game, i: number): Tile[] {
  const p = g.players[i];
  const missing =
    g.config.mode === "sichuan"
      ? p.hand.filter((t) => suit(t) === p.voidSuit)
      : [];
  return [...new Set(missing.length ? missing : p.hand)];
}
export function ownActions(g: Game, i: number): Action[] {
  if (g.phase !== "turn" || g.current !== i || g.players[i].won) return [];
  const p = g.players[i],
    a: Action[] = [];
  if (winScore(g, i, true).legal) a.push({ type: "win" });
  if (g.wall.length) {
    const c = counts(p.hand);
    c.forEach((n, t) => {
      if (n === 4 && (g.config.mode !== "sichuan" || suit(t) !== p.voidSuit))
        a.push({ type: "concealedKong", tile: t });
    });
    p.melds.forEach((m, k) => {
      if (m.kind === "pung" && c[m.tiles[0]] > 0)
        a.push({ type: "addedKong", tile: m.tiles[0], meldIndex: k });
    });
  }
  return a;
}
function claimActions(g: Game, i: number): Action[] {
  const q = g.pending!,
    p = g.players[i];
  if (i === q.from || p.won) return [];
  const a: Action[] = [];
  if (winScore(g, i, false).legal) a.push({ type: "win" });
  if (q.rob) return a;
  if (g.config.mode === "sichuan" && suit(q.tile) === p.voidSuit) return a;
  const c = counts(p.hand),
    t = q.tile;
  if (c[t] >= 2) a.push({ type: "pung", tile: t });
  if (c[t] >= 3 && g.wall.length) a.push({ type: "kong", tile: t });
  if (rules[g.config.mode].canChow && i === (q.from + 1) % 4 && t < 27) {
    for (let st = t - 2; st <= t; st++) {
      if (st < 0 || st % 9 > 6 || suit(st) !== suit(t)) continue;
      const ts = [st, st + 1, st + 2];
      if (ts.filter((x) => x !== t).every((x) => c[x] > 0))
        a.push({ type: "chow", tile: t, tiles: ts });
    }
  }
  return a;
}
function setPending(
  g: Game,
  t: Tile,
  from: number,
  rob = false,
  meldIndex?: number,
) {
  g.pending = {
    tile: t,
    from,
    rob,
    kongShot: !rob && g.kongDraw,
    last: g.wall.length === 0,
    earth:
      !rob && g.discardCount === 1 && from === g.dealer && g.callCount === 0,
    actions: [[], [], [], []],
    responses: [null, null, null, null],
    meldIndex,
  };
  for (let i = 0; i < 4; i++) {
    g.pending.actions[i] = claimActions(g, i);
    if (!g.pending.actions[i].length) g.pending.responses[i] = { type: "pass" };
  }
  g.phase = rob ? "rob" : "claim";
}
export function discard(g: Game, i: number, t: Tile) {
  if (
    g.phase !== "turn" ||
    g.current !== i ||
    !allowedDiscards(g, i).includes(t)
  )
    throw Error("当前不能打这张牌");
  const p = g.players[i];
  p.hand.splice(p.hand.indexOf(t), 1);
  p.discards ??= historicalDiscards(g, i);
  p.river.push(t);
  p.discards.push(t);
  g.discardCount++;
  log(g, `${p.name}打出${tileName(t)}`);
  emit(g, { actor: i, kind: "discard", tile: t });
  setPending(g, t, i);
  g.drawnTile = null;
  frame(g, `${p.name} · 打${tileName(t)}`);
}
function pay(
  g: Game,
  from: number,
  to: number,
  amount: number,
  kind: "hu" | "kong" | "pig" | "ready" | "refund",
  note: string,
) {
  if (!amount || from === to) return;
  g.players[from].score -= amount;
  g.players[from].roundDelta -= amount;
  g.players[to].score += amount;
  g.players[to].roundDelta += amount;
  g.payments.push({ from, to, amount, kind, note });
}
function receiveWin(g: Game, i: number, self: boolean, precomputed?: WinScore) {
  const sc = precomputed ?? winScore(g, i, self);
  if (!sc.legal) throw Error(sc.reason ?? "不能胡牌");
  const t = context(g, i, self).winTile,
    from = self ? i : g.pending!.from;
  const p = g.players[i];
  let received = 0;
  for (let j = 0; j < 4; j++)
    if (j !== i && !g.players[j].won) {
      let amount = 0;
      if (g.config.mode === "mcr" && g.config.scoring)
        amount = 8 + (self || j === from ? sc.points : 0);
      else if (self || j === from) amount = sc.points;
      pay(
        g,
        j,
        i,
        amount,
        "hu",
        `${self ? "自摸" : "点炮"} · ${sc.items.map((f) => f.name).join("、")}`,
      );
      received += amount;
    }
  p.won = true;
  if (!self) p.hand.push(t);
  sortHand(p.hand);
  g.winners.push({ eventId: `${g.round}:${g.discardCount}:${self ? "self" + i : from}:${t}`, player: i, from, tile: t, self, score: sc, received });
  emit(g, { actor: i, kind: "win", tile: t, self });
  log(
    g,
    `${p.name}${self ? "自摸" : "胡牌"} · ${g.config.scoring ? `${sc.fan}${g.config.mode === "mcr" ? "分" : "番"}` : "固定分"} · 收入${received}`,
  );
}
function kongPayment(
  g: Game,
  i: number,
  from: number,
  concealed: boolean,
  added: boolean,
) {
  const b = g.config.base;
  if (concealed || added) {
    for (let j = 0; j < 4; j++)
      if (j !== i && !g.players[j].won)
        pay(
          g,
          j,
          i,
          b * (concealed ? 2 : 1),
          "kong",
          concealed ? "暗杠" : "补杠",
        );
  } else pay(g, from, i, 2 * b, "kong", "直杠");
}
function draw(g: Game, i: number, kong = false) {
  if (!g.wall.length) {
    endRound(g, "牌墙摸完");
    return;
  }
  const t = kong ? g.wall.shift()! : g.wall.pop()!;
  g.players[i].hand.push(t);
  sortHand(g.players[i].hand);
  g.drawnTile = t;
  g.current = i;
  g.kongDraw = kong;
  g.pending = null;
  g.phase = "turn";
  // Human draw is visible; computer draw labels do not reveal its identity.
  log(g, `${g.players[i].name}${kong ? "杠后补牌" : "摸牌"}`);
  frame(g, `${g.players[i].name} · ${kong ? "杠后补牌" : "摸牌"}`);
}
function removeTiles(p: Player, ts: Tile[]) {
  for (const t of ts) {
    const at = p.hand.indexOf(t);
    if (at < 0) throw Error("牌不在手中");
    p.hand.splice(at, 1);
  }
}
function completeAdded(g: Game, from: number, k: number, t: Tile) {
  const p = g.players[from];
  removeTiles(p, [t]);
  const m = p.melds[k];
  m.kind = "kong";
  m.tiles.push(t);
  m.added = true;
  g.callCount++;
  if (g.config.mode === "sichuan") kongPayment(g, from, m.from, false, true);
  log(g, `${p.name}补杠${tileName(t)}`);
  emit(g, { actor: from, kind: "kong", tile: t });
  frame(g, `${p.name} · 补杠${tileName(t)}`);
  draw(g, from, true);
}
export function respond(g: Game, i: number, a: Action) {
  if (
    !g.pending ||
    !["claim", "rob"].includes(g.phase) ||
    g.pending.responses[i]
  )
    throw Error("当前没有待响应的操作");
  g.pending.responses[i] = a.type === "pass" ? { type: "pass" } : canonicalAction(g.pending.actions[i], a);
}
export function canonicalAction(actions: Action[], input: Action): Action {
  const action = actions.find(a => a.type === input?.type && a.tile === input.tile &&
    a.meldIndex === input.meldIndex && JSON.stringify(a.tiles ?? []) === JSON.stringify(input.tiles ?? []));
  if (!action) throw Error("不是合法操作");
  return JSON.parse(JSON.stringify(action));
}
export function resolveClaims(g: Game) {
  const q = g.pending;
  if (!q || q.responses.some((a) => a === null)) return false;
  const order = [1, 2, 3].map((k) => (q.from + k) % 4);
  let winners = order.filter((i) => q.responses[i]?.type === "win");
  if (!rules[g.config.mode].multiWin) winners = winners.slice(0, 1);
  if (winners.length) {
    order.filter(i => !winners.includes(i) && q.responses[i]?.type !== "pass").forEach(i =>
      log(g, `${g.players[i].name}选择${({ chow: "吃", pung: "碰", kong: "杠", win: "胡" } as Record<string, string>)[q.responses[i]!.type]}，因胡牌优先或胡牌顺序取消`));
    const scores = winners.map((i) => winScore(g, i, false));
    winners.forEach((i, k) => receiveWin(g, i, false, scores[k]));
    if (q.rob) removeTiles(g.players[q.from], [q.tile]);
    else g.players[q.from].river.pop();
    frame(
      g,
      winners
        .map((i) => `${g.players[i].name}胡${tileName(q.tile)}`)
        .join(" / "),
    );
    g.pending = null;
    g.kongDraw = false;
    if (g.config.mode === "mcr" || g.players.filter((p) => p.won).length >= 3) {
      endRound(g, g.config.mode === "mcr" ? "有人胡牌" : "三家胡牌");
      return true;
    }
    draw(g, activeNext(g, q.from));
    return true;
  }
  if (q.rob) {
    completeAdded(g, q.from, q.meldIndex!, q.tile);
    return true;
  }
  const caller =
    order.find((i) => ["pung", "kong"].includes(q.responses[i]!.type)) ??
    order.find((i) => q.responses[i]!.type === "chow");
  if (caller !== undefined) {
    const a = q.responses[caller]!,
      p = g.players[caller];
    const ts =
      a.type === "chow"
        ? a.tiles!
        : [q.tile, q.tile, q.tile, ...(a.type === "kong" ? [q.tile] : [])];
    const remove = [...ts];
    remove.splice(remove.indexOf(q.tile), 1);
    removeTiles(p, remove);
    g.players[q.from].river.pop();
    p.melds.push({
      kind: a.type === "chow" ? "chow" : a.type === "kong" ? "kong" : "pung",
      tiles: ts,
      from: q.from,
      concealed: false,
    });
    g.callCount++;
    g.current = caller;
    g.pending = null;
    g.drawnTile = null;
    g.kongDraw = false;
    emit(g, { actor: caller, kind: a.type as "chow" | "pung" | "kong", tile: q.tile });
    log(
      g,
      `${p.name}${a.type === "chow" ? "吃" : a.type === "kong" ? "杠" : "碰"}${tileName(q.tile)}`,
    );
    g.phase = "turn";
    frame(
      g,
      `${p.name} · ${a.type === "chow" ? "吃" : a.type === "kong" ? "直杠" : "碰"}${tileName(q.tile)}`,
    );
    if (a.type === "kong") {
      if (g.config.mode === "sichuan")
        kongPayment(g, caller, q.from, false, false);
      draw(g, caller, true);
    }
  } else draw(g, activeNext(g, q.from));
  return true;
}
export function act(g: Game, i: number, a: Action) {
  a = canonicalAction(ownActions(g, i), a);
  if (a.type === "win") {
    receiveWin(g, i, true);
    frame(g, `${g.players[i].name} · 自摸`);
    if (g.config.mode === "mcr" || g.players.filter((p) => p.won).length >= 3)
      endRound(g, g.config.mode === "mcr" ? "有人胡牌" : "三家胡牌");
    else draw(g, activeNext(g, i));
    return;
  }
  if (a.type === "concealedKong") {
    const p = g.players[i];
    removeTiles(p, Array(4).fill(a.tile!));
    p.melds.push({
      kind: "kong",
      tiles: Array(4).fill(a.tile!),
      from: i,
      concealed: true,
    });
    g.callCount++;
    if (g.config.mode === "sichuan") kongPayment(g, i, i, true, false);
    log(g, `${p.name}暗杠`);
    emit(g, { actor: i, kind: "kong" });
    frame(g, `${p.name} · 暗杠`);
    draw(g, i, true);
  } else if (a.type === "addedKong") {
    setPending(g, a.tile!, i, true, a.meldIndex);
    frame(g, `${g.players[i].name} · 尝试补杠${tileName(a.tile!)}`);
  }
}
export function readyScores(g: Game, i: number) {
  const p = g.players[i],
    list: { tile: Tile; score: WinScore }[] = [];
  const c = counts([...p.hand, ...p.melds.flatMap((m) => m.tiles)]);
  for (let t = 0; t < rules[g.config.mode].tiles; t++) {
    if (c[t] >= 4) continue;
    const sc = rules[g.config.mode].score(p, g.config, {
      ...emptyContext(t),
      seat: seatOf(g, i),
      wind: g.wind,
    });
    if (sc.legal) list.push({ tile: t, score: sc });
  }
  return list;
}
function endRound(g: Game, reason: string) {
  g.phase = "end";
  g.pending = null;
  g.endReason = reason;
  if (
    g.config.mode === "sichuan" &&
    g.players.filter((p) => p.won).length < 3
  ) {
    const pigs = g.players.map(
      (p) =>
        !p.won &&
        [...p.hand, ...p.melds.flatMap((m) => m.tiles)].some(
          (t) => suit(t) === p.voidSuit,
        ),
    );
    const ready = g.players.map((p, i) =>
      p.won || pigs[i] ? [] : readyScores(g, i),
    );
    for (let i = 0; i < 4; i++)
      if (pigs[i])
        for (let j = 0; j < 4; j++)
          if (i !== j && !pigs[j])
            pay(
              g,
              i,
              j,
              g.config.base * (g.config.scoring ? 2 ** g.config.cap : 1),
              "pig",
              "查花猪",
            );
    for (let i = 0; i < 4; i++)
      if (!g.players[i].won && !pigs[i] && !ready[i].length)
        for (let j = 0; j < 4; j++)
          if (ready[j].length)
            pay(
              g,
              i,
              j,
              Math.max(...ready[j].map((x) => x.score.points)),
              "ready",
              "查大叫",
            );
    const refunds = g.payments.filter(
      (x) =>
        x.kind === "kong" &&
        !x.refunded &&
        !g.players[x.to].won &&
        (pigs[x.to] || !ready[x.to].length),
    );
    refunds.forEach((x) => {
      x.refunded = true;
      pay(g, x.to, x.from, x.amount, "refund", "退税：退还已收杠分");
    });
    log(g, "流局检查完成：查花猪、查大叫、退税");
  }
  log(g, `${reason} · 本局结束`);
  frame(g, reason);
}
export function publicView(g: Game, i: number): PublicView {
  const p = g.players[i];
  const publicWinningTiles: Tile[] = [];
  const events = new Map<string, typeof g.winners>();
  g.winners.forEach(w => {
    const id = w.eventId ?? `${w.from}:${w.tile}`;
    events.set(id, [...(events.get(id) ?? []), w]);
  });
  for (const batch of events.values()) if (!batch.some(w => w.player === i)) publicWinningTiles.push(batch[0].tile);
  return {
    publicWinningTiles,
    lastDiscard: g.pending && !g.pending.rob ? { tile: g.pending.tile, from: g.pending.from } : undefined,
    config: g.config,
    self: i,
    hand: [...p.hand],
    melds: clone(p.melds),
    voidSuit: p.voidSuit,
    seat: seatOf(g, i),
    wind: g.wind,
    remaining: g.wall.length,
    players: g.players.map((q, j) => ({
      melds: q.melds.map((m) =>
        m.concealed && j !== i ? { ...m, tiles: [] } : clone(m),
      ),
      river: [...q.river],
      discards: historicalDiscards(g, j),
      voidSuit: q.voidSuit,
      won: q.won,
      handCount: q.hand.length,
    })),
  };
}
export function historicalDiscards(g: Game, seat: number): Tile[] {
  const p = g.players[seat];
  if (p.discards) return [...p.discards];
  const history = g.frames.filter(f => f.lastFrom === seat && f.lastTile !== undefined &&
    f.label.endsWith(" · 打" + tileName(f.lastTile))).map(f => f.lastTile!);
  return history.length ? history : [...p.river];
}
export function snapshot(g: Game): Frame {
  return {
    label: g.log.at(-1) ?? "",
    players: g.players,
    current: g.current,
    remaining: g.wall.length,
    phase: g.phase,
    round: g.round,
    dealer: g.dealer,
    wind: g.wind,
    lastTile: g.pending?.tile,
    lastFrom: g.pending?.from,
  };
}
export function advance(g: Game): boolean {
  if (g.pending && g.pending.responses.every((a) => a !== null))
    return resolveClaims(g);
  return false;
}
export function copyGame(g: Game) {
  return clone(g);
}
