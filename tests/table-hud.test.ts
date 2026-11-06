import test from "node:test";
import assert from "node:assert/strict";
import { automaticCommand, autoOff } from "../src/TableHud";
import { newGame } from "../src/engine/game";
import { defaultConfig, type Action } from "../src/engine/types";

test("Auto discard only cuts a separate legal draw, including Sichuan missing-suit rules", () => {
  const g=newGame({...defaultConfig,mode:"mcr"},undefined,4), tile=g.drawnTile!;
  const cut={...autoOff,discard:true};
  assert.deepEqual(automaticCommand(g,true,[],[],cut),{type:"discard",tile,fromDraw:true});
  g.drawState!.separated=false;
  assert.equal(automaticCommand(g,true,[],[],cut),null);
  g.drawState!.separated=true;
  g.config.mode="sichuan";g.drawnTile=9;g.players[0].hand=[0,9];g.players[0].voidSuit=0;
  assert.equal(automaticCommand(g,true,[],[],cut),null);
  g.players[0].hand=[9];
  assert.deepEqual(automaticCommand(g,true,[],[],cut),{type:"discard",tile:9,fromDraw:true});
});

test("Skipping calls preserves a legal win; automatic win works for both draw and discard", () => {
  const g=newGame({...defaultConfig,mode:"mcr"},undefined,4);
  const partial={...autoOff,pass:true,discard:true};
  const pung:Action={type:"pung"}, win:Action={type:"win"};
  assert.deepEqual(automaticCommand(g,false,[],[pung],partial),{type:"claim",action:{type:"pass"}});
  assert.equal(automaticCommand(g,false,[],[pung,win],partial),null);
  assert.equal(automaticCommand(g,true,[win],[],partial),null);
  assert.deepEqual(automaticCommand(g,false,[],[win],{...autoOff,win:true}),{type:"claim",action:win});
  assert.deepEqual(automaticCommand(g,true,[win],[],{...autoOff,win:true}),{type:"act",action:win});
  assert.equal(automaticCommand(g,false,[],[],partial),null);
});
