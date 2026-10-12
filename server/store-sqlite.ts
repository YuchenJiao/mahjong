import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RoomRecord, RoomStore } from "./rooms";
export class SqliteRoomStore implements RoomStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, version INTEGER NOT NULL, expires INTEGER NOT NULL, data TEXT NOT NULL)");
  }
  async load(id: string) {
    const row = this.db.prepare("SELECT data FROM rooms WHERE id = ?").get(id);
    return row ? JSON.parse(row.data as string) as RoomRecord : null;
  }
  async save(r: RoomRecord, expected: number) {
    const result = expected < 0
      ? this.db.prepare("INSERT OR IGNORE INTO rooms (id,version,expires,data) VALUES (?,?,?,?)").run(r.id, r.version, r.expires, JSON.stringify(r))
      : this.db.prepare("UPDATE rooms SET version=?, expires=?, data=? WHERE id=? AND version=?").run(r.version, r.expires, JSON.stringify(r), r.id, expected);
    return result.changes === 1;
  }
  async prune(now: number) { this.db.prepare("DELETE FROM rooms WHERE expires <= ?").run(now); }
  async count() { return Number(this.db.prepare("SELECT count(*) AS n FROM rooms").get()!.n); }
  close() { this.db.close(); }
}
