import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createPlatform } = createRequire(import.meta.url)('../platform.cjs');
const token = 'a'.repeat(64);
const invite = `https://valid-test.trycloudflare.com/coop?token=${token}`;
const healthy = () => ({ ok: true, json: async () => ({ game: 'DEAD FREQUENCY', protocol: 1 }) });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  return createPlatform({ app: {}, waitForDns: async () => {}, request: async () => healthy(), ...options });
}

test('public invitations wait for authoritative publication before a token-free health request', async t => {
  let release, calls = 0, ready = false;
  const publication = new Promise(resolve => { release = resolve; });
  const platform = fixture(t, {
    waitForDns: async (hostname, isCurrent, deadline) => {
      assert.equal(hostname, 'valid-test.trycloudflare.com');
      assert.equal(isCurrent(), true); assert.equal(deadline, 46000); await publication;
    },
    request: async (url, init) => { calls++; assert.equal(url, 'https://valid-test.trycloudflare.com/health'); assert.equal(init.cache, 'no-store'); return healthy(); },
  });
  const pending = platform.prepareInvite(invite).then(() => { ready = true; });
  await flush(); assert.equal(calls, 0); assert.equal(ready, false);
  release(); await pending; assert.equal(calls, 1); assert.equal(ready, true);
});

test('an actual DNS failure refreshes the negative cache before retrying health', async t => {
  let calls = 0, refreshed = 0;
  const platform = fixture(t, {
    request: async () => { if (++calls === 1) throw new Error('net::ERR_NAME_NOT_RESOLVED'); assert.equal(refreshed, 1); return healthy(); },
    refreshDns: async () => { refreshed++; },
  });
  const pending = platform.prepareInvite(invite);
  await flush(); assert.equal(calls, 1); assert.equal(refreshed, 1);
  t.mock.timers.tick(1000); await pending; assert.equal(calls, 2);
});

test('HTTP success from the wrong game or protocol never declares an invitation ready', async t => {
  let calls = 0, ready = false, refreshed = 0;
  const replies = [
    { ok: true, json: async () => ({ game: 'Other server', protocol: 1 }) },
    { ok: true, json: async () => ({ game: 'DEAD FREQUENCY', protocol: 999 }) }, healthy(),
  ];
  const platform = fixture(t, { request: async () => replies[calls++], refreshDns: async () => { refreshed++; } });
  const pending = platform.prepareInvite(invite).then(() => { ready = true; });
  await flush(); assert.equal(ready, false);
  t.mock.timers.tick(1000); await flush(); assert.equal(ready, false);
  t.mock.timers.tick(1000); await pending;
  assert.equal(calls, 3); assert.equal(refreshed, 0);
});

test('the three-second request deadline also bounds a stalled JSON body', async t => {
  let calls = 0, firstSignal;
  const platform = fixture(t, { request: async (_url, init) => {
    if (++calls > 1) return healthy();
    firstSignal = init.signal; return { ok: true, json: () => new Promise(() => {}) };
  } });
  const pending = platform.prepareInvite(invite);
  await flush(); t.mock.timers.tick(3000); await flush(); assert.equal(firstSignal.aborted, true);
  t.mock.timers.tick(1000); await pending; assert.equal(calls, 2);
});

test('stopHost invalidates a positive response already in flight', async t => {
  let release;
  const body = new Promise(resolve => { release = resolve; });
  const platform = fixture(t, { request: async () => ({ ok: true, json: () => body }) });
  const rejected = assert.rejects(platform.prepareInvite(invite), /Verbindung abgebrochen/);
  await flush(); await platform.stopHost(); release({ game: 'DEAD FREQUENCY', protocol: 1 }); await rejected;
});

test('stopHost during DNS publication prevents all subsequent HTTP work', async t => {
  let release, calls = 0;
  const publication = new Promise(resolve => { release = resolve; });
  const platform = fixture(t, { waitForDns: () => publication, request: async () => { calls++; return healthy(); } });
  const rejected = assert.rejects(platform.prepareInvite(invite), /Verbindung abgebrochen/);
  await flush(); await platform.stopHost(); release(); await rejected; assert.equal(calls, 0);
});

test('the preparation IPC accepts only valid game invitations and leaves LAN local', async t => {
  let requests = 0, publications = 0;
  const platform = fixture(t, { request: async () => { requests++; return healthy(); }, waitForDns: async () => { publications++; } });
  for (const invalid of [null, '', 'not a URL', 'javascript:alert(1)',
    `https://example.com/coop?token=${token}`, `https://valid-test.trycloudflare.com:444/coop?token=${token}`,
    `https://user:password@valid-test.trycloudflare.com/coop?token=${token}`,
    `https://valid-test.trycloudflare.com.attacker.invalid/coop?token=${token}`,
    `https://valid-test.trycloudflare.com/private?token=${token}`,
    `https://valid-test.trycloudflare.com/coop?token=short`, `${invite}&token=${token}`, `${invite}&url=http://localhost`,
    `ws://8.8.8.8/coop?token=${token}`, `ws://10.attacker.invalid/coop?token=${token}`,
  ]) await assert.rejects(platform.prepareInvite(invalid));
  for (const hostname of ['localhost', '127.0.0.1', '192.168.1.9', '10.2.3.4', '172.20.1.3', '100.100.10.10']) {
    await platform.prepareInvite(`ws://${hostname}:45678/coop?token=${token}`);
  }
  assert.equal(requests, 0); assert.equal(publications, 0);
});
