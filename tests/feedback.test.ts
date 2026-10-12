import test from "node:test";
import assert from "node:assert/strict";
import { EventCursor, eventSpeech } from "../src/feedback/events";
import { chineseVoice, chineseVoices, voiceId, voiceKind, VoiceAnnouncer } from "../src/feedback/voice";
import type { SpeechPlatform } from "../src/feedback/voice";
import type { TableEvent } from "../src/engine/types";

const event = (id: number, kind: TableEvent["kind"] = "discard", tile = 0): TableEvent => ({ id, actor: 1, kind, tile });
function fakeSpeech(throws = false) {
  const spoken: SpeechSynthesisUtterance[] = [];
  let cancelled = 0;
  const voices = [
    { name: "English", voiceURI: "en", lang: "en-US", localService: true },
    { name: "Chinese remote", voiceURI: "remote", lang: "zh-CN", localService: false },
    { name: "Chinese local", voiceURI: "local", lang: "zh-CN", localService: true },
  ] as SpeechSynthesisVoice[];
  const platform: SpeechPlatform = {
    synth: { speak: u => { if (throws) throw Error("unavailable"); spoken.push(u); }, cancel: () => { cancelled++; }, resume() {}, getVoices: () => voices },
    utterance: text => ({ text } as SpeechSynthesisUtterance),
  };
  return { spoken, voices, platform, get cancelled() { return cancelled; }, end: () => spoken.at(-1)!.onend?.call(spoken.at(-1)!, {} as SpeechSynthesisEvent) };
}
test("Public tile names and calls have short unambiguous Chinese speech", () => {
  assert.deepEqual([0,8,9,17,18,26,27,28,29,30,31,32,33].map(t => eventSpeech(event(1,"discard",t))),
    ["一万","九万","一筒","九筒","一条","九条","东风","南风","西风","北风","红中","发财","白板"]);
  assert.deepEqual(["chow","pung","kong","win"].map(kind => eventSpeech(event(1,kind as TableEvent["kind"]))), ["吃","碰","杠","胡"]);
  assert.equal(eventSpeech({id:1,actor:0,kind:"kong"}),"杠");
  assert.equal(eventSpeech({...event(1,"win"),self:true}),"自摸，胡");
  assert.equal(eventSpeech(event(1,"discard",-1)),"");
});
test("Cursor skips refresh history and consumes batched updates exactly once", () => {
  const c = new EventCursor();
  assert.deepEqual(c.read("room-a",[event(1)]),[]);
  assert.deepEqual(c.read("room-a",[event(1),event(2),event(3,"win")]).map(e=>e.id),[2,3]);
  assert.deepEqual(c.read("room-a",[event(1),event(2),event(3,"win")]),[]);
  assert.deepEqual(c.read("room-a",[event(1),event(2)]),[]); // delayed old poll
  assert.deepEqual(c.read("room-a",[event(1),event(2),event(3)]),[]);
  assert.deepEqual(c.read("room-a",[event(1),event(2),event(3),event(4)]).map(e=>e.id),[4]);
});
test("Changing rooms and silent replay never backfill old announcements", () => {
  const c = new EventCursor();c.read("a",[]);
  assert.deepEqual(c.read("b",[event(1),event(2)]),[]);
  assert.deepEqual(c.read("b",[event(1),event(2),event(3)],true),[]);
  assert.deepEqual(c.read("b",[event(1),event(2),event(3)]),[]);
  assert.deepEqual(c.read("b",[event(1),event(2),event(3),event(4)]).map(e=>e.id),[4]);
});
test("Speech serializes multi-win batches and selects an available local Chinese voice", () => {
  const f=fakeSpeech(), v=new VoiceAnnouncer(f.platform);
  try {
    v.announce(event(1));v.announce(event(2,"win"));v.announce(event(3,"win"));
    assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].voice,f.voices[2]);assert.equal(f.spoken[0].lang,"zh-CN");
    f.end();assert.equal(f.spoken[1].text,"胡");f.end();assert.equal(f.spoken[2].text,"胡");f.end();
    assert.equal(f.spoken.length,3);
    assert.equal(chineseVoice([f.voices[0]]),undefined);
  } finally {v.stop();}
});
test("Fast discard backlog is bounded without losing queued wins", () => {
  const f=fakeSpeech(), v=new VoiceAnnouncer(f.platform);
  try {
    v.announce(event(1));v.announce(event(2,"win"));
    for(let i=3;i<100;i++)v.announce(event(i,"discard",i%27));
    while(f.spoken.length<9){const n=f.spoken.length;f.end();if(f.spoken.length===n)break;}
    assert.equal(f.spoken.filter(u=>u.text==="胡").length,1);
    assert.ok(f.spoken.length<=9);
  }finally{v.stop();}
});
test("Mute stops active and queued speech; stale callbacks cannot resurrect it", () => {
  const f=fakeSpeech(),v=new VoiceAnnouncer(f.platform);
  v.announce(event(1));v.announce(event(2,"pung"));const old=f.spoken[0];v.stop();
  old.onend?.call(old,{} as SpeechSynthesisEvent);assert.equal(f.spoken.length,1);assert.equal(f.cancelled,1);
  v.announce(event(3,"win"));old.onend?.call(old,{} as SpeechSynthesisEvent);assert.equal(f.spoken.length,2);
  v.stop();
});
test("Unsupported or broken speech platforms never interrupt gameplay", () => {
  const absent=new VoiceAnnouncer(null);assert.equal(absent.supported,false);assert.doesNotThrow(()=>absent.announce(event(1)));
  const f=fakeSpeech(true);let errors=0;const v=new VoiceAnnouncer(f.platform,()=>errors++);
  assert.doesNotThrow(()=>v.announce(event(1)));assert.equal(errors,1);v.stop();
  const working=fakeSpeech(),w=new VoiceAnnouncer(working.platform,()=>errors++);
  w.announce(event(1));w.announce(event(2));working.spoken[0].onerror?.call(working.spoken[0],{} as SpeechSynthesisErrorEvent);
  assert.equal(working.spoken.length,1);assert.equal(errors,2);w.stop();
});
test("Available natural female voices outrank compact local voices and male neural voices", () => {
  const voices = [
    { name: "Ting-Ting (Compact)", voiceURI: "tt", lang: "zh-CN", localService: true },
    { name: "Microsoft Yunxi Online (Natural)", voiceURI: "yx", lang: "zh-CN", localService: false },
    { name: "Microsoft Xiaoxiao Online (Natural)", voiceURI: "xx", lang: "zh-CN", localService: false },
    { name: "English female", voiceURI: "en", lang: "en-US", localService: true },
  ] as SpeechSynthesisVoice[];
  assert.equal(chineseVoice(voices), voices[2]);
  assert.equal(voiceKind(voices[2]),"female");assert.equal(voiceKind(voices[1]),"male");
  assert.equal(voiceKind({name:"Generic Chinese",lang:"zh-CN"} as SpeechSynthesisVoice),"unknown");
  assert.equal(chineseVoices([...voices, voices[0]]).length,3);
});
test("Enhanced female voices are preferred and persisted choices fall back when unavailable", () => {
  const basic={name:"Ting-Ting",voiceURI:"basic",lang:"zh-CN",localService:true} as SpeechSynthesisVoice;
  const enhanced={...basic,name:"Ting-Ting (Enhanced)",voiceURI:"enhanced"};
  assert.equal(chineseVoice([basic,enhanced]),enhanced);
  assert.equal(chineseVoice([basic,enhanced],voiceId(basic)),basic);
  assert.equal(chineseVoice([basic,enhanced],"missing"),enhanced);
});
test("Gentle speech uses chosen voice, native pitch and a slower configurable rate", () => {
  const f=fakeSpeech(),v=new VoiceAnnouncer(f.platform);
  try {
    v.configure(voiceId(f.voices[1]),.85);v.announce(event(1));
    assert.equal(f.spoken[0].voice,f.voices[1]);assert.equal(f.spoken[0].rate,.85);
    assert.equal(f.spoken[0].pitch,1);assert.equal(f.spoken[0].volume,.8);
    f.end();v.configure(voiceId(f.voices[1]),NaN);v.announce(event(2));assert.equal(f.spoken[1].rate,.92);
    f.end();v.configure(voiceId(f.voices[1]),3);v.announce(event(3));assert.equal(f.spoken[2].rate,1.15);
  } finally {v.stop();}
});
