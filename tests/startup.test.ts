import test from "node:test";
import assert from "node:assert/strict";
import { act, createElement as h, StrictMode } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { EngineBootstrap } from "../src/EngineBootstrap";
import { initCore, isCoreReady, CoreNotReadyError, evaluate, fanReference, rawScore, scoreString } from "../src/engine/core";
import { newGame, ownActions } from "../src/engine/game";
import { defaultConfig } from "../src/engine/types";
import type { Game } from "../src/engine/types";

const saved = JSON.stringify(newGame({ ...defaultConfig, mode: "mcr" }, undefined, 64));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function domRoot() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.localStorage.setItem("quiet-mahjong-v3", saved);
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!, root: Root = createRoot(container);
  return { dom, root, container, async cleanup() {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

test("Cold engine calls fail explicitly rather than accessing undefined ccall", () => {
  assert.equal(isCoreReady(), false);
  for (const call of [() => ownActions(JSON.parse(saved), 0), () => rawScore([], [], 0), () => evaluate([], [], true), fanReference, () => scoreString("123m")]) {
    assert.throws(call, CoreNotReadyError);
  }
});
test("Concurrent initialization shares a single attempt and a failure is not permanently cached", async () => {
  let attempts = 0;
  const failure = new Error("simulated initialization failure");
  const first = initCore({ preInit: () => { attempts++; throw failure; } });
  assert.equal(initCore(), first);
  await assert.rejects(first, error => error === failure);
  assert.equal(attempts, 1); assert.equal(isCoreReady(), false);
});
test("StrictMode cold restore defers every MCR scoring render until the real engine is ready", async () => {
  const fixture = await domRoot(), pending = deferred();
  let scored = 0;
  function RestoredTable() {
    const game = JSON.parse(localStorage.getItem("quiet-mahjong-v3")!) as Game;
    const actions = ownActions(game, 0); scored++;
    return h("output", { "data-table": "ready" }, JSON.stringify(actions));
  }
  const initialize = () => pending.promise.then(() => initCore());
  try {
    await act(async () => fixture.root.render(h(StrictMode, null, h(EngineBootstrap, { initialize, children: h(RestoredTable) }))));
    assert.ok(fixture.container.querySelector('[role="status"]'));
    assert.equal(scored, 0); assert.equal(isCoreReady(), false);
    assert.equal(fixture.dom.window.localStorage.getItem("quiet-mahjong-v3"), saved);
    await act(async () => { pending.resolve(); await pending.promise; await initCore(); });
    assert.equal(isCoreReady(), true); assert.ok(scored > 0);
    assert.ok(fixture.container.querySelector('[data-table="ready"]'));
    assert.equal(fixture.container.querySelector('[role="status"]'), null);
    assert.equal(fixture.dom.window.localStorage.getItem("quiet-mahjong-v3"), saved);
  } finally { await fixture.cleanup(); }
});
test("Failed startup keeps the table unmounted and retry succeeds without deleting the saved game", async () => {
  const fixture = await domRoot(); let attempts = 0, scored = 0;
  const initialize = async () => { if (++attempts === 1) throw new Error("temporarily unavailable"); await initCore(); };
  function Table() { ownActions(JSON.parse(saved), 0); scored++; return h("output", null, "table ready"); }
  try {
    await act(async () => fixture.root.render(h(EngineBootstrap, { initialize, children: h(Table) })));
    assert.ok(fixture.container.querySelector('[role="alert"]')); assert.equal(scored, 0);
    assert.equal(fixture.dom.window.localStorage.getItem("quiet-mahjong-v3"), saved);
    await act(async () => fixture.container.querySelector("button")!.dispatchEvent(new fixture.dom.window.MouseEvent("click", { bubbles: true })));
    assert.equal(attempts, 2); assert.ok(scored > 0); assert.equal(fixture.container.querySelector('[role="alert"]'), null);
    assert.equal(fixture.dom.window.localStorage.getItem("quiet-mahjong-v3"), saved);
  } finally { await fixture.cleanup(); }
});
test("An unmounted loading attempt cannot render its table after a late completion", async () => {
  const fixture = await domRoot(), pending = deferred(); let mounted = 0;
  const initialize = () => pending.promise;
  function Table() { mounted++; return h("div", null, "old table"); }
  try {
    await act(async () => fixture.root.render(h(EngineBootstrap, { initialize, children: h(Table) })));
    await act(async () => fixture.root.render(h("div", null, "replacement")));
    await act(async () => { pending.resolve(); await pending.promise; });
    assert.equal(mounted, 0); assert.equal(fixture.container.textContent, "replacement");
  } finally { await fixture.cleanup(); }
});
