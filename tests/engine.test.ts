import test, { before } from "node:test";
import assert from "node:assert/strict";
import {
  initCore,
  counts,
  evaluate,
  scoreString,
  fanReference,
  suit,
} from "../src/engine/core";
import { rules, emptyContext } from "../src/engine/rules";
import {
  newGame,
  chooseExchange,
  doExchange,
  doVoid,
  allowedDiscards,
  ownActions,
  act,
  discard,
  respond,
  advance,
  publicView,
  copyGame,
  readyScores,
  winScore,
} from "../src/engine/game";
import { advise, chooseOwn, chooseResponse } from "../src/engine/ai";
import { defaultConfig } from "../src/engine/types";
import type { Game, Config, Player, Meld } from "../src/engine/types";
import corpus from "./mcr-corpus.json";
before(async () => {
  await initCore();
});
function tiles(text: string) {
  const arr: number[] = [];
  for (const m of text.matchAll(/([1-9]+)([mps])|([ESWNCFP])/g)) {
    if (m[1]) for (const n of m[1]) arr.push("mps".indexOf(m[2]) * 9 + +n - 1);
    else arr.push(27 + "ESWNCFP".indexOf(m[3]));
  }
  return arr;
}
function player(text: string, melds: Meld[] = []): Player {
  return {
    name: "测试",
    hand: tiles(text),
    melds,
    river: [],
    voidSuit: 2,
    won: false,
    score: 0,
    roundDelta: 0,
  };
}
const cfg = (extra: Partial<Config> = {}): Config => ({
  ...defaultConfig,
  bonus: { ...defaultConfig.bonus },
  ...extra,
});
test("MCR exposes all 81 fans and combined concealed/melded kong rule", () => {
  const fs = fanReference();
  assert.equal(fs.length, 82);
  assert.equal(fs.filter((f) => f.value === 88).length, 7);
  assert.ok(fs.some((f) => f.name === "花牌"));
});
test("WebAssembly adapter matches native scoring over upstream regression corpus", () => {
  assert.ok(corpus.length > 100);
  for (const c of corpus)
    assert.equal(
      scoreString(c.text, c.flags, c.seat, c.wind).total,
      c.total,
      c.text,
    );
});
test("MCR special shapes, high fan exclusions, and winds", () => {
  for (const [text, name] of [
    ["19m19s19pESWNCFPP", "十三幺"],
    ["11223344556677m", "连七对"],
    ["17m36s25pESWNCFP9s", "七星不靠"],
    ["369m258s147pEEPPE", "组合龙"],
    ["[EEE][SSS][WWW]NN11mN", "大四喜"],
  ]) {
    const r = scoreString(text);
    assert.ok(r.total >= 8, text);
    assert.ok(
      r.items.some((f) => f.name === name),
      text + JSON.stringify(r),
    );
    if (name === "大四喜")
      assert.ok(
        !r.items.some((f) => f.name === "碰碰和" || f.name === "三风刻"),
      );
  }
  const r = scoreString("[EEE][SSS][WWW]123mCC", 0, 0, 0);
  assert.ok(r.items.some((f) => f.name === "圈风刻"));
  assert.ok(r.items.some((f) => f.name === "门风刻"));
});
test("MCR eight point gate can be disabled without losing legal structures", () => {
  const melds: Meld[] = ["123m", "456p", "678s"].map((s) => ({
    kind: "chow",
    tiles: tiles(s),
    from: 1,
    concealed: false,
  }));
  const p = player("34p99s", melds),
    ctx = emptyContext(tiles("5p")[0]);
  const full = rules.mcr.score(p, cfg({ mode: "mcr" }), ctx);
  assert.ok(full.fan < 8);
  assert.equal(full.legal, false);
  const relaxed = rules.mcr.score(
    p, cfg({ mode: "mcr", mcrEightPointMinimum: false }), ctx,
  );
  assert.equal(relaxed.legal, true);
  assert.equal(relaxed.fan, full.fan);
  assert.equal(relaxed.points, full.points);
  assert.deepEqual(relaxed.items, full.items);
  assert.equal(relaxed.reason, undefined);
  assert.equal(
    rules.mcr.score(player("33p99s", melds), cfg({ mode: "mcr", mcrEightPointMinimum: false }), ctx).legal,
    false,
  );
  const legacy = cfg({ mode: "mcr" });
  delete (legacy as Partial<Config>).mcrEightPointMinimum;
  assert.equal(rules.mcr.score(p, legacy, ctx).legal, false);
  assert.equal(
    rules.mcr.score(p, cfg({ mode: "mcr", scoring: false }), ctx).legal,
    true,
  );
});
test("MCR relaxed minimum enables self draw and preserves fan plus eight point payments", () => {
  const g = newGame(cfg({ mode: "mcr" }), undefined, 719);
  g.current = 0;
  g.dealer = 1;
  g.discardCount = 5;
  g.drawnTile = tiles("5p")[0];
  g.players[0] = player("345p99s", ["123m", "456p", "678s"].map((s) => ({
    kind: "chow", tiles: tiles(s), from: 3, concealed: false,
  })));
  const strict = winScore(g, 0, true);
  assert.ok(strict.fan < 8);
  assert.equal(ownActions(g, 0).some((a) => a.type === "win"), false);
  g.config.mcrEightPointMinimum = false;
  const relaxed = winScore(g, 0, true);
  assert.equal(relaxed.legal, true);
  const action = ownActions(g, 0).find((a) => a.type === "win");
  assert.ok(action);
  act(g, 0, action);
  assert.equal(g.phase, "end");
  assert.equal(g.winners[0].received, 3 * (8 + relaxed.points));
  assert.deepEqual(g.payments.map((p) => p.amount), Array(3).fill(8 + relaxed.points));
  assert.equal(g.players.reduce((sum, p) => sum + p.score, 0), 0);
  const resumed = copyGame(g);
  assert.equal(resumed.config.mcrEightPointMinimum, false);
  assert.equal(newGame(resumed.config, resumed, 720).config.mcrEightPointMinimum, false);
});
test("MCR wait mapping maps bamboo/dots and honors correctly", () => {
  const e = evaluate(tiles("123m123p123sEECC"), [], true);
  assert.equal(e.shanten, 0);
  assert.ok(e.useful.includes(27));
  assert.ok(e.useful.includes(31));
  const dot = evaluate(tiles("123m123s789s44m34p"), [], true);
  assert.ok(dot.useful.includes(10));
  assert.ok(dot.useful.includes(13));
});
test("Sichuan seven pairs roots, missing suit restriction, self-draw and caps", () => {
  const p = player("11112233445566m");
  const ctx = { ...emptyContext(5), self: true };
  const r = rules.sichuan.score(p, cfg({ selfDraw: "fan" }), ctx);
  assert.equal(r.legal, true);
  assert.equal(r.fan, 5);
  assert.equal(r.points, 32);
  assert.equal(r.items.find((f) => f.name === "根")?.count, 1);
  assert.ok(!r.items.some((f) => f.name === "对对胡"));
  assert.equal(
    rules.sichuan.score(p, cfg({ selfDraw: "base", cap: 6 }), ctx).points,
    33,
  );
  p.voidSuit = 0;
  assert.equal(rules.sichuan.score(p, cfg(), ctx).legal, false);
});
test("Exchange is same-suit, simultaneous, and tile-conserving", () => {
  const g = newGame(cfg(), undefined, 12345),
    before = counts(g.players.flatMap((p) => p.hand));
  assert.throws(() => doExchange(g, [0, 9, 18]));
  const chosen = chooseExchange(g.players[0].hand);
  assert.equal(new Set(chosen.map(suit)).size, 1);
  doExchange(g, chosen);
  assert.deepEqual(counts(g.players.flatMap((p) => p.hand)), before);
  assert.equal(g.phase, "void");
  doVoid(g, 0);
  assert.equal(g.phase, "turn");
  assert.ok(allowedDiscards(g, 0).every((t) => suit(t) === 0));
});
test("AI input has no wall or opponent concealed identities", () => {
  const g = newGame(cfg({ mode: "mcr" }), undefined, 64);
  g.players[1].melds.push({
    kind: "kong",
    tiles: [0, 0, 0, 0],
    concealed: true,
    from: 1,
  });
  const v = publicView(g, 0);
  assert.equal("wall" in v, false);
  assert.equal("hand" in v.players[1], false);
  assert.deepEqual(v.players[1].melds[0].tiles, []);
  assert.deepEqual(v.hand, g.players[0].hand);
});
function rigDiscard(mode: "sichuan" | "mcr", scoring = false) {
  const g = newGame(cfg({ mode, scoring }), undefined, 82);
  g.phase = "turn";
  g.current = 0;
  g.drawnTile = 0;
  g.players.forEach((p) => {
    p.hand = [];
    p.melds = [];
    p.river = [];
    p.voidSuit = 2;
  });
  g.players[0].hand = tiles("1123456789m123p9p");
  g.players[1].hand = tiles("123456789m123p1m");
  g.players[2].hand = tiles("123456789m123p1m");
  g.players[3].hand = tiles("2233445566778p");
  return g;
}
test("Sichuan simultaneous wins pay each winner and continue with two active players", () => {
  const g = rigDiscard("sichuan");
  discard(g, 0, 0);
  for (let i = 1; i < 4; i++)
    if (g.pending!.responses[i] === null)
      respond(g, i, { type: i < 3 ? "win" : "pass" });
  advance(g);
  assert.equal(g.winners.length, 2);
  assert.equal(g.players[0].score, -2);
  assert.equal(g.players[1].score, 1);
  assert.equal(g.players[2].score, 1);
  assert.equal(g.current, 3);
  assert.equal(g.phase, "turn");
  assert.equal(g.players[0].river.length, 0);
});
test("MCR simultaneous win picks nearest player and ends immediately", () => {
  const g = rigDiscard("mcr");
  discard(g, 0, 0);
  for (let i = 1; i < 4; i++)
    if (g.pending!.responses[i] === null)
      respond(g, i, { type: i < 3 ? "win" : "pass" });
  advance(g);
  assert.equal(g.winners.length, 1);
  assert.equal(g.winners[0].player, 1);
  assert.equal(g.phase, "end");
});
test("Chow is only available to next player; winning has priority over pung", () => {
  const g = rigDiscard("mcr");
  g.players[0].hand = tiles("123456789m123p11s");
  g.players[1].hand = tiles("12456789m123p11s");
  g.players[2].hand = tiles("12456789m123p11s");
  discard(g, 0, 2);
  assert.ok(g.pending!.actions[1].some((a) => a.type === "chow"));
  assert.ok(!g.pending!.actions[2].some((a) => a.type === "chow"));
});
test("Robbing added kong cancels its payment and consumes exactly the offered tile", () => {
  const g = rigDiscard("sichuan");
  g.players[0].hand = tiles("123456789m11p");
  g.players[0].melds = [
    { kind: "pung", tiles: [0, 0, 0], from: 3, concealed: false },
  ];
  g.drawnTile = 0;
  const a = ownActions(g, 0).find((a) => a.type === "addedKong")!;
  assert.ok(a);
  act(g, 0, a);
  for (let i = 1; i < 4; i++)
    if (g.pending!.responses[i] === null)
      respond(g, i, { type: i === 1 ? "win" : "pass" });
  advance(g);
  assert.equal(g.players[0].melds[0].kind, "pung");
  assert.ok(!g.payments.some((p) => p.kind === "kong"));
  assert.equal(g.winners[0].player, 1);
});
test("Concealed kong payment only charges active opponents", () => {
  const g = rigDiscard("sichuan");
  g.players[0].hand = tiles("111123456789m11p");
  g.players[2].won = true;
  act(
    g,
    0,
    ownActions(g, 0).find((a) => a.type === "concealedKong")!,
  );
  assert.equal(g.players[0].score, 4);
  assert.equal(g.players[2].score, 0);
  assert.equal(g.kongDraw, true);
});
test("Wall end performs ready, flower pig and tax refund accounting", () => {
  const g = rigDiscard("sichuan");
  g.wall = [];
  g.players[1].hand = tiles("123456789m123p1m");
  g.players[2].hand = tiles("123456m124567p9p");
  g.players[3].hand = tiles("123456m123456p1s");
  g.players[3].voidSuit = 2;
  g.players[0].hand = tiles("123456m124567p99p");
  g.players[0].score = 2;
  g.players[0].roundDelta = 2;
  g.players[2].score = -2;
  g.players[2].roundDelta = -2;
  g.payments.push({ from: 2, to: 0, amount: 2, kind: "kong", note: "直杠" });
  discard(g, 0, 17);
  for (let i = 1; i < 4; i++)
    if (g.pending!.responses[i] === null) respond(g, i, { type: "pass" });
  advance(g);
  assert.equal(g.phase, "end");
  assert.ok(g.payments.some((p) => p.kind === "pig"));
  assert.ok(g.payments.some((p) => p.kind === "ready"));
  assert.ok(g.payments.some((p) => p.kind === "refund"));
  assert.equal(
    g.players.reduce((s, p) => s + p.score, 0),
    0,
  );
});
test("Full automatic games terminate, keep zero-sum scores and survive JSON resume", () => {
  let ended = 0,
    wins = 0;
  for (const mode of ["sichuan", "mcr"] as const)
    for (const scoring of [false, true])
      for (let seed = 1; seed <= 8; seed++) {
        let g = newGame(cfg({ mode, scoring }), undefined, seed * 811);
        if (mode === "sichuan") {
          doExchange(g, chooseExchange(g.players[0].hand));
          doVoid(
            g,
            [0, 1, 2].sort(
              (a, b) =>
                g.players[0].hand.filter((t) => suit(t) === a).length -
                g.players[0].hand.filter((t) => suit(t) === b).length,
            )[0],
          );
        }
        let ticks = 0;
        while (g.phase !== "end" && ticks++ < 700) {
          if (ticks === 35) {
            const resumed = JSON.parse(JSON.stringify(g));
            assert.deepEqual(resumed, copyGame(g));
            g = resumed;
          }
          if (g.pending) {
            for (let i = 0; i < 4; i++)
              if (g.pending.responses[i] === null)
                respond(
                  g,
                  i,
                  chooseResponse(publicView(g, i), g.pending.actions[i]),
                );
            advance(g);
          } else {
            let i = g.current;
            const a = chooseOwn(publicView(g, i), ownActions(g, i));
            if (a) act(g, i, a);
            else discard(g, i, advise(publicView(g, i))[0].tile);
          }
          assert.equal(
            g.players.reduce((s, p) => s + p.score, 0),
            0,
          );
          assert.equal(
            g.players.reduce((s, p) => s + p.roundDelta, 0),
            0,
          );
          for (const p of g.players)
            if (!p.won) {
              assert.ok(p.hand.length % 3 === 1 || p.hand.length % 3 === 2);
              assert.ok(
                p.hand.length + p.melds.length * 3 === 13 ||
                  p.hand.length + p.melds.length * 3 === 14,
              );
            }
        }
        assert.equal(g.phase, "end", `${mode},${scoring},seed=${seed}`);
        ended++;
        wins += g.winners.length;
      }
  assert.equal(ended, 32);
  assert.ok(wins > 15);
  console.log(
    `32 complete games; ${wins} wins; no deadlocks or unbalanced payments.`,
  );
});
