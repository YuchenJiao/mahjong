import { useEffect, useRef } from "react";
import type { TableEvent } from "../engine/types";
import { tileName } from "../engine/core";
import { Tile } from "../Tile";
import { eventLabel } from "./events";

// Cancel transient effects before the next event. Animation never creates or
// removes nodes and never retains a finished frame in the compositor.
export function transientAnimation(element: HTMLElement | null, frames: Keyframe[], duration: number) {
  if (!element?.animate || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)) return () => {};
  try {
    const animation = element.animate(frames, { duration, easing: "ease-out", fill: "none" });
    return () => animation.cancel();
  } catch { return () => {}; }
}

export function CenterFeedback({ mode, activity, actorName, tile, caption, eventKey, tileKey, replay = false }: {
  mode: "sichuan" | "mcr";
  activity: TableEvent | null;
  actorName: string;
  tile?: number;
  caption: string;
  eventKey: string;
  tileKey: string;
  replay?: boolean;
}) {
  const bubble = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activity || replay) return;
    return transientAnimation(bubble.current, [{ opacity: .2, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)" }], 180);
  }, [eventKey, !!activity, replay]);
  useEffect(() => {
    if (tile === undefined || replay) return;
    return transientAnimation(card.current, [{ opacity: .3, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)" }], 220);
  }, [tileKey, tile, replay]);
  return <div className="center-marker notranslate" translate="no">
    <span className="mode-seal">{mode === "sichuan" ? "川" : "国"}</span>
    <div className="event-slot">
      <div ref={bubble} className={`event-bubble ${activity ? "is-visible" : ""} ${activity?.kind === "win" ? "event-win" : ""}`} aria-hidden={!activity}>
        <small>{activity ? actorName : ""}</small>
        <strong>{activity ? eventLabel(activity) : ""}</strong>
      </div>
    </div>
    <p>{caption}</p>
    <div ref={card} className={`last-discard ${tile === undefined ? "is-empty" : ""}`} aria-hidden={tile === undefined}>
      <Tile tile={tile} />
      <b>{tile === undefined ? "" : tileName(tile)}</b>
    </div>
  </div>;
}
