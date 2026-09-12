import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAccountStore } from '../server/account-store.js';

const password = 'social-test-password-123';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'df-social-')), path = join(directory, 'accounts.sqlite');
  let store = createAccountStore({ path });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { path, get store() { return store; }, reopen() { store.close(); store = createAccountStore({ path }); return store; },
    legacyReopen() { store.close(); const db = new DatabaseSync(path); db.exec('DROP TABLE social_links'); db.close(); store = createAccountStore({ path }); return store; } };
}
const names = (store, id, bucket) => store.social(id)[bucket].map(user => user.username);

test('exact case-insensitive friend requests are directional until accepted and friendship survives reopening', async t => {
  const f = fixture(t), a = await f.store.register('Alice', password), b = await f.store.register('Bobby', password);
  assert.deepEqual(f.store.social(a.user.id), { friends: [], incoming: [], outgoing: [] });
  assert.equal(f.store.requestFriend(a.user.id, '  bOBBy  '), true);
  assert.deepEqual(names(f.store, a.user.id, 'outgoing'), ['Bobby']); assert.deepEqual(names(f.store, b.user.id, 'incoming'), ['Alice']);
  assert.equal(f.store.areFriends(a.user.id, b.user.id), false);
  assert.equal(f.store.requestFriend(a.user.id, 'Bobby'), false);
  assert.equal(f.store.respondFriend(b.user.id, a.user.id, true), true);
  assert.equal(f.store.areFriends(a.user.id, b.user.id), true); assert.equal(f.store.areFriends(b.user.id, a.user.id), true);
  assert.deepEqual(f.store.social(a.user.id), { friends: [b.user], incoming: [], outgoing: [] });
  assert.equal(f.store.respondFriend(b.user.id, a.user.id, true), false);
  assert.equal(f.store.requestFriend(a.user.id, 'Bobby'), false);
  f.reopen(); assert.equal(f.store.areFriends(a.user.id, b.user.id), true); assert.deepEqual(f.store.social(a.user.id).friends, [b.user]);
});

test('crossed requests resolve to one mutual friendship without pending duplicates', async t => {
  const { store } = fixture(t), a = await store.register('CrossedA', password), b = await store.register('CrossedB', password);
  assert.equal(store.requestFriend(a.user.id, b.user.username), true);
  assert.equal(store.requestFriend(b.user.id, a.user.username), true);
  for (const id of [a.user.id, b.user.id]) {
    const state = store.social(id); assert.equal(state.friends.length, 1); assert.deepEqual(state.incoming, []); assert.deepEqual(state.outgoing, []);
  }
});

test('only recipients can accept or reject, outgoing cancellation and friendship removal are symmetric', async t => {
  const { store } = fixture(t), a = await store.register('Sender', password), b = await store.register('Receiver', password);
  store.requestFriend(a.user.id, b.user.username);
  assert.throws(() => store.respondFriend(a.user.id, b.user.id, true), { code: 'friend_request_missing' });
  assert.throws(() => store.removeFriend(b.user.id, a.user.id), { code: 'incoming_request' });
  assert.equal(store.respondFriend(b.user.id, a.user.id, false), true); assert.equal(store.social(a.user.id).outgoing.length, 0);
  store.requestFriend(a.user.id, b.user.username); assert.equal(store.removeFriend(a.user.id, b.user.id), true);
  assert.deepEqual(store.social(b.user.id).incoming, []); assert.equal(store.removeFriend(a.user.id, b.user.id), false);
  store.requestFriend(a.user.id, b.user.username); store.respondFriend(b.user.id, a.user.id, true);
  assert.equal(store.removeFriend(b.user.id, a.user.id), true); assert.equal(store.areFriends(a.user.id, b.user.id), false);
  assert.deepEqual(store.social(a.user.id).friends, []);
});

test('friend operations reject self, partial names, invalid identities and forged response values', async t => {
  const { store } = fixture(t), a = await store.register('OperatorFull', password);
  for (const name of ['', 'ab', 'a'.repeat(25), 'üser', 'operator full', {}, null]) assert.throws(() => store.requestFriend(a.user.id, name), { status: 400 });
  assert.throws(() => store.requestFriend(a.user.id, 'Operator'), { code: 'friend_not_found' });
  assert.throws(() => store.requestFriend(a.user.id, 'operatorfull'), { code: 'invalid_friend' });
  for (const id of [null, {}, 'not-an-id', a.user.id]) assert.throws(() => store.removeFriend(a.user.id, id), { status: 400 });
  assert.throws(() => store.respondFriend(a.user.id, 'f'.repeat(32), 'true'), { code: 'invalid_response' });
  assert.equal(store.areFriends(a.user.id, {}), false); assert.equal(store.areFriends(a.user.id, a.user.id), false);
  assert.deepEqual(store.social(a.user.id), { friends: [], incoming: [], outgoing: [] });
});

test('additive migration preserves old profiles, passwords, sessions and raid locks', async t => {
  const f = fixture(t), a = await f.store.register('LegacyAccount', password);
  const spent = f.store.acquireRoom(a.user.id, 'legacy-raid'); spent.credits = 400; spent.raids++;
  f.store.commitRaidStart('legacy-raid', [{ accountId: a.user.id, profile: spent }]);
  f.legacyReopen(); assert.deepEqual(f.store.authenticate(a.token), a.user); assert.deepEqual(f.store.getProfile(a.user.id), spent);
  assert.deepEqual(f.store.social(a.user.id), { friends: [], incoming: [], outgoing: [] });
  assert.throws(() => f.store.acquireRoom(a.user.id, 'different-raid'), { code: 'account_busy' });
  const login = await f.store.login('LegacyAccount', password); assert.equal(login.user.id, a.user.id);
  f.store.abortRoom('legacy-raid');
});

test('pending and accepted caps are enforced for both players, including crossed requests and rollback', async t => {
  const f = fixture(t), owner = await f.store.register('CapacityOwner', password);
  // Seed account identities directly for a bounded capacity test. Password work
  // is independently tested; this test targets SQLite constraints and limits.
  const db = new DatabaseSync(f.path), base = db.prepare('SELECT * FROM accounts WHERE id=?').get(owner.user.id), users = [];
  const insert = db.prepare('INSERT INTO accounts(id,username,name_key,password_salt,password_hash,profile,created_at) VALUES(?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 1; i <= 103; i++) {
    const user = { id: i.toString(16).padStart(32, '0'), username: `Member${i}` }; users.push(user);
    insert.run(user.id, user.username, user.username.toLowerCase(), base.password_salt, base.password_hash, base.profile, base.created_at);
  }
  db.exec('COMMIT');
  for (const user of users.slice(0, 100)) f.store.requestFriend(owner.user.id, user.username);
  assert.equal(f.store.social(owner.user.id).outgoing.length, 100);
  assert.throws(() => f.store.requestFriend(owner.user.id, users[100].username), { code: 'social_limit' });
  assert.throws(() => f.store.requestFriend(users[100].id, owner.user.username), { code: 'social_limit' });
  assert.equal(f.store.social(users[100].id).outgoing.length, 0);
  for (const user of users.slice(0, 100)) f.store.respondFriend(user.id, owner.user.id, true);
  assert.equal(f.store.social(owner.user.id).friends.length, 100);
  f.store.requestFriend(users[100].id, owner.user.username);
  assert.throws(() => f.store.respondFriend(owner.user.id, users[100].id, true), { code: 'social_limit' });
  assert.throws(() => f.store.requestFriend(owner.user.id, users[100].username), { code: 'social_limit' });
  assert.equal(f.store.social(owner.user.id).friends.length, 100); assert.equal(f.store.social(owner.user.id).incoming.length, 1);
  assert.equal(f.store.social(users[100].id).outgoing.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM social_links').get().count, 101); db.close();
});
