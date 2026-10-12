import type { TableEvent } from "../engine/types";
import { tileName } from "../engine/core";

export const eventLabel = (event: TableEvent) => ({ discard: "出牌", chow: "吃", pung: "碰", kong: "杠", win: event.self ? "自摸" : "胡" })[event.kind];
export function eventSpeech(event: TableEvent): string {
  if (event.kind !== "discard") return event.kind === "win" && event.self ? "自摸，胡" : eventLabel(event);
  if (event.tile === undefined || event.tile < 0 || event.tile > 33) return "";
  const name = tileName(event.tile).replace(/[1-9]/g, n => "一二三四五六七八九"[Number(n) - 1]);
  return ({ 东: "东风", 南: "南风", 西: "西风", 北: "北风", 中: "红中", 发: "发财", 白: "白板" } as Record<string, string>)[name] ?? name;
}

// Start at the live edge on mount/room change. Refresh, replay and repeated polls
// must not announce the history. IDs also survive a batched HTTP update.
export class EventCursor {
  private stream: string | undefined;
  private last = 0;
  read(stream: string, events: readonly TableEvent[], silent = false): TableEvent[] {
    const newest = events.at(-1)?.id ?? 0;
    if (this.stream !== stream) {
      this.stream = stream;
      this.last = newest;
      return [];
    }
    if (newest < this.last) return []; // Late polls cannot rewind the cursor.
    const fresh = events.filter(e => e.id > this.last);
    this.last = newest;
    return silent ? [] : fresh;
  }
}
