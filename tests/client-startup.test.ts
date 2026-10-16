import test, { before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { newGame } from "../src/engine/game";
import { defaultConfig } from "../src/engine/types";

let entry: string;
before(async () => {
  const compiled = await build({ entryPoints: ["src/main.tsx"], bundle: true, write: false, format: "iife", platform: "browser",
    loader: { ".css": "empty" }, external: ["module"], logLevel: "silent",
    define: { "import.meta.env": "{}", "import.meta.url": '"https://mahjong.test/assets/startup.js"', "process.env.NODE_ENV": '"production"' } });
  entry = compiled.outputFiles[0].text;
});
async function until(condition: () => boolean, label: string) {
  const limit = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > limit) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

for (const hints of [false, true]) test(`Real client entry cold-restores MCR safely with hints ${hints ? "on" : "off"}`, async () => {
  const errors: unknown[] = [], logs = new VirtualConsole();
  logs.on("jsdomError", error => errors.push(error));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://mahjong.test/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: logs });
  const win = dom.window;
  // jsdom omits this browser API; use Node's equivalent for the assistant.
  Object.defineProperty(win, "structuredClone", { configurable: true, value: structuredClone });
  win.addEventListener("error", event => { errors.push(event.error ?? event.message); event.preventDefault(); });
  const saved = JSON.stringify(newGame({ ...defaultConfig, mode: "mcr" }, undefined, 64));
  win.localStorage.setItem("quiet-mahjong-v3", saved);
  win.localStorage.setItem("quiet-mahjong-preferences", JSON.stringify({ hints, sound: false, voice: false }));
  const wasm = (win as unknown as { WebAssembly: typeof WebAssembly }).WebAssembly;
  const instantiate = wasm.instantiate.bind(wasm);
  let release!: () => void, started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  wasm.instantiate = (async (...args: Parameters<typeof WebAssembly.instantiate>) => {
    started = true;
    await gate;
    return instantiate(...args);
  }) as typeof WebAssembly.instantiate;
  try {
    win.eval(entry);
    await until(() => started || errors.length > 0, "client starts the real WASM engine");
    assert.deepEqual(errors, []);
    assert.ok(win.document.querySelector('[role="status"]'));
    assert.equal(win.document.querySelector(".app"), null);
    assert.equal(win.localStorage.getItem("quiet-mahjong-v3"), saved);
    release();
    await until(() => !!win.document.querySelector(".human-hand") || errors.length > 0, "restored table renders after initialization");
    assert.deepEqual(errors, []);
    assert.equal(win.document.querySelectorAll(".human-hand .tile").length, 14);
    assert.ok(win.document.querySelector(".game-heading h2")!.textContent!.includes("国标麻将"));
    assert.equal(win.document.querySelector('[role="alert"]'), null);
    assert.equal(JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!).round, 1);
  } finally { release(); dom.window.close(); }
});
