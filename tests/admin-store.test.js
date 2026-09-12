import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createAccountStore } from '../server/account-store.js';
import { createAdminStore } from '../server/admin-store.js';

const password = 'admin-test-password-1234';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'df-admin-')), path = join(directory, 'accounts.sqlite'), clock = { value: 100000 };
  let accounts = createAccountStore({ path, now: () => clock.value }), admins = createAdminStore({ path, accounts, now: () => clock.value });
  t.after(() => { admins.close(); accounts.close(); rmSync(directory, { recursive: true, force: true }); });
  return { path, clock, get accounts() { return accounts; }, get admins() { return admins; },
    reopen() { admins.close(); accounts.close(); accounts = createAccountStore({ path, now: () => clock.value }); admins = createAdminStore({ path, accounts, now: () => clock.value }); } };
}
async function operator(f, name = 'Operator') {
  const user = await f.accounts.register(name, password);
  await f.admins.setupAdmin('ControlAdmin', password);
  const session = await f.admins.login('ControlAdmin', password), admin = f.admins.authenticate(session.token);
  return { user, session, admin, run: (action, payload) => f.admins.perform(admin, action, { userId: user.user.id, ...payload }) };
}

test('admin credentials start absent, are independently provisioned and never accept game sessions or passwords', async t => {
  const f = fixture(t), game = await f.accounts.register('SameName', password);
  await assert.rejects(f.admins.login('SameName', password), { code: 'admin_login_failed' });
  assert.equal(f.admins.authenticate(game.token), null);
  await f.admins.setupAdmin('SameName', 'a-different-admin-password');
  await assert.rejects(f.admins.login('SameName', password), { code: 'admin_login_failed' });
  const session = await f.admins.login('samename', 'a-different-admin-password');
  assert.equal(session.admin.username, 'SameName'); assert.equal(f.accounts.authenticate(session.token), null);
  const db = new DatabaseSync(f.path), row = db.prepare('SELECT * FROM admin_accounts').get(), storedSession = db.prepare('SELECT * FROM admin_sessions').get(); db.close();
  assert.match(row.password_salt, /^[a-f0-9]{32}$/); assert.match(row.password_hash, /^[a-f0-9]{128}$/);
  assert.notEqual(storedSession.token_hash, session.token); assert.equal(JSON.stringify(row).includes('a-different-admin-password'), false);
  assert.equal(session.expiresAt - f.clock.value, 30 * 60_000);
  f.reopen(); assert.equal(f.admins.authenticate(session.token).username, 'SameName');
  f.clock.value = session.expiresAt; assert.equal(f.admins.authenticate(session.token), null);
});

test('password rotation, logout and validation revoke only administrator sessions', async t => {
  const f = fixture(t), { user, session } = await operator(f);
  for (const name of ['ab', 'üadmin', 'a'.repeat(33), {}, null]) await assert.rejects(f.admins.setupAdmin(name, password), { status: 400 });
  for (const value of ['short', 'x'.repeat(129), {}]) await assert.rejects(f.admins.setupAdmin('Valid', value), { status: 400 });
  await f.admins.setupAdmin('CONTROLADMIN', 'replacement-admin-password');
  assert.equal(f.admins.authenticate(session.token), null); assert.deepEqual(f.accounts.authenticate(user.token), user.user);
  await assert.rejects(f.admins.login('ControlAdmin', password), { code: 'admin_login_failed' });
  const fresh = await f.admins.login('ControlAdmin', 'replacement-admin-password'); f.admins.logout(fresh.token);
  assert.equal(f.admins.authenticate(fresh.token), null);
});

test('bounded persistent grants use canonical IDs/stats and removal repairs selected and mounted references', async t => {
  const f = fixture(t), { user, run } = await operator(f);
  let result = run('item-grant', { catalogId: 'AR-4', quantity: 2 });
  assert.equal(result.player.profile.stash.length, 2); assert.notEqual(result.player.profile.stash[0].id, result.player.profile.stash[1].id);
  const gun = result.player.profile.stash[0];
  result = run('item-grant', { catalogId: 'optic-holo', quantity: 1 });
  const part = result.player.profile.stash.find(item => item.catalogId === 'optic-holo');
  await f.accounts.action(user.user.id, { kind: 'game', action: 'equipLoadout', args: ['weapon', gun.id] });
  await f.accounts.action(user.user.id, { kind: 'game', action: 'mountAttachment', args: [gun.id, 'optic', part.id] });
  result = run('item-remove', { itemId: part.id });
  assert.deepEqual(result.player.profile.stash.find(item => item.id === gun.id).attachments, {});
  result = run('item-remove', { itemId: gun.id }); assert.equal(result.player.profile.loadout.custom.weapon, null);
  result = run('item-grant', { catalogId: 'electronics-07', quantity: 20 });
  assert.equal(result.granted, 20); assert.ok(result.player.profile.stash.some(item => item.name === 'Wärmebildmatrix' && item.value === Math.round(1050 * .65)));
  const before = result.player.profile;
  for (const payload of [{ catalogId: 'AR-4', quantity: 21 }, { catalogId: 'unknown', quantity: 1 }, { catalogId: 'AR-4', quantity: -1 }]) assert.throws(() => run('item-grant', payload), { status: 400 });
  assert.deepEqual(f.admins.player(user.user.id).profile, before);
  assert.equal(f.admins.catalog().length, 201);
});

test('credits and XP obey bounds, skills reset preserves XP and gear repair restores canonical condition/value', async t => {
  const f = fixture(t), { user, run } = await operator(f);
  assert.equal(run('credits-add', { amount: 250 }).player.profile.credits, 1000);
  assert.equal(run('credits-set', { amount: 40 }).player.profile.credits, 40);
  assert.throws(() => run('credits-add', { amount: -41 }), { code: 'credit_bounds' });
  assert.equal(run('xp-add', { amount: 750 }).player.profile.progression.xp, 750);
  await f.accounts.action(user.user.id, { kind: 'game', action: 'unlockSkill', args: ['weapon-1'] });
  const reset = run('skills-reset').player.profile;
  assert.equal(reset.progression.xp, 750); assert.deepEqual(reset.progression.unlocked, []); assert.deepEqual(reset.upgrades, { armor: 0, backpack: 0, weapon: 0 });
  const p = run('item-grant', { catalogId: 'plate-fiber', quantity: 1 }).player.profile;
  p.stash[0].condition = .25;
  const db = new DatabaseSync(f.path); db.prepare('UPDATE accounts SET profile=? WHERE id=?').run(JSON.stringify(p), user.user.id); db.close();
  const repaired = run('gear-repair'); assert.equal(repaired.repaired, 1); assert.equal(repaired.player.profile.stash[0].condition, 1); assert.equal(repaired.player.profile.credits, 40);
});

test('profile mutations respect both durable room locks and pending asynchronous hub work', async t => {
  const f = fixture(t), { user, run } = await operator(f), before = f.accounts.getProfile(user.user.id);
  f.accounts.acquireRoom(user.user.id, 'occupied');
  assert.throws(() => run('credits-add', { amount: 1 }), { code: 'player_busy' });
  assert.deepEqual(f.accounts.getProfile(user.user.id), before); f.accounts.releaseRoom(user.user.id, 'occupied');
  const purchase = f.accounts.action(user.user.id, { kind: 'game', action: 'purchaseEquipment', args: ['AR-4'] });
  assert.throws(() => run('item-grant', { catalogId: 'SR-90', quantity: 1 }), { code: 'player_busy' });
  await purchase;
  assert.equal(f.accounts.getProfile(user.user.id).credits, 100); assert.equal(f.accounts.getProfile(user.user.id).stash.length, 1);
  assert.equal(run('credits-add', { amount: 1 }).player.profile.credits, 101);
});

test('ban/revoke preserves player progress and does not affect independent admin authentication', async t => {
  const f = fixture(t), { user, session, run } = await operator(f);
  const before = f.accounts.getProfile(user.user.id); f.accounts.acquireRoom(user.user.id, 'active-room');
  const banned = run('account-ban', { reason: 'Test moderation' });
  assert.equal(banned.revokedSessions, 1); assert.equal(banned.player.banned.reason, 'Test moderation'); assert.deepEqual(banned.player.profile, before);
  assert.equal(f.accounts.authenticate(user.token), null); await assert.rejects(f.accounts.login(user.user.username, password), { code: 'account_banned' });
  assert.equal(f.admins.authenticate(session.token).username, 'ControlAdmin');
  f.reopen(); await assert.rejects(f.accounts.login(user.user.username, password), { code: 'account_banned' });
  const admin = f.admins.authenticate(session.token);
  f.admins.perform(admin, 'account-unban', { userId: user.user.id });
  const login = await f.accounts.login(user.user.username, password); assert.deepEqual(login.profile, before);
  f.admins.perform(admin, 'sessions-revoke', { userId: user.user.id }); assert.equal(f.accounts.authenticate(login.token), null);
});

test('audit is bounded and contains only safe event metadata, never payloads, passwords or session tokens', async t => {
  const f = fixture(t), { admin, session, user, run } = await operator(f);
  run('credits-add', { amount: 20 });
  f.admins.record(admin, password, password, password);
  for (let i = 0; i < 2001; i++) f.admins.record(admin, 'heal', user.user.id, 'success');
  const db = new DatabaseSync(f.path); assert.equal(db.prepare('SELECT COUNT(*) AS count FROM admin_audit').get().count, 2000); db.close();
  const audit = f.admins.audit(200); assert.equal(audit.length, 200);
  assert.deepEqual(Object.keys(audit[0]).sort(), ['action', 'admin', 'at', 'id', 'result', 'target']);
  assert.equal(JSON.stringify(audit).includes(password), false); assert.equal(JSON.stringify(audit).includes(session.token), false);
});
