// Storage for the HQ board. Two implementations with the same methods:
// PgStore (Postgres, used in production) and MemoryStore (tests only).

const SCHEMA = `
create table if not exists hq_sessions (
  token_hash text primary key,
  name text not null,
  code_fp text not null,
  expires_at timestamptz not null
);
create table if not exists hq_items (
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (kind, id)
);
create table if not exists hq_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  who text not null,
  text text not null
);
`;

export class PgStore {
  constructor(pool) {
    this.pool = pool;
  }

  static async connect(connectionString) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30000 });
    // An idle client dropped by the database must not crash the server.
    pool.on('error', (err) => console.error('pg pool error:', err.message));
    return new PgStore(pool);
  }

  async init() {
    await this.pool.query(SCHEMA);
  }

  // A session is one remembered device. codeFp ties it to the passcode in force
  // when it was created, so changing the passcode signs every device out.
  async createSession(tokenHash, name, codeFp, expiresAt) {
    await this.pool.query(
      'insert into hq_sessions (token_hash, name, code_fp, expires_at) values ($1, $2, $3, $4)',
      [tokenHash, name, codeFp, expiresAt]
    );
    await this.pool.query('delete from hq_sessions where expires_at < now()');
  }

  async getSession(tokenHash) {
    const r = await this.pool.query(
      'select name, code_fp from hq_sessions where token_hash = $1 and expires_at > now()',
      [tokenHash]
    );
    return r.rows[0] || null;
  }

  async deleteSession(tokenHash) {
    await this.pool.query('delete from hq_sessions where token_hash = $1', [tokenHash]);
  }

  async listItems() {
    const r = await this.pool.query('select kind, id, data from hq_items order by kind, id');
    return r.rows;
  }

  async getItem(kind, id) {
    const r = await this.pool.query('select data from hq_items where kind = $1 and id = $2', [kind, id]);
    return r.rows[0] ? r.rows[0].data : null;
  }

  // Activity log: one short line per change, newest 500 kept.
  async addLog(who, text) {
    await this.pool.query('insert into hq_log (who, text) values ($1, $2)', [who, text]);
    await this.pool.query('delete from hq_log where id <= (select max(id) from hq_log) - 500');
  }

  async listLog(limit) {
    const r = await this.pool.query('select at, who, text from hq_log order by id desc limit $1', [limit]);
    return r.rows.map((x) => ({ at: new Date(x.at).toISOString(), who: x.who, text: x.text }));
  }

  async putItem(kind, id, data, by) {
    await this.pool.query(
      `insert into hq_items (kind, id, data, updated_by) values ($1, $2, $3::jsonb, $4)
       on conflict (kind, id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by`,
      [kind, id, JSON.stringify(data), by]
    );
  }

  // Shallow-merges patch into the item. Returns false if the item does not exist.
  async mergeItem(kind, id, patch, by) {
    const r = await this.pool.query(
      `update hq_items set data = data || $3::jsonb, updated_at = now(), updated_by = $4
       where kind = $1 and id = $2`,
      [kind, id, JSON.stringify(patch), by]
    );
    return r.rowCount === 1;
  }

  async deleteItem(kind, id) {
    await this.pool.query('delete from hq_items where kind = $1 and id = $2', [kind, id]);
  }
}

export class MemoryStore {
  constructor() {
    this.sessions = new Map();
    this.items = new Map();
  }
  async init() {}
  async createSession(tokenHash, name, codeFp, expiresAt) {
    this.sessions.set(tokenHash, { name, code_fp: codeFp, expiresAt });
  }
  async getSession(tokenHash) {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt < new Date()) return null;
    return { name: s.name, code_fp: s.code_fp };
  }
  async deleteSession(tokenHash) {
    this.sessions.delete(tokenHash);
  }
  async listItems() {
    return [...this.items.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, data]) => {
        const i = k.indexOf('/');
        return { kind: k.slice(0, i), id: k.slice(i + 1), data };
      });
  }
  async getItem(kind, id) {
    const v = this.items.get(kind + '/' + id);
    return v ? { ...v } : null;
  }
  async addLog(who, text) {
    this.log = this.log || [];
    this.log.push({ at: new Date().toISOString(), who, text });
    if (this.log.length > 500) this.log.shift();
  }
  async listLog(limit) {
    return (this.log || []).slice(-limit).reverse();
  }
  async putItem(kind, id, data) {
    this.items.set(kind + '/' + id, { ...data });
  }
  async mergeItem(kind, id, patch) {
    const k = kind + '/' + id;
    if (!this.items.has(k)) return false;
    this.items.set(k, { ...this.items.get(k), ...patch });
    return true;
  }
  async deleteItem(kind, id) {
    this.items.delete(kind + '/' + id);
  }
}
