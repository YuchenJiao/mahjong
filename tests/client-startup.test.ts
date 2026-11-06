import test, { before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { newGame, publicView, ownActions } from "../src/engine/game";
import { defaultConfig } from "../src/engine/types";
import { initCore } from "../src/engine/core";
import { advise, chooseOwn } from "../src/engine/ai";

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
  const saved = JSON.stringify(newGame({ ...defaultConfig, mode: "mcr", aiDifficulty: "easy" }, undefined, 64));
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
    const subtitles = () => [...win.document.querySelectorAll(".opponent .player-meta > div > span")].map(el => el.textContent ?? "");
    assert.equal(subtitles().length, 3);
    assert.ok(subtitles().every(text => text.includes("电脑 · 基础")));
    for (const [difficulty, label] of [["normal", "标准"], ["advanced", "进阶"], ["easy", "基础"]]) {
      const select = win.document.querySelector<HTMLSelectElement>('[aria-label="电脑智能程度"]')!;
      select.value = difficulty;
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      await until(() => subtitles().every(text => text.includes(`电脑 · ${label}`)) && JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!).config.aiDifficulty === difficulty, "difficulty labels and saved setting update together");
      assert.ok(win.document.querySelector("footer")!.textContent!.includes(`${label}电脑`));
    }
  } finally { release(); dom.window.close(); }
});

test("Real local CPU uses the configured difficulty for its discard", async () => {
  await initCore();
  const decisions: number[] = [];
  for (const difficulty of ["easy", "normal", "advanced"] as const) {
    // This hand produces different easy/advanced choices, so always using the
    // advanced policy cannot accidentally pass the propagation regression.
    const game = newGame({ ...defaultConfig, mode: "mcr", scoring: false, aiDifficulty: difficulty }, undefined, 4);
    [game.players[0].hand, game.players[1].hand] = [game.players[1].hand, game.players[0].hand];
    game.current = 1;
    const view = publicView(game, 1);
    assert.equal(view.config.aiDifficulty, difficulty);
    assert.equal(chooseOwn(view, ownActions(game, 1)), null);
    const expected = advise(view, { difficulty })[0].tile;
    const errors: unknown[] = [], logs = new VirtualConsole();
    logs.on("jsdomError", error => errors.push(error));
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://mahjong.test/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: logs });
    const win = dom.window;
    Object.defineProperty(win, "structuredClone", { configurable: true, value: structuredClone });
    win.addEventListener("error", e => { errors.push(e.error ?? e.message); e.preventDefault(); });
    win.localStorage.setItem("quiet-mahjong-v3", JSON.stringify(game));
    win.localStorage.setItem("quiet-mahjong-preferences", JSON.stringify({ hints: false, sound: false, voice: false, speed: 30 }));
    try {
      win.eval(entry);
      const firstDiscard = () => JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!).events.find((e: { actor: number; kind: string }) => e.actor === 1 && e.kind === "discard");
      await until(() => !!firstDiscard() || errors.length > 0, `CPU discard at ${difficulty} difficulty`);
      assert.deepEqual(errors, []);
      assert.equal(firstDiscard().tile, expected);
      decisions.push(firstDiscard().tile);
      assert.equal(JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!).config.aiDifficulty, difficulty);
    } finally { dom.window.close(); }
  }
  assert.ok(new Set(decisions).size > 1);
});

test("Real client separates the draw, moves a hand tile, persists order and integrates without taking a turn",async()=>{
  await initCore();
  const errors:unknown[]=[],logs=new VirtualConsole();logs.on("jsdomError",e=>errors.push(e));
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:"https://mahjong.test/",runScripts:"outside-only",pretendToBeVisual:true,virtualConsole:logs});
  const win=dom.window;Object.defineProperty(win,"structuredClone",{value:structuredClone});win.addEventListener("error",e=>{errors.push(e.error??e.message);e.preventDefault();});
  const g=newGame({...defaultConfig,mode:"mcr"},undefined,4),snapshot=()=>JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!);
  win.localStorage.setItem("quiet-mahjong-v3",JSON.stringify(g));win.localStorage.setItem("quiet-mahjong-preferences",JSON.stringify({hints:true,sound:false,voice:false}));
  const button=(name:string)=>[...win.document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes(name))!;
  const order=()=>[...win.document.querySelectorAll(".hand-held .tile")].map(t=>t.textContent);
  try{
    win.eval(entry);await until(()=>!!win.document.querySelector(".drawn-zone")||errors.length>0,"separate right-hand draw");
    assert.deepEqual(errors,[]);assert.equal(win.document.querySelectorAll(".hand-held .tile").length,13);
    assert.equal(win.document.querySelectorAll(".drawn-zone .tile").length,1);
    const first=order();button("手动理牌").click();await until(()=>!!button("右移"),"manual controls");
    (win.document.querySelector(".hand-held .tile") as HTMLButtonElement).click();await until(()=>!button("右移").disabled,"select a tile to move");
    button("右移").click();await until(()=>order()[0]===first[1]&&order()[1]===first[0],"manual tile move");
    await until(()=>JSON.parse(win.localStorage.getItem("quiet-mahjong-hand-order")!).order[0]!==undefined,"order persisted");
    assert.deepEqual(snapshot().players[0].hand,g.players[0].hand);assert.equal(snapshot().frames.length,g.frames.length);
    button("新摸牌归入手牌").click();await until(()=>!win.document.querySelector(".drawn-zone"),"draw integrated");
    assert.equal(win.document.querySelectorAll(".hand-held .tile").length,14);assert.deepEqual(snapshot().players[0].hand,g.players[0].hand);
    assert.equal(snapshot().current,0);assert.equal(snapshot().discardCount,0);assert.equal(snapshot().drawState.separated,false);
    assert.equal(snapshot().events.at(-1).kind,"integrate");
    assert.equal(win.document.querySelector("dialog[open]"),null);
    button("做牌方向").click();await until(()=>!!win.document.querySelector(".table-tip"),"compact route preview");
    assert.equal(win.document.querySelector('[aria-label="实时做牌方向"]'),null);
    button("完整分析").click();await until(()=>!!win.document.querySelector('[aria-label="实时做牌方向"]'),"strategy tab");
    assert.equal(win.document.querySelector(".table-tip"),null);
    assert.ok(win.document.querySelector(".threshold-note")!.textContent!.includes("8分起胡"));assert.ok(win.document.querySelectorAll(".route-card").length>0);
    assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
});

test("Real client sends distinct draw-discard and hand-discard sources for identical faces",async()=>{
  await initCore();
  for(const direct of [true,false]){
    const g=newGame({...defaultConfig,mode:"mcr",scoring:false},undefined,4),hand=g.players[0].hand;
    const duplicate=hand.find(t=>hand.filter(x=>x===t).length>=2);assert.notEqual(duplicate,undefined);g.drawnTile=duplicate!;
    const errors:unknown[]=[],logs=new VirtualConsole();logs.on("jsdomError",e=>errors.push(e));
    const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:"https://mahjong.test/",runScripts:"outside-only",pretendToBeVisual:true,virtualConsole:logs});
    const win=dom.window;Object.defineProperty(win,"structuredClone",{value:structuredClone});win.addEventListener("error",e=>{errors.push(e.error??e.message);e.preventDefault();});
    win.localStorage.setItem("quiet-mahjong-v3",JSON.stringify(g));win.localStorage.setItem("quiet-mahjong-preferences",JSON.stringify({hints:false,sound:false,voice:false,speed:10000}));
    try{
      win.eval(entry);await until(()=>!!win.document.querySelector(".drawn-zone")||errors.length>0,"draw source fixture");assert.deepEqual(errors,[]);
      await until(()=>!!win.localStorage.getItem("quiet-mahjong-hand-order"),"initial hand effects settled");
      await new Promise(resolve=>setTimeout(resolve,10));
      const drawn=win.document.querySelector<HTMLButtonElement>(".drawn-zone .tile")!;
      const chosen=direct?drawn:[...win.document.querySelectorAll<HTMLButtonElement>(".hand-held .tile")].find(t=>t.textContent===drawn.textContent)!;assert.ok(chosen);
      chosen.click();await until(()=>[...win.document.querySelectorAll("button")].some(b=>b.textContent?.startsWith("打出 ")),"discard selection");
      [...win.document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.startsWith("打出 "))!.click();
      await until(()=>JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!).discardCount===1,"discard saved");
      const saved=JSON.parse(win.localStorage.getItem("quiet-mahjong-v3")!);assert.equal(saved.events.at(-1).fromDraw,direct);assert.equal(saved.events.at(-1).tile,duplicate);
      assert.equal(saved.events.some((e:{kind:string})=>e.kind==="integrate"),!direct);assert.deepEqual(errors,[]);
    }finally{dom.window.close();}
  }
});
