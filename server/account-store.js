import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGame, validateProfile } from '../src/simulation.js';
import * as economy from '../src/economy.js';
import { MAX_LOADOUT_MEDKITS } from '../src/loadouts.js';

const scrypt = promisify(scryptCallback);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SOCIAL_LIMIT = 100;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
const optionalItem = value => value === null || text(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const ACTIONS = {
  economy: {
    storeItem: args => args.length === 1 && text(args[0]),
    storeAll: args => args.length === 0,
    listItem: args => args.length === 3 && text(args[0]) && Number.isInteger(args[1]) && args[1] >= 1 && args[1] <= 1_000_000 && economy.MARKET_DURATIONS.includes(args[2]),
    cancelListing: args => args.length === 1 && text(args[0]),
    claimMail: args => args.length === 1 && text(args[0]),
    claimAll: args => args.length === 0,
  },
  game: {
    buyUpgrade: args => args.length === 1 && text(args[0]),
    selectWeapon: args => args.length === 1 && text(args[0]),
    selectLoadout: args => args.length === 1 && exact(args[0], ['mode', 'presetId']) && ['preset', 'custom'].includes(args[0].mode) && (args[0].presetId === undefined || text(args[0].presetId)),
    purchaseEquipment: args => args.length === 1 && text(args[0]),
    equipLoadout: args => args.length === 2 && text(args[0]) && (args[0] === 'medkits' ? Number.isInteger(args[1]) && args[1] >= 0 && args[1] <= MAX_LOADOUT_MEDKITS : optionalItem(args[1])),
    mountAttachment: args => args.length === 3 && text(args[0]) && text(args[1]) && optionalItem(args[2]),
    unlockSkill: args => args.length === 1 && text(args[0]),
  },
};

export class AccountError extends Error {
  constructor(status, code, message) { super(message); this.name = 'AccountError'; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AccountError(status, code, message); };
const busy = () => fail(409, 'account_busy', 'Dein Account ist bereits in einer Lobby oder einem Raid aktiv.');
function credentials(username, password) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(name) || typeof password !== 'string' || password.length < 10 || password.length > 128) {
    fail(400, 'invalid_credentials', 'Name: 3–24 Buchstaben, Zahlen, _ oder -. Passwort: 10–128 Zeichen.');
  }
  return { name, key: name.toLowerCase() };
}

// This module is trusted server code. Only the action allowlist reaches it from HTTP;
// raid profiles come exclusively from the authoritative server simulation.
export function createAccountStore({ path, now = Date.now } = {}) {
  if (!path) throw new TypeError('An account database path is required');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:' && process.platform !== 'win32') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, profile TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS room_locks (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), room_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS raid_entries (
      room_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
      status TEXT NOT NULL CHECK(status IN ('started','settled')), outcome TEXT,
      started_at INTEGER NOT NULL, settled_at INTEGER, PRIMARY KEY(room_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS social_links (
      account_a TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      account_b TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK(account_a < account_b), CHECK(requested_by IN (account_a,account_b)),
      PRIMARY KEY(account_a, account_b)
    );
    CREATE INDEX IF NOT EXISTS social_links_b ON social_links(account_b);`);
  const pending = new Set();
  const dummySalt = randomBytes(16).toString('hex');
  let hashes = 0, hubPromise, hubGame;
  const query = sql => db.prepare(sql);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function account(id) {
    const row = query('SELECT * FROM accounts WHERE id=?').get(id);
    if (!row) fail(401, 'unauthorized', 'Bitte erneut anmelden.');
    return row;
  }
  const profileOf = row => validateProfile(JSON.parse(row.profile));
  const lockOf = id => query('SELECT room_id FROM room_locks WHERE account_id=?').get(id);
  function saveProfile(id, profile) {
    query('UPDATE accounts SET profile=?, revision=revision+1 WHERE id=?').run(JSON.stringify(validateProfile(profile)), id);
  }
  async function derive(password, salt) {
    if (hashes >= 4) fail(429, 'auth_busy', 'Zu viele Anmeldungen. Bitte gleich erneut versuchen.');
    hashes++;
    try { return await scrypt(password, salt, 64, SCRYPT_OPTIONS); }
    finally { hashes--; }
  }
  function issueSession(row) {
    const token = randomBytes(32).toString('hex'), expiresAt = now() + SESSION_MS;
    transaction(() => {
      query('DELETE FROM sessions WHERE expires_at<=?').run(now());
      // Keep a bounded set of devices; the newest login is never evicted.
      const old = query('SELECT token_hash FROM sessions WHERE account_id=? ORDER BY created_at DESC').all(row.id).slice(7);
      for (const entry of old) query('DELETE FROM sessions WHERE token_hash=?').run(entry.token_hash);
      query('INSERT INTO sessions(token_hash,account_id,expires_at,created_at) VALUES(?,?,?,?)').run(tokenHash(token), row.id, expiresAt, now());
    });
    return { token, expiresAt, user: { id: row.id, username: row.username }, profile: getProfile(row.id) };
  }
  async function register(username, password) {
    const { name, key } = credentials(username, password), salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt), id = randomBytes(16).toString('hex');
    try {
      query('INSERT INTO accounts(id,username,name_key,password_salt,password_hash,profile,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, name, key, salt, hash.toString('hex'), JSON.stringify(validateProfile(null)), now());
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint')) fail(409, 'registration_unavailable', 'Dieser Benutzername ist nicht verfügbar.');
      throw error;
    }
    return issueSession(account(id));
  }
  async function login(username, password) {
    // Unknown names perform the same password work and return the same error.
    const key = typeof username === 'string' && username.length <= 100 ? username.trim().toLowerCase() : '';
    const row = query('SELECT * FROM accounts WHERE name_key=?').get(key);
    const input = typeof password === 'string' && password.length <= 128 ? password : '';
    const derived = await derive(input, row?.password_salt ?? dummySalt);
    const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(derived, expected) || !row || input.length < 10 || account(row.id).password_hash !== row.password_hash) fail(401, 'login_failed', 'Benutzername oder Passwort ist falsch.');
    return issueSession(row);
  }
  async function resetPassword(username, password) {
    const { key } = credentials(username, password);
    const row = query('SELECT id,username FROM accounts WHERE name_key=?').get(key);
    if (!row) fail(404, 'account_not_found', 'Account wurde nicht gefunden.');
    const salt = randomBytes(16).toString('hex'), hash = await derive(password, salt);
    const revokedSessions = transaction(() => {
      query('UPDATE accounts SET password_salt=?,password_hash=? WHERE id=?').run(salt, hash.toString('hex'), row.id);
      return query('DELETE FROM sessions WHERE account_id=?').run(row.id).changes;
    });
    return { id: row.id, username: row.username, revokedSessions };
  }
  function revokeSessions(id) { account(id); return query('DELETE FROM sessions WHERE account_id=?').run(id).changes; }
  function authenticate(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = query('SELECT a.id,a.username FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(token), now());
    return row ? { id: row.id, username: row.username } : null;
  }
  function logout(token) {
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) query('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    return true;
  }
  const accountId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  function socialPair(actorId, otherId) {
    account(actorId);
    if (!accountId(otherId) || actorId === otherId) fail(400, 'invalid_friend', 'Ungültiger Spieler.');
    return [actorId, otherId].sort();
  }
  function socialCount(id, status) {
    return query('SELECT COUNT(*) AS count FROM social_links WHERE (account_a=? OR account_b=?) AND status=?').get(id, id, status).count;
  }
  function socialCapacity(first, second, status) {
    if (socialCount(first, status) >= SOCIAL_LIMIT || socialCount(second, status) >= SOCIAL_LIMIT) {
      fail(409, 'social_limit', status === 'accepted' ? 'Die Freundesliste eines Spielers ist voll (100 Freunde).' : 'Zu viele offene Freundesanfragen. Bitte zuerst Anfragen bearbeiten.');
    }
  }
  function social(id) {
    account(id);
    const result = { friends: [], incoming: [], outgoing: [] };
    const rows = query(`SELECT a.id,a.username,s.status,s.requested_by FROM social_links s
      JOIN accounts a ON a.id=CASE WHEN s.account_a=? THEN s.account_b ELSE s.account_a END
      WHERE s.account_a=? OR s.account_b=? ORDER BY a.name_key,a.id`).all(id, id, id);
    for (const row of rows) {
      const bucket = row.status === 'accepted' ? 'friends' : row.requested_by === id ? 'outgoing' : 'incoming';
      result[bucket].push({ id: row.id, username: row.username });
    }
    return result;
  }
  function areFriends(first, second) {
    if (!accountId(first) || !accountId(second) || first === second) return false;
    return !!query("SELECT 1 FROM social_links WHERE account_a=? AND account_b=? AND status='accepted'").get(...[first, second].sort());
  }
  function requestFriend(actorId, username) {
    account(actorId);
    const name = typeof username === 'string' ? username.trim() : '';
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(name)) fail(400, 'invalid_friend_name', 'Rufname: 3–24 Buchstaben, Zahlen, _ oder -.');
    const other = query('SELECT id FROM accounts WHERE name_key=?').get(name.toLowerCase());
    if (!other) fail(404, 'friend_not_found', 'Kein Spieler mit diesem genauen Rufnamen gefunden.');
    const pair = socialPair(actorId, other.id);
    return transaction(() => {
      const existing = query('SELECT status,requested_by FROM social_links WHERE account_a=? AND account_b=?').get(...pair);
      if (existing?.status === 'accepted' || existing?.requested_by === actorId) return false;
      if (existing) {
        // Two explicit requests express mutual consent; crossed requests become
        // one friendship instead of creating duplicate directional records.
        socialCapacity(actorId, other.id, 'accepted');
        query("UPDATE social_links SET status='accepted',updated_at=? WHERE account_a=? AND account_b=?").run(now(), ...pair);
      } else {
        socialCapacity(actorId, other.id, 'pending');
        query("INSERT INTO social_links(account_a,account_b,requested_by,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").run(...pair, actorId, now(), now());
      }
      return true;
    });
  }
  function respondFriend(actorId, otherId, accept) {
    if (typeof accept !== 'boolean') fail(400, 'invalid_response', 'Annehmen oder Ablehnen muss angegeben werden.');
    const pair = socialPair(actorId, otherId);
    return transaction(() => {
      const existing = query('SELECT status,requested_by FROM social_links WHERE account_a=? AND account_b=?').get(...pair);
      if (existing?.status === 'accepted' && accept) return false;
      if (!existing || existing.status !== 'pending' || existing.requested_by === actorId) fail(404, 'friend_request_missing', 'Diese eingehende Freundesanfrage ist nicht mehr verfügbar.');
      if (accept) {
        socialCapacity(actorId, otherId, 'accepted');
        query("UPDATE social_links SET status='accepted',updated_at=? WHERE account_a=? AND account_b=?").run(now(), ...pair);
      } else query('DELETE FROM social_links WHERE account_a=? AND account_b=?').run(...pair);
      return true;
    });
  }
  function removeFriend(actorId, otherId) {
    const pair = socialPair(actorId, otherId);
    return transaction(() => {
      const existing = query('SELECT status,requested_by FROM social_links WHERE account_a=? AND account_b=?').get(...pair);
      if (!existing) return false;
      if (existing.status === 'pending' && existing.requested_by !== actorId) fail(409, 'incoming_request', 'Eine eingehende Anfrage bitte annehmen oder ablehnen.');
      query('DELETE FROM social_links WHERE account_a=? AND account_b=?').run(...pair);
      return true;
    });
  }
  function getProfile(id) {
    return transaction(() => {
      const profile = profileOf(account(id));
      if (!lockOf(id) && !pending.has(id)) { economy.advanceMarket(profile, now()); saveProfile(id, profile); }
      return profile;
    });
  }
  async function action(id, request) {
    if (!exact(request, ['kind', 'action', 'args']) || typeof request.kind !== 'string' || typeof request.action !== 'string' || !Object.hasOwn(ACTIONS, request.kind) ||
      !Object.hasOwn(ACTIONS[request.kind], request.action) || !Array.isArray(request.args) || !ACTIONS[request.kind][request.action](request.args)) {
      fail(400, 'invalid_action', 'Ungültige Aktion.');
    }
    if (pending.has(id) || lockOf(id)) busy();
    const profile = getProfile(id);
    pending.add(id);
    let game;
    try {
      let result;
      if (request.kind === 'economy') {
        const args = [...request.args];
        if (['listItem', 'cancelListing'].includes(request.action)) args.push(now());
        result = economy[request.action](profile, ...args);
      } else {
        // One idle hub controller reuses the canonical game actions without
        // rebuilding the full terrain/physics world on every shop click.
        hubPromise ??= createGame(null, { externalAI: true }).then(value => (hubGame = value));
        game = await hubPromise;
        game.state.profile = profile;
        result = game[request.action](...request.args);
      }
      const finalProfile = validateProfile(game ? game.state.profile : profile);
      transaction(() => { if (lockOf(id)) busy(); account(id); saveProfile(id, finalProfile); });
      return { ok: result !== false, result: result !== false, profile: finalProfile };
    } finally { game?.drainEvents(); pending.delete(id); }
  }
  function acquireRoom(id, roomId) {
    if (!text(roomId)) throw new TypeError('Invalid room ID');
    if (pending.has(id)) busy();
    return transaction(() => {
      const row = account(id);
      if (lockOf(id)) busy();
      const profile = profileOf(row); economy.advanceMarket(profile, now()); saveProfile(id, profile);
      query('INSERT INTO room_locks(account_id,room_id,created_at) VALUES(?,?,?)').run(id, roomId, now());
      return profile;
    });
  }
  function releaseRoom(id, roomId) {
    return transaction(() => {
      if (query("SELECT 1 FROM raid_entries WHERE room_id=? AND account_id=? AND status='started'").get(roomId, id)) busy();
      return query('DELETE FROM room_locks WHERE account_id=? AND room_id=?').run(id, roomId).changes > 0;
    });
  }
  function commitRaidStart(roomId, participants) {
    if (!text(roomId) || !Array.isArray(participants) || !participants.length || participants.length > 2 || participants.some(p => !p || !text(p.accountId) || !p.profile || typeof p.profile !== 'object' || !Number.isFinite(p.profile.credits)) || new Set(participants.map(p => p.accountId)).size !== participants.length) throw new TypeError('Invalid raid participants');
    return transaction(() => {
      const existing = query('SELECT account_id,status FROM raid_entries WHERE room_id=?').all(roomId);
      if (existing.length) {
        if (existing.length === participants.length && existing.every(row => participants.some(p => p.accountId === row.account_id))) return false;
        busy();
      }
      const locks = query('SELECT account_id FROM room_locks WHERE room_id=?').all(roomId);
      if (locks.length !== participants.length || participants.some(p => lockOf(p.accountId)?.room_id !== roomId || pending.has(p.accountId))) busy();
      for (const participant of participants) {
        saveProfile(participant.accountId, participant.profile);
        query("INSERT INTO raid_entries(room_id,account_id,status,started_at) VALUES(?,?,'started',?)").run(roomId, participant.accountId, now());
      }
      return true;
    });
  }
  function settleRaid(id, roomId, profile, outcome) {
    if (!profile || typeof profile !== 'object' || !Number.isFinite(profile.credits)) throw new TypeError('Invalid raid profile');
    if (!['death', 'dead', 'disconnect', 'extracted', 'aborted', 'server_restart'].includes(outcome)) throw new TypeError('Invalid raid outcome');
    return transaction(() => {
      const entry = query('SELECT status FROM raid_entries WHERE room_id=? AND account_id=?').get(roomId, id);
      if (!entry || entry.status === 'settled') return false;
      if (lockOf(id)?.room_id !== roomId) busy();
      const clean = validateProfile(profile); economy.advanceMarket(clean, now()); saveProfile(id, clean);
      query("UPDATE raid_entries SET status='settled',outcome=?,settled_at=? WHERE room_id=? AND account_id=?").run(outcome, now(), roomId, id);
      query('DELETE FROM room_locks WHERE account_id=? AND room_id=?').run(id, roomId);
      return true;
    });
  }
  function recoverRooms() {
    return transaction(() => {
      const count = query('SELECT COUNT(*) AS count FROM room_locks').get().count;
      query("UPDATE raid_entries SET status='settled',outcome='server_restart',settled_at=? WHERE status='started'").run(now());
      query('DELETE FROM room_locks').run();
      return count;
    });
  }
  function abortRoom(roomId) {
    if (!text(roomId)) throw new TypeError('Invalid room ID');
    return transaction(() => {
      // A failed simulation/save may not supply trustworthy final state. Keep
      // the already committed costs and inventory, and clear this room only.
      query("UPDATE raid_entries SET status='settled',outcome='aborted',settled_at=? WHERE room_id=? AND status='started'").run(now(), roomId);
      return query('DELETE FROM room_locks WHERE room_id=?').run(roomId).changes;
    });
  }
  return { register, login, authenticate, logout, resetPassword, revokeSessions, social, areFriends, requestFriend, respondFriend, removeFriend,
    getProfile, action, acquireRoom, releaseRoom, commitRaidStart, settleRaid, recoverRooms, abortRoom,
    close() { hubGame?.dispose(); db.close(); } };
}
