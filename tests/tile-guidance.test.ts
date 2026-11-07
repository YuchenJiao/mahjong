import test, { before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { initCore } from "../src/engine/core";
import { newGame, publicView } from "../src/engine/game";
import { defaultConfig } from "../src/engine/types";
import { actionGuidance, directionRoutes } from "../src/engine/assistant";
import { compareCalls } from "../src/engine/call-impact";
import { tileFacts } from "../src/TableTileTips";
before(initCore);
function tiles(s:string){return [...s].map(c=>Number(c)-1);}
function view(hand:string){
  const g=newGame({...defaultConfig,mode:"mcr"},undefined,4);
  g.players.forEach(p=>{p.river=[];p.melds=[];});g.players[0].hand=tiles(hand);
  const v=publicView(g,0);v.lastDiscard={tile:2,from:3};v.players[3].river=[2];return v;
}
test("Tile counts use physical visible copies and absent tiles sort by actual need",()=>{
  const v=view("1112233456678");
  const report={shanten:0,waits:[],routes:directionRoutes(v),actions:[],eightPointMinimum:true,notes:[]};
  const facts=tileFacts(v,report,{useful:[{tile:9,left:4}]} as any);
  assert.equal(facts.find(f=>f.tile===2)!.left,1);
  assert.equal(facts.find(f=>f.tile===0)!.left,1);
  assert.equal(facts.filter(f=>!f.held)[0].tile,9);
  assert.equal(facts.length,34);
  v.players[1].discards=[0,0,0];
  assert.deepEqual(tileFacts(v,report,{useful:[{tile:9,left:4}]} as any),facts);
});
test("Calls explain lost waits and keep comparison read-only; damaging calls no longer get recommended",()=>{
  const v=view("1112233456678"), before=JSON.stringify(v);
  const actions=actionGuidance(v,[{type:"chow",tile:2,tiles:[0,1,2]},{type:"pass"}],"balanced");
  const call=actions.find(a=>a.action.type==="chow")!;
  assert.match(call.reasons.join(" "),/2万不再成牌/);
  actions.forEach(a=>a.recommended=a===call);
  const result=compareCalls(v,actions,"balanced");
  const detail=result.comparisons.get(call)!;
  assert.match(result.before,/清一色/);
  assert.match(detail.details.join(" "),/2万不再成牌/);
  assert.match(detail.details.join(" "),/10 → 7/);
  assert.equal(result.best?.action.type,"pass");
  assert.equal(JSON.stringify(v),before);
});
test("Seven pairs is explicitly blocked by a call, with a replacement direction",()=>{
  const v=view("1122334455667");
  const actions=actionGuidance(v,[{type:"chow",tile:2,tiles:[0,1,2]},{type:"pass"}],"balanced");
  const detail=[...compareCalls(v,actions,"balanced").comparisons.values()][0];
  assert.match(detail.headline,/需换方向/);
  assert.match(detail.details.join(" "),/七对.*不可继续/);
  assert.match(detail.headline,/清一色/);
});
test("Kong comparison keeps unknown supplement distinct from an ordinary follow-up discard",()=>{
  const v=view("1112233456678");
  v.lastDiscard={tile:0,from:3};v.players[3].river=[0];
  const actions=actionGuidance(v,[{type:"kong",tile:0},{type:"pass"}],"balanced");
  const detail=[...compareCalls(v,actions,"balanced").comparisons.values()][0];
  assert.match(detail.headline,/补牌前/);
  assert.match(detail.details.join(" "),/未知补牌/);
});

test("Hover and touch hold show tile facts without consuming ordinary clicks or double clicks",async()=>{
  const bundle=await build({stdin:{contents:`
    import React from "react"; import {createRoot} from "react-dom/client";
    import {TileLens,MissingTiles} from "./src/TableTileTips";
    import {Tile} from "./src/Tile";
    const facts=[{tile:0,left:2,known:2,held:1,priority:10,tags:["有效进张"],routes:[]},
      {tile:9,left:4,known:0,held:0,priority:0,tags:["可点和／自摸"],routes:[]}];
    window.clicks=0;
    createRoot(document.getElementById("root")).render(<>
      <TileLens facts={facts}><Tile tile={0} onClick={()=>window.clicks++}/><Tile tile={8} hidden/></TileLens>
      <MissingTiles facts={facts}/>
    </>);
  `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",external:["module"],define:{"import.meta.url":'"https://test.local/a.js"'}});
  const errors:unknown[]=[],logs=new VirtualConsole();logs.on("jsdomError",e=>errors.push(e));
  const dom=new JSDOM('<div id="root"></div>',{url:"https://test.local",runScripts:"outside-only",pretendToBeVisual:true,virtualConsole:logs}),w=dom.window;
  const until=async(fn:()=>boolean)=>{const end=Date.now()+3000;while(!fn()){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,5));}};
  const pointer=(el:Element,type:string,kind="touch",x=20)=>{
    const e=new w.MouseEvent(type,{bubbles:true,clientX:x,clientY:20});
    Object.defineProperty(e,"pointerType",{value:kind});el.dispatchEvent(e);
  };
  try{
    w.eval(bundle.outputFiles[0].text);
    await until(()=>!!w.document.querySelector("[data-tile-face]"));
    const tile=w.document.querySelector<HTMLButtonElement>("[data-tile-face]")!;
    assert.equal(w.document.querySelector(".back")!.hasAttribute("data-tile-face"),false);
    pointer(tile,"pointerover","mouse");
    await until(()=>!!w.document.querySelector('[role="tooltip"]'));
    assert.match(w.document.querySelector('[role="tooltip"]')!.textContent!,/2张未见/);
    pointer(tile,"pointerdown");pointer(tile,"pointerup");tile.click();tile.click();
    assert.equal((w as any).clicks,2);
    await until(()=>!w.document.querySelector('[role="tooltip"]'));
    pointer(tile,"pointerdown");await until(()=>!!w.document.querySelector('[role="tooltip"]'));
    pointer(tile,"pointerup");tile.click();assert.equal((w as any).clicks,2);
    pointer(tile,"pointerdown");pointer(tile,"pointermove","touch",40);pointer(tile,"pointerup");tile.click();
    assert.equal((w as any).clicks,3);
    await until(()=>!w.document.querySelector('[role="tooltip"]'));
    assert.equal(w.document.querySelector('[role="tooltip"]'),null);
    [...w.document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="未持有牌")!.click();
    await until(()=>!!w.document.querySelector(".missing-tiles"));
    const list=w.document.querySelector(".missing-tiles")!.textContent!;
    assert.match(list,/1筒/);assert.doesNotMatch(list,/1万/);assert.deepEqual(errors,[]);
  }finally{w.close();}
});
