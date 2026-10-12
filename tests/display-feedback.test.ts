import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CenterFeedback, transientAnimation } from "../src/feedback/CenterFeedback";
import type { TableEvent } from "../src/engine/types";

test("Center renders one bounded event slot and one card for rapid updates, expiry and replay", () => {
  for(let i=0;i<80;i++) {
    const activity:TableEvent|null=i%5===0?null:{id:i,actor:i%4,kind:i%7===0?"win":"discard",tile:i%34};
    const markup=renderToStaticMarkup(createElement(CenterFeedback,{mode:"mcr",activity,actorName:"月白",tile:i%3===0?undefined:i%34,caption:"当前出牌",eventKey:String(i),tileKey:String(i),replay:i>70}));
    assert.equal((markup.match(/class="event-slot"/g)??[]).length,1);
    assert.equal((markup.match(/class="event-bubble /g)??[]).length,1);
    assert.equal((markup.match(/class="last-discard /g)??[]).length,1);
    assert.ok(markup.includes('translate="no"'));
    if(!activity)assert.ok(markup.includes('event-bubble  " aria-hidden="true"'));
  }
});
test("Transient animation retains no finished frames and explicitly cancels on replacement", () => {
  let cancelled=0;let options:KeyframeAnimationOptions|undefined;
  const el={animate(_frames:Keyframe[],o:KeyframeAnimationOptions){options=o;return {cancel(){cancelled++;}};}} as unknown as HTMLElement;
  const cleanup=transientAnimation(el,[{opacity:0},{opacity:1}],180);
  assert.equal(options?.fill,"none");assert.equal(options?.duration,180);
  cleanup();assert.equal(cancelled,1);
  assert.doesNotThrow(()=>transientAnimation(null,[],180)());
  assert.doesNotThrow(()=>transientAnimation({animate(){throw Error("unsupported");}} as unknown as HTMLElement,[],180)());
});
