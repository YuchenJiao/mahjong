import type { RoomRecord, RoomStore } from "./rooms";
type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null>; run(): Promise<{ meta: { changes: number } }> };
export type Database = { prepare(sql: string): Statement; withSession?: (constraint: string) => Database };
export class D1RoomStore implements RoomStore {
  private db: Database;
  constructor(db: Database) { this.db = db.withSession ? db.withSession("first-primary") : db; }
  async load(id: string) {
    const row = await this.db.prepare("SELECT data FROM rooms WHERE id = ?").bind(id).first<{ data: string }>();
    return row ? JSON.parse(row.data) as RoomRecord : null;
  }
  async save(r: RoomRecord, expected: number) {
    const result = expected < 0
      ? await this.db.prepare("INSERT OR IGNORE INTO rooms (id,version,expires,data) VALUES (?,?,?,?)").bind(r.id, r.version, r.expires, JSON.stringify(r)).run()
      : await this.db.prepare("UPDATE rooms SET version=?, expires=?, data=? WHERE id=? AND version=?").bind(r.version, r.expires, JSON.stringify(r), r.id, expected).run();
    return result.meta.changes === 1;
  }
  async prune(now: number) { await this.db.prepare("DELETE FROM rooms WHERE expires <= ?").bind(now).run(); }
  async count() { return (await this.db.prepare("SELECT count(*) AS n FROM rooms").first<{ n: number }>())!.n; }
}
