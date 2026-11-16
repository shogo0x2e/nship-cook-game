import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SessionError, strictObject } from './session-store.ts';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const parameters = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
export type Account = { id: string; username: string };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
function credentials(value: unknown) {
  const { username, password } = strictObject(value, ['username', 'password']);
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) throw new SessionError(400, 'Username must be 3-32 letters, digits, _ or -');
  if (typeof password !== 'string' || [...password].length < 4 || [...password].length > 128 || Buffer.byteLength(password) > 512) throw new SessionError(400, 'Password must be 4-128 characters');
  return { username: username.toLowerCase(), password };
}
const hash = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key)));

export class AccountStore {
  readonly db: DatabaseSync;
  private hashing = 0;
  private now: () => number;
  constructor(path = ':memory:', now: () => number = Date.now) {
    this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS families(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, state TEXT NOT NULL);`);
  }
  private async derive(password: string, salt: string) {
    if (this.hashing >= 2) throw new SessionError(429, 'Try again later');
    this.hashing++;
    try { return await hash(password, salt); } finally { this.hashing--; }
  }
  private session(account: Account) {
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(this.now());
    // Keep a bounded number of sessions for a household without storing raw cookies.
    this.db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id = ? ORDER BY expires DESC LIMIT 19)').run(account.id, account.id);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), account.id, this.now() + SESSION_MS);
    return { account, token };
  }
  async register(value: unknown) {
    const { username, password } = credentials(value);
    if ((this.db.prepare('SELECT count(*) AS n FROM accounts').get() as { n: number }).n >= 1000) throw new SessionError(503, 'Account capacity reached');
    const salt = randomBytes(16).toString('hex'), key = await this.derive(password, salt);
    const account = { id: randomUUID(), username };
    try { this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(account.id, username, salt, key.toString('hex')); }
    catch (error) { if (this.db.prepare('SELECT id FROM accounts WHERE username=?').get(username)) throw new SessionError(409, 'Username unavailable'); throw error; }
    return this.session(account);
  }
  async login(value: unknown) {
    const { username, password } = credentials(value);
    const row = this.db.prepare('SELECT * FROM accounts WHERE username=?').get(username) as (Account & { salt: string; password_hash: string }) | undefined;
    const actual = await this.derive(password, row?.salt ?? '6d6f67756d6f67752d64756d6d792d73616c74');
    const expected = Buffer.from(row?.password_hash ?? '00'.repeat(64), 'hex');
    if (!timingSafeEqual(actual, expected) || !row) throw new SessionError(401, 'Invalid username or password');
    return this.session({ id: row.id, username: row.username });
  }
  authenticate(token: string | undefined): Account {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new SessionError(401, 'Login required');
    const row = this.db.prepare('SELECT a.id,a.username,s.expires FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=?').get(digest(token)) as (Account & { expires: number }) | undefined;
    if (!row || row.expires <= this.now()) throw new SessionError(401, 'Login required');
    return { id: row.id, username: row.username };
  }
  logout(token: string | undefined) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }
  async resetPassword(username: string, password: string) {
    const parsed = credentials({ username, password });
    const salt = randomBytes(16).toString('hex'), key = await this.derive(parsed.password, salt);
    const account = this.db.prepare('SELECT id FROM accounts WHERE username=?').get(parsed.username) as { id: string } | undefined;
    if (!account) throw new SessionError(404, 'Account not found');
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=?').run(salt, key.toString('hex'), account.id); this.db.prepare('DELETE FROM sessions WHERE account_id=?').run(account.id); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
