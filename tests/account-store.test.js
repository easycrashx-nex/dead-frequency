import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAccountStore } from '../server/account-store.js';
import { createItem } from '../src/economy.js';

const password = 'Test-only-long-password!';
function setup(t, { time = 1800000000000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'df-accounts-')), path = join(directory, 'accounts.sqlite');
  const clock = { time };
  let store = createAccountStore({ path, now: () => clock.time });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { path, clock, get store() { return store; }, reopen() { store.close(); store = createAccountStore({ path, now: () => clock.time }); return store; } };
}
test('registration stores salted scrypt and hashed sessions; login is case insensitive and session survives reopening', async t => {
  const context = setup(t), created = await context.store.register('  Operator_01 ', password);
  assert.equal(created.user.username, 'Operator_01'); assert.equal(created.profile.credits, 750);
  assert.equal(created.profile.raids, 0); assert.deepEqual(created.profile.stash, []);
  assert.match(created.token, /^[a-f0-9]{64}$/);
  const db = new DatabaseSync(context.path), row = db.prepare('SELECT * FROM accounts').get(), session = db.prepare('SELECT * FROM sessions').get(); db.close();
  assert.equal(row.name_key, 'operator_01'); assert.match(row.password_salt, /^[a-f0-9]{32}$/);
  assert.match(row.password_hash, /^[a-f0-9]{128}$/); assert.notEqual(session.token_hash, created.token);
  assert.equal(JSON.stringify(row).includes(password), false);
  assert.deepEqual(context.reopen().authenticate(created.token), created.user);
  const login = await context.store.login('OPERATOR_01', password); assert.deepEqual(login.user, created.user);
  assert.notEqual(login.token, created.token);
  context.store.logout(login.token); assert.equal(context.store.authenticate(login.token), null);
  assert.deepEqual(context.store.authenticate(created.token), created.user);
  context.clock.time = created.expiresAt; assert.equal(context.store.authenticate(created.token), null);
});

test('username and password bounds, duplicate names and invalid tokens fail without corrupting an account', async t => {
  const { store } = setup(t);
  for (const name of ['ab', 'a'.repeat(25), 'üser', 'abc def', '../admin']) await assert.rejects(store.register(name, password), { code: 'invalid_credentials' });
  for (const value of ['short', 'x'.repeat(129), {}, null]) await assert.rejects(store.register('valid', value), { code: 'invalid_credentials' });
  const first = await store.register('Alpha', password);
  await assert.rejects(store.register('aLPHA', password), { code: 'registration_unavailable' });
  for (const token of ['', 'A'.repeat(64), 'a'.repeat(63), {}, null]) assert.equal(store.authenticate(token), null);
  assert.equal(store.authenticate('0'.repeat(64)), null);
  assert.equal(store.getProfile(first.user.id).credits, 750);
});

test('unknown-account and wrong-password login have the same public failure', async t => {
  const { store } = setup(t); await store.register('Known', password);
  let known, unknown;
  try { await store.login('Known', 'incorrect-password'); } catch (error) { known = error; }
  try { await store.login('Missing', 'incorrect-password'); } catch (error) { unknown = error; }
  assert.equal(known.status, 401); assert.equal(known.code, unknown.code); assert.equal(known.message, unknown.message);
});

test('hub only executes allowlisted actions on its saved profile and does not accept client grants or clocks', async t => {
  const { store } = setup(t), { user } = await store.register('Shopper', password);
  const before = store.getProfile(user.id);
  const bad = [
    null, [], { kind: { toString: null }, action: 'claimAll', args: [] },
    { kind: 'economy', action: { toString: null }, args: [] },
    { kind: 'game', action: 'startRaid', args: [] },
    { kind: 'game', action: 'receiveDamage', args: [-1000] },
    { kind: 'game', action: '__proto__', args: [] },
    { kind: 'economy', action: 'createItem', args: [{ value: 100000 }] },
    { kind: 'economy', action: 'advanceMarket', args: [Number.MAX_SAFE_INTEGER] },
    { kind: 'economy', action: 'claimAll', args: [], profile: { credits: 1e9 } },
    { kind: 'game', action: 'selectLoadout', args: [{ mode: 'custom', custom: { weapon: 'forged' } }] },
  ];
  for (const action of bad) await assert.rejects(store.action(user.id, action), { code: 'invalid_action' });
  assert.deepEqual(store.getProfile(user.id), before);
  const selection = await store.action(user.id, { kind: 'game', action: 'selectLoadout', args: [{ mode: 'preset', presetId: 'scout' }] });
  assert.equal(selection.result, true); assert.equal(selection.profile.credits, 750);
  const purchase = await store.action(user.id, { kind: 'game', action: 'purchaseEquipment', args: ['AR-4'] });
  assert.equal(purchase.result, true); assert.ok(purchase.profile.credits < 750);
  assert.equal(purchase.profile.stash[0].catalogId, 'AR-4');
  const invalid = await store.action(user.id, { kind: 'game', action: 'purchaseEquipment', args: ['not-a-weapon'] });
  assert.equal(invalid.result, false); assert.deepEqual(invalid.profile, purchase.profile);
});

test('server-owned extraction loot can be stored, listed, cancelled and claimed once only', async t => {
  const { store } = setup(t), { user } = await store.register('Trader', password);
  const profile = store.acquireRoom(user.id, 'room-trader'); profile.raids++;
  assert.equal(store.commitRaidStart('room-trader', [{ accountId: user.id, profile }]), true);
  profile.extracts++; profile.intake.push(createItem(profile, { name: 'Seltener Chip', rarity: 'epic', value: 300 }));
  assert.equal(store.settleRaid(user.id, 'room-trader', profile, 'extracted'), true);
  const action = (name, ...args) => store.action(user.id, { kind: 'economy', action: name, args });
  const stored = await action('storeAll'), item = stored.profile.stash[0];
  assert.equal(stored.result, true); assert.equal((await action('storeAll')).result, false);
  const listed = await action('listItem', item.id, 500, 2), listing = listed.profile.listings[0];
  assert.equal(listed.profile.stash.length, 0); assert.equal((await action('listItem', item.id, 500, 2)).result, false);
  const cancelled = await action('cancelListing', listing.id), mail = cancelled.profile.mailbox[0];
  assert.equal(cancelled.profile.listings.length, 0);
  const claimed = await action('claimMail', mail.id); assert.equal(claimed.profile.stash.length, 1);
  assert.equal((await action('claimMail', mail.id)).result, false); assert.equal(store.getProfile(user.id).stash.length, 1);
});

test('one-account room locks exclude actions and parallel raids; lobby release does not spend funds', async t => {
  const { store } = setup(t), { user } = await store.register('Locked', password), before = store.getProfile(user.id);
  assert.deepEqual(store.acquireRoom(user.id, 'room-a'), before);
  assert.throws(() => store.acquireRoom(user.id, 'room-b'), { code: 'account_busy' });
  await assert.rejects(store.action(user.id, { kind: 'economy', action: 'claimAll', args: [] }), { code: 'account_busy' });
  assert.equal(store.releaseRoom(user.id, 'room-b'), false); assert.equal(store.releaseRoom(user.id, 'room-a'), true);
  assert.deepEqual(store.getProfile(user.id), before);
});

test('raid costs are durable before simulation resumes and restart never refunds or accepts stale outcomes', async t => {
  const context = setup(t), { user } = await context.store.register('Restart', password);
  const spent = context.store.acquireRoom(user.id, 'room-restart'); spent.credits -= 150; spent.raids++;
  assert.equal(context.store.commitRaidStart('room-restart', [{ accountId: user.id, profile: spent }]), true);
  assert.equal(context.store.commitRaidStart('room-restart', [{ accountId: user.id, profile: { ...spent, credits: 100000 } }]), false);
  assert.throws(() => context.store.releaseRoom(user.id, 'room-restart'), { code: 'account_busy' });
  context.reopen(); assert.equal(context.store.getProfile(user.id).credits, 600);
  assert.equal(context.store.recoverRooms(), 1); assert.equal(context.store.recoverRooms(), 0);
  assert.equal(context.store.getProfile(user.id).credits, 600);
  assert.equal(context.store.settleRaid(user.id, 'room-restart', { ...spent, credits: 50000 }, 'extracted'), false);
  assert.equal(context.store.getProfile(user.id).credits, 600);
  context.store.acquireRoom(user.id, 'new-room'); assert.equal(context.store.releaseRoom(user.id, 'new-room'), true);
});

test('multi-player raid start transaction rejects an unlocked participant before spending either account', async t => {
  const { store } = setup(t), alice = await store.register('Alice', password), bob = await store.register('Bobby', password);
  const a = store.acquireRoom(alice.user.id, 'duo'); a.credits = 0;
  assert.throws(() => store.commitRaidStart('duo', [{ accountId: alice.user.id, profile: a }, { accountId: bob.user.id, profile: a }]), { code: 'account_busy' });
  assert.equal(store.getProfile(alice.user.id).credits, 750); assert.equal(store.getProfile(bob.user.id).credits, 750);
  const b = store.acquireRoom(bob.user.id, 'duo'); b.credits = 500;
  assert.equal(store.commitRaidStart('duo', [{ accountId: alice.user.id, profile: a }, { accountId: bob.user.id, profile: b }]), true);
  assert.equal(store.getProfile(alice.user.id).credits, 0); assert.equal(store.getProfile(bob.user.id).credits, 500);
  a.credits = 300;
  assert.equal(store.settleRaid(alice.user.id, 'duo', a, 'extracted'), true);
  assert.equal(store.settleRaid(alice.user.id, 'duo', { ...a, credits: 100000 }, 'extracted'), false);
  assert.equal(store.getProfile(alice.user.id).credits, 300);
  assert.equal(store.settleRaid(bob.user.id, 'duo', b, 'disconnect'), true);
});

test('concurrent hub actions cannot overwrite another account or race a raid lock', async t => {
  const { store } = setup(t), alice = await store.register('ParallelA', password), bob = await store.register('ParallelB', password);
  const purchaseA = store.action(alice.user.id, { kind: 'game', action: 'purchaseEquipment', args: ['AR-4'] });
  assert.throws(() => store.acquireRoom(alice.user.id, 'racing-room'), { code: 'account_busy' });
  await assert.rejects(store.action(alice.user.id, { kind: 'game', action: 'purchaseEquipment', args: ['AR-4'] }), { code: 'account_busy' });
  const purchaseB = store.action(bob.user.id, { kind: 'game', action: 'purchaseEquipment', args: ['optic-holo'] });
  const [a, b] = await Promise.all([purchaseA, purchaseB]);
  assert.equal(a.profile.credits, 100); assert.equal(a.profile.stash[0].catalogId, 'AR-4');
  assert.equal(b.profile.credits, 420); assert.equal(b.profile.stash[0].catalogId, 'optic-holo');
  assert.deepEqual(store.getProfile(alice.user.id), a.profile); assert.deepEqual(store.getProfile(bob.user.id), b.profile);
});

test('local administrator password recovery revokes tokens and changes credentials without changing possessions', async t => {
  const { store } = setup(t), created = await store.register('Recoverable', password), before = store.getProfile(created.user.id);
  const reset = await store.resetPassword('RECOVERABLE', 'replacement-password-123');
  assert.equal(reset.revokedSessions, 1); assert.equal(store.authenticate(created.token), null);
  await assert.rejects(store.login('Recoverable', password), { code: 'login_failed' });
  const login = await store.login('Recoverable', 'replacement-password-123');
  assert.deepEqual(login.profile, before); assert.equal(store.revokeSessions(login.user.id), 1);
  assert.equal(store.authenticate(login.token), null);
});

test('password hashing queue is bounded before expensive asynchronous work is allocated', async t => {
  const { store } = setup(t);
  const pending = Array.from({ length: 5 }, (_, i) => store.register(`Bounded${i}`, password));
  const results = await Promise.allSettled(pending);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
  const rejected = results.find(result => result.status === 'rejected'); assert.equal(rejected.reason.code, 'auth_busy');
});

test('fatal room cleanup retains committed costs, releases only its players and rejects late extraction', async t => {
  const { store } = setup(t), alice = await store.register('Aborted', password), bob = await store.register('StillPlaying', password);
  const a = store.acquireRoom(alice.user.id, 'broken-room'), b = store.acquireRoom(bob.user.id, 'healthy-room');
  a.credits = 400; a.raids++; b.credits = 300; b.raids++;
  store.commitRaidStart('broken-room', [{ accountId: alice.user.id, profile: a }]);
  store.commitRaidStart('healthy-room', [{ accountId: bob.user.id, profile: b }]);
  assert.equal(store.abortRoom('broken-room'), 1); assert.equal(store.abortRoom('broken-room'), 0);
  assert.deepEqual(store.getProfile(alice.user.id), a);
  assert.equal(store.settleRaid(alice.user.id, 'broken-room', { ...a, credits: 50000 }, 'extracted'), false);
  await store.action(alice.user.id, { kind: 'economy', action: 'storeAll', args: [] });
  await assert.rejects(store.action(bob.user.id, { kind: 'economy', action: 'storeAll', args: [] }), { code: 'account_busy' });
  assert.equal(store.settleRaid(bob.user.id, 'healthy-room', b, 'death'), true);
  assert.equal(store.getProfile(bob.user.id).credits, 300);
});
