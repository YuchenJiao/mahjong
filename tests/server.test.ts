import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { handleApi } from "../server/api";
import { apiFromNode } from "../server/http";
import { serveStatic } from "../server/static";
import { viewInput } from "../server/validation";
import { publicView, newGame } from "../src/engine/game";
import { defaultConfig } from "../src/engine/types";

const req = (path: string, data?: unknown) =>
  new Request(
    "http://localhost" + path,
    data === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
const score = {
  config: { mode: "sichuan", selfDraw: "base" },
  player: {
    hand: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
    melds: [],
    voidSuit: 2,
  },
  context: { self: true, winTile: 5 },
};
test("Health, rules and actual score API operate without an external API", async () => {
  const health = await handleApi(req("/api/health"));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).persistentServerState, false);
  const r = await handleApi(req("/api/rules"));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mcrFans.length, 82);
  const result = await handleApi(req("/api/score", score));
  assert.equal(result.status, 200);
  const s = await result.json();
  assert.equal(s.legal, true);
  assert.equal(s.fan, 5);
  assert.equal(s.points, 33);
});
test("Score API rejects malformed/oversized inputs and invalid tile counts", async () => {
  const bad = structuredClone(score);
  bad.player.hand[0] = 34;
  assert.equal((await handleApi(req("/api/score", bad))).status, 400);
  assert.equal(
    (
      await handleApi(
        req("/api/score", {
          ...score,
          player: { ...score.player, hand: Array(14).fill(0) },
        }),
      )
    ).status,
    400,
  );
  assert.equal((await handleApi(req("/api/score"))).status, 405);
  assert.equal((await handleApi(req("/api/no-such-route"))).status, 404);
  assert.equal(
    (
      await handleApi(
        new Request("http://localhost/api/score", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await handleApi(
        new Request("http://localhost/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleApi(
        new Request("http://localhost/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: " ".repeat(65537),
        }),
      )
    ).status,
    413,
  );
});
test("MCR score API accepts the optional minimum and defaults to eight points", async () => {
  const input = {
    config: { mode: "mcr" },
    player: {
      hand: [11, 12, 26, 26],
      melds: [[0, 1, 2], [12, 13, 14], [23, 24, 25]].map((tiles) => ({
        kind: "chow", tiles, from: 1, concealed: false,
      })),
    },
    context: { self: false, winTile: 13 },
  };
  const strict = await (await handleApi(req("/api/score", input))).json();
  assert.ok(strict.fan < 8);
  assert.equal(strict.legal, false);
  const relaxed = await (await handleApi(req("/api/score", {
    ...input, config: { ...input.config, mcrEightPointMinimum: false },
  }))).json();
  assert.equal(relaxed.legal, true);
  assert.equal(relaxed.points, strict.points);
  assert.deepEqual(relaxed.items, strict.items);
  assert.equal((await handleApi(req("/api/score", {
    ...input, config: { ...input.config, mcrEightPointMinimum: "false" },
  }))).status, 400);
});
test("Analysis API strips hidden information and produces real recommendations", async () => {
  const view = publicView(
    newGame({ ...defaultConfig, mode: "mcr" }, undefined, 771),
    0,
  );
  const input = {
    ...view,
    wall: [0, 1, 2],
    players: view.players.map((p) => ({ ...p, hand: [1, 1, 1] })),
  };
  const clean = viewInput(input);
  assert.equal("wall" in clean, false);
  assert.equal("hand" in clean.players[1], false);
  const result = await handleApi(req("/api/analyze", input));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.ok(body.recommendations.length > 0);
  assert.ok(view.hand.includes(body.recommendations[0].tile));
});
test("Node HTTP adapter accepts streams and rejects large bodies", async () => {
  function incoming(body: string, url: string): IncomingMessage {
    const r = Readable.from([Buffer.from(body)]) as IncomingMessage;
    r.method = "POST";
    r.url = url;
    r.headers = { "content-type": "application/json" };
    return r;
  }
  assert.equal(
    (await apiFromNode(incoming(JSON.stringify(score), "/api/score"))).status,
    200,
  );
  const parsed = incoming("", "/api/score") as IncomingMessage & {
    body?: unknown;
  };
  parsed.body = score;
  assert.equal((await apiFromNode(parsed)).status, 200);
  assert.equal(
    (await apiFromNode(incoming(" ".repeat(65537), "/api/score"))).status,
    413,
  );
});
let fixture: string;
before(async () => {
  fixture = await mkdtemp(join(tmpdir(), "mahjong-server-"));
  await mkdir(join(fixture, "assets"));
  await writeFile(join(fixture, "index.html"), "<main>mahjong</main>");
  await writeFile(join(fixture, "assets/app.js"), 'console.log("mahjong")');
});
after(async () => {
  await rm(fixture, { recursive: true, force: true });
});
test("Static server serves HTML/assets/HEAD and does not expose source files", async () => {
  const root = await serveStatic(new Request("http://localhost/"), fixture);
  assert.equal(root.status, 200);
  assert.equal(await root.text(), "<main>mahjong</main>");
  const asset = await serveStatic(
    new Request("http://localhost/assets/app.js"),
    fixture,
  );
  assert.match(asset.headers.get("content-type")!, /javascript/);
  assert.ok(asset.headers.get("cache-control")!.includes("immutable"));
  const head = await serveStatic(
    new Request("http://localhost/", { method: "HEAD" }),
    fixture,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(
    (await serveStatic(new Request("http://localhost/package.json"), fixture))
      .status,
    404,
  );
  assert.equal(
    (
      await serveStatic(
        new Request("http://localhost/%2e%2e%2fpackage.json"),
        fixture,
      )
    ).status,
    403,
  );
  assert.equal(
    (await serveStatic(new Request("http://localhost/api/nope"), fixture))
      .status,
    404,
  );
  assert.equal(
    (
      await serveStatic(
        new Request("http://localhost/", { method: "POST" }),
        fixture,
      )
    ).status,
    405,
  );
  const deep = await serveStatic(
    new Request("http://localhost/game/replay", {
      headers: { Accept: "text/html" },
    }),
    fixture,
  );
  assert.equal(deep.status, 200);
});
