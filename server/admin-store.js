import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createAccountStore, AccountError } from './account-store.js';
import { validateProfile } from '../src/simulation.js';
import { createItem, ECONOMY_BALANCE } from '../src/economy.js';
import { SHOP_ITEMS, makeCatalogItem, repairLoadoutReferences } from '../src/loadouts.js';
import { ITEM_CATALOG } from '../src/loot-catalog.js';

const scrypt = promisify(scryptCallback);
const SESSION_MS = 30 * 60_000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashToken = value => createHash('sha256').update(value).digest('hex');
const tokenValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const idValid = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const short = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const userOnly = payload => exact(payload, ['userId']) && idValid(payload.userId);
const userAmount = (min, max) => payload => exact(payload, ['userId', 'amount']) && idValid(payload.userId) && integer(payload.amount, min, max);
const roomOnly = payload => exact(payload, ['roomId']) && short(payload.roomId);
const toggle = payload => exact(payload, ['userId', 'enabled']) && idValid(payload.userId) && typeof payload.enabled === 'boolean';
const fail = (status, code, message) => { throw new AccountError(status, code, message); };

export const ADMIN_ACTIONS = Object.freeze({
  'credits-add': userAmount(-1_000_000, 1_000_000),
  'credits-set': userAmount(0, 1_000_000_000),
  'item-grant': payload => exact(payload, ['userId', 'catalogId', 'quantity']) && idValid(payload.userId) && short(payload.catalogId) && integer(payload.quantity, 1, 20),
  'item-remove': payload => exact(payload, ['userId', 'itemId']) && idValid(payload.userId) && short(payload.itemId),
  'gear-repair': userOnly,
  'xp-add': userAmount(1, 1_000_000),
  'skills-reset': userOnly,
  'account-ban': payload => exact(payload, ['userId', 'reason']) && idValid(payload.userId) && typeof payload.reason === 'string' && payload.reason.trim().length >= 1 && payload.reason.length <= 200 && !/[\p{C}<>]/u.test(payload.reason),
  'account-unban': userOnly,
  'sessions-revoke': userOnly,
  heal: userOnly, refill: userOnly, revive: userOnly,
  'teleport-spawn': payload => exact(payload, ['userId', 'spawnId']) && idValid(payload.userId) && short(payload.spawnId),
  'teleport-player': payload => exact(payload, ['userId', 'targetUserId']) && idValid(payload.userId) && idValid(payload.targetUserId) && payload.userId !== payload.targetUserId,
  godmode: toggle, stamina: toggle, kick: userOnly,
  'room-close': roomOnly, 'enemies-clear': roomOnly,
});
export const PERSISTENT_ADMIN_ACTIONS = new Set(['credits-add', 'credits-set', 'item-grant', 'item-remove', 'gear-repair', 'xp-add', 'skills-reset', 'account-ban', 'account-unban', 'sessions-revoke']);
export function validateAdminAction(action, payload) {
  if (typeof action !== 'string' || !Object.hasOwn(ADMIN_ACTIONS, action) || !ADMIN_ACTIONS[action](payload)) fail(400, 'invalid_admin_action', 'Ungültige Admin-Aktion oder Parameter.');
}
const ITEMS = [
  ...SHOP_ITEMS.map(item => ({ id: item.id, name: item.name, kind: item.kind, rarity: makeCatalogItem(item.id, 'catalog').rarity, value: makeCatalogItem(item.id, 'catalog').value })),
  ...ITEM_CATALOG.map(item => ({ id: item.id, name: item.name, kind: 'trade', rarity: item.rarity, value: Math.max(1, Math.round(item.value * ECONOMY_BALANCE.lootValueMultiplier)) })),
];
const itemById = new Map(ITEMS.map(item => [item.id, item]));
function credentials(username, password) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(name) || typeof password !== 'string' || password.length < 14 || password.length > 128) fail(400, 'invalid_admin_credentials', 'Adminname: 3–32 Buchstaben, Zahlen, _ oder -. Passwort: 14–128 Zeichen.');
  return { name, key: name.toLowerCase() };
}

// A distinct credential/session namespace. Possessing a normal game session
// never grants administration, even when both accounts have the same username.
export function createAdminStore({ path, accounts, now = Date.now } = {}) {
  const ownedAccounts = !accounts;
  accounts ??= createAccountStore({ path, now });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admin_accounts (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, admin_username TEXT NOT NULL,
      action TEXT NOT NULL, target TEXT NOT NULL, result TEXT NOT NULL
    );`);
  const query = sql => db.prepare(sql);
  let hashes = 0;
  const dummySalt = randomBytes(16).toString('hex');
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function derive(password, salt) {
    if (hashes >= 2) fail(429, 'admin_auth_busy', 'Zu viele Admin-Anmeldungen. Bitte kurz warten.');
    hashes++;
    try { return await scrypt(password, salt, 64, SCRYPT_OPTIONS); }
    finally { hashes--; }
  }
  function writeAudit(admin, action, target, result) {
    query('INSERT INTO admin_audit(at,admin_username,action,target,result) VALUES(?,?,?,?,?)').run(now(), admin.username, action, target, result);
    query('DELETE FROM admin_audit WHERE id NOT IN (SELECT id FROM admin_audit ORDER BY id DESC LIMIT 2000)').run();
  }
  async function setupAdmin(username, password) {
    const { name, key } = credentials(username, password), salt = randomBytes(16).toString('hex'), hash = await derive(password, salt);
    return transaction(() => {
      const existing = query('SELECT id FROM admin_accounts WHERE name_key=?').get(key), id = existing?.id ?? randomBytes(16).toString('hex');
      query(`INSERT INTO admin_accounts(id,username,name_key,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(name_key) DO UPDATE SET username=excluded.username,password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=excluded.updated_at`)
        .run(id, name, key, salt, hash.toString('hex'), now(), now());
      query('DELETE FROM admin_sessions WHERE admin_id=?').run(id);
      writeAudit({ username: name }, 'admin-provision', id, 'success');
      return { id, username: name };
    });
  }
  async function login(username, password) {
    const key = typeof username === 'string' && username.length <= 100 ? username.trim().toLowerCase() : '';
    const row = query('SELECT * FROM admin_accounts WHERE name_key=?').get(key);
    const input = typeof password === 'string' && password.length <= 128 ? password : '';
    const derived = await derive(input, row?.password_salt ?? dummySalt), expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(derived, expected) || !row || input.length < 14 || query('SELECT password_hash FROM admin_accounts WHERE id=?').get(row.id)?.password_hash !== row.password_hash) fail(401, 'admin_login_failed', 'Adminname oder Passwort ist falsch.');
    const token = randomBytes(32).toString('hex'), expiresAt = now() + SESSION_MS;
    transaction(() => {
      query('DELETE FROM admin_sessions WHERE expires_at<=?').run(now());
      const old = query('SELECT token_hash FROM admin_sessions WHERE admin_id=? ORDER BY created_at DESC').all(row.id).slice(3);
      for (const entry of old) query('DELETE FROM admin_sessions WHERE token_hash=?').run(entry.token_hash);
      query('INSERT INTO admin_sessions(token_hash,admin_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token), row.id, expiresAt, now());
      writeAudit(row, 'admin-login', row.id, 'success');
    });
    return { admin: { username: row.username }, token, expiresAt };
  }
  function authenticate(token) {
    if (!tokenValid(token)) return null;
    const row = query('SELECT a.id,a.username,s.expires_at FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token), now());
    return row ? { id: row.id, username: row.username, expiresAt: row.expires_at, sessionId: hashToken(token) } : null;
  }
  function logout(token) {
    const admin = authenticate(token);
    if (tokenValid(token)) query('DELETE FROM admin_sessions WHERE token_hash=?').run(hashToken(token));
    if (admin) transaction(() => writeAudit(admin, 'admin-logout', admin.id, 'success'));
    return true;
  }
  function playerRow(id) {
    if (!idValid(id)) fail(400, 'invalid_player', 'Ungültiger Spieler.');
    const row = query('SELECT id,username,profile FROM accounts WHERE id=?').get(id);
    if (!row) fail(404, 'player_not_found', 'Spieler wurde nicht gefunden.');
    return row;
  }
  function player(id) {
    const row = playerRow(id), ban = query('SELECT reason,banned_at,admin_username FROM account_bans WHERE account_id=?').get(id);
    return { id: row.id, username: row.username, profile: validateProfile(JSON.parse(row.profile)),
      banned: ban ? { reason: ban.reason, at: ban.banned_at, admin: ban.admin_username } : null };
  }
  function lookupPlayer(username) {
    const name = typeof username === 'string' ? username.trim() : '';
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(name)) fail(400, 'invalid_player_name', 'Genauen Rufnamen angeben.');
    const row = query('SELECT id FROM accounts WHERE name_key=?').get(name.toLowerCase());
    if (!row) fail(404, 'player_not_found', 'Spieler wurde nicht gefunden.');
    return player(row.id);
  }
  function perform(admin, action, payload) {
    validateAdminAction(action, payload);
    if (!PERSISTENT_ADMIN_ACTIONS.has(action)) fail(400, 'not_persistent_action', 'Diese Aktion benötigt einen laufenden Raid.');
    return transaction(() => {
      const row = playerRow(payload.userId);
      let result = {};
      if (['account-ban', 'account-unban', 'sessions-revoke'].includes(action)) {
        if (action === 'account-ban') query(`INSERT INTO account_bans(account_id,reason,banned_at,admin_username) VALUES(?,?,?,?)
          ON CONFLICT(account_id) DO UPDATE SET reason=excluded.reason,banned_at=excluded.banned_at,admin_username=excluded.admin_username`).run(row.id, payload.reason.trim(), now(), admin.username);
        if (action === 'account-unban') query('DELETE FROM account_bans WHERE account_id=?').run(row.id);
        else result.revokedSessions = query('DELETE FROM sessions WHERE account_id=?').run(row.id).changes;
      } else {
        if (accounts.isBusy(row.id)) fail(409, 'player_busy', 'Spieler muss zuerst seinen Raid oder seine Lobby verlassen.');
        const profile = validateProfile(JSON.parse(row.profile));
        if (action === 'credits-add' || action === 'credits-set') {
          const amount = action === 'credits-add' ? profile.credits + payload.amount : payload.amount;
          if (!integer(amount, 0, 1_000_000_000_000)) fail(409, 'credit_bounds', 'Das Ergebnis liegt außerhalb des gültigen Guthabens.');
          profile.credits = amount;
        } else if (action === 'xp-add') {
          if (profile.progression.xp + payload.amount > 1_000_000_000) fail(409, 'xp_bounds', 'Maximale Erfahrung erreicht.');
          profile.progression.xp += payload.amount;
        } else if (action === 'skills-reset') {
          profile.progression.unlocked = []; profile.upgrades = { armor: 0, backpack: 0, weapon: 0 };
        } else if (action === 'item-grant') {
          const catalog = itemById.get(payload.catalogId);
          if (!catalog) fail(400, 'unknown_item', 'Unbekannter Kataloggegenstand.');
          if (profile.stash.length + profile.intake.length + payload.quantity > 10000) fail(409, 'inventory_full', 'Das Lager ist voll.');
          for (let i = 0; i < payload.quantity; i++) {
            const raw = catalog.kind === 'trade' ? { name: catalog.name, value: catalog.value, rarity: catalog.rarity } : makeCatalogItem(catalog.id, '');
            profile.stash.push(createItem(profile, raw));
          }
          result.granted = payload.quantity;
        } else if (action === 'item-remove') {
          let removed = false;
          for (const items of [profile.stash, profile.intake]) {
            const index = items.findIndex(item => item.id === payload.itemId);
            if (index >= 0) { items.splice(index, 1); removed = true; break; }
            for (const item of items) for (const [slot, part] of Object.entries(item.attachments ?? {})) {
              if (part.id === payload.itemId) { delete item.attachments[slot]; removed = true; }
            }
          }
          if (!removed) fail(404, 'item_not_found', 'Gegenstand liegt nicht im Lager oder Eingang.');
          repairLoadoutReferences(profile);
        } else if (action === 'gear-repair') {
          result.repaired = 0;
          for (const item of [...profile.stash, ...profile.intake]) if (item.kind === 'equipment' && item.condition < 1) { item.condition = 1; result.repaired++; }
        }
        query('UPDATE accounts SET profile=?,revision=revision+1 WHERE id=?').run(JSON.stringify(validateProfile(profile)), row.id);
      }
      writeAudit(admin, action, row.id, 'success');
      return { ...result, player: player(row.id) };
    });
  }
  function record(admin, action, target, result) {
    const known = typeof action === 'string' && Object.hasOwn(ADMIN_ACTIONS, action) ? action : 'invalid-action';
    const safeTarget = typeof target === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(target) ? target : '-';
    const safeResult = result === 'success' ? 'success' : 'failed';
    transaction(() => writeAudit(admin, known, safeTarget, safeResult));
  }
  function audit(limit = 100) {
    if (!integer(limit, 1, 200)) fail(400, 'invalid_limit', 'Ungültige Protokollgrenze.');
    return query('SELECT id,at,admin_username AS admin,action,target,result FROM admin_audit ORDER BY id DESC LIMIT ?').all(limit).map(row => ({ ...row }));
  }
  return { setupAdmin, login, authenticate, logout, lookupPlayer, player, perform, record, audit,
    catalog: () => structuredClone(ITEMS),
    close() { db.close(); if (ownedAccounts) accounts.close(); } };
}
