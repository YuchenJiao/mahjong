import type { RoomRecord, RoomStore } from "./rooms";
export class MemoryRoomStore implements RoomStore {
  records = new Map<string, RoomRecord>();
  async load(id: string) { return this.records.has(id) ? structuredClone(this.records.get(id)!) : null; }
  async save(r: RoomRecord, expected: number) {
    if ((this.records.get(r.id)?.version ?? -1) !== expected) return false;
    this.records.set(r.id, structuredClone(r)); return true;
  }
  async prune(now: number) { for (const [id, r] of this.records) if (r.expires <= now) this.records.delete(id); }
  async count() { return this.records.size; }
}
