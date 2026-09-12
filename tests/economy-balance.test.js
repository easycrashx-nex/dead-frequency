import test from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY_BALANCE, MARKET_CHECK_MS, MARKET_DURATIONS, marketQuote, saleChance, createItem, listItem, advanceMarket, cancelListing, claimMail, claimAll } from '../src/economy.js';
import { ITEM_CATALOG, ITEM_POOLS, CONTAINER_TYPES, LEGACY_ITEMS, rollContainerItems } from '../src/loot-catalog.js';
import { createGame, validateProfile, seededRandom } from '../src/simulation.js';
import { SKILL_NODES } from '../src/progression.js';
import { EXTRACTIONS, RELAY } from '../src/layout.js';
import { takeFirstContainerItem } from './container-helpers.js';

const NOW = 1_800_000_000_000;
const sourceByName = new Map(ITEM_CATALOG.map(item => [item.name, item]));
const step = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, {}); };
const addStash = (profile, source = ITEM_CATALOG[0]) => { const item = createItem(profile, source); profile.stash.push(item); return item; };
const goods = container => container.items.filter(item => !item.kind);
const logisticsSkills = { xp: 1000, unlocked: SKILL_NODES.filter(node => node.branch === 'logistics').map(node => node.id) };
async function newRaid(t, saved = {}, difficulty = 'normal') {
  const game = await createGame(saved, { externalAI: true }); t.after(() => game.dispose());
  assert.equal(game.startRaid({ kit: 'scout', weapon: 'VX-9', difficulty, seed: 1808 }), true);
  game.state.enemies = []; return game;
}
function killAt(game, id, x, kind = 'guard') {
  const enemy = { id, x, z: 126, hp: 1, kind, dead: false, fireTimer: 100, alert: 0, pathTimer: 0 };
  game.state.enemies.push(enemy);
  const p = game.state.player;
  assert.equal(game.fire({ x: enemy.x - p.x, y: 1.1 - p.y - 1.65, z: enemy.z - p.z }), true);
  assert.equal(enemy.dead, true); step(game, .15); return enemy;
}
function activateRelay(game) {
  assert.equal(game.teleport(RELAY.x, RELAY.z), true);
  assert.equal(game.state.prompt?.kind, 'relay'); assert.equal(game.interact(), true);
  assert.equal(game.state.raid.objectiveComplete, true);
}
function extract(game) {
  const exit = EXTRACTIONS[0]; assert.equal(game.teleport(exit.x, exit.z), true);
  assert.equal(game.state.prompt?.kind, 'extract'); assert.equal(game.interact(), true);
  step(game, game.state.raid.extractionDuration + .1); assert.equal(game.state.phase, 'extracted');
}

test('slower economy exposes the agreed values while existing market quotes stay unchanged', () => {
  assert.deepEqual(ECONOMY_BALANCE, { lootValueMultiplier: .65, killBonus: 15, relayBonus: 150, extractionSkillBonus: 50 });
  assert.equal(MARKET_CHECK_MS, 60_000); assert.deepEqual(MARKET_DURATIONS, [2, 5, 10]);
  const times = [NOW, NOW + 60_000, NOW + 600_000, NOW + 86_400_000];
  assert.deepEqual(times.map(now => marketQuote({ name: 'Funkmodul', value: 340 }, now)), [315, 331, 303, 328]);
  assert.deepEqual(times.map(now => marketQuote({ name: 'Wärmebildmatrix', value: 1050 }, now)), [897, 894, 1010, 1180]);
});

test('fair-price chance is 18 percent, bargain chance caps at 65 percent and double-price asks have no floor', () => {
  for (const item of ITEM_CATALOG) for (const now of [NOW, NOW + 120_000, NOW + 86_400_000]) {
    const quote = marketQuote(item, now);
    assert.equal(saleChance(item, quote, now), .18, item.name);
    assert.equal(saleChance(item, 1, now), .65, item.name);
    assert.ok(saleChance(item, quote * 1.5, now) > 0);
    assert.ok(saleChance(item, quote * 1.5, now) < .18);
    for (const price of [quote * 2, quote * 2 + 1, 1_000_000]) assert.equal(saleChance(item, price, now), 0, `${item.name}: ${price}`);
  }
});

test('new listings wait 60 to 90 seconds for their first buyer and then advance in sixty-second steps', () => {
  const profile = validateProfile(null);
  for (let index = 0; index < 20; index++) {
    const item = addStash(profile, ITEM_CATALOG[index]);
    assert.equal(listItem(profile, item.id, 1_000_000, 10, NOW), true);
  }
  const starts = profile.listings.map(listing => listing.nextCheckAt);
  assert.ok(starts.every(at => at >= NOW + 60_000 && at < NOW + 90_000));
  assert.equal(advanceMarket(profile, NOW + 59_999), false);
  assert.equal(profile.mailbox.length, 0); assert.ok(profile.listings.every(listing => listing.checks === 0));
  advanceMarket(profile, NOW + 89_999);
  profile.listings.forEach((listing, index) => { assert.equal(listing.checks, 1); assert.equal(listing.nextCheckAt, starts[index] + 60_000); });
  advanceMarket(profile, NOW + 149_999);
  profile.listings.forEach((listing, index) => { assert.equal(listing.checks, 2); assert.equal(listing.nextCheckAt, starts[index] + 120_000); });
  assert.equal(profile.mailbox.length, 0);
});

test('two thousand million-credit offers never sell during large offline catch-up or saved reloads', () => {
  let profile = validateProfile(null);
  for (let batch = 0; batch < 100; batch++) {
    const now = NOW + batch * 86_400_000;
    for (let index = 0; index < 20; index++) {
      const item = addStash(profile, ITEM_CATALOG[(batch * 20 + index) % ITEM_CATALOG.length]);
      assert.equal(listItem(profile, item.id, 1_000_000, [2, 5, 10][index % 3], now), true);
    }
    profile = validateProfile({ version: 2, profile: structuredClone(profile) });
    advanceMarket(profile, now + 86_399_999);
    assert.equal(profile.listings.length, 0); assert.equal(profile.mailbox.length, 20);
    assert.ok(profile.mailbox.every(mail => mail.type === 'return' && mail.credits === 0), `False million-price sale in batch ${batch}`);
    assert.equal(claimAll(profile), true); assert.equal(claimAll(profile), false);
    assert.equal(profile.credits, 750); assert.equal(profile.stash.length, (batch + 1) * 20);
  }
});

test('cancel, return, reclaim and relist cannot turn the same twenty items into million-credit payouts', () => {
  let profile = validateProfile(null);
  const original = Array.from({ length: 20 }, (_, index) => addStash(profile, ITEM_CATALOG[index]));
  const canonical = items => [...items].sort((a, b) => a.id.localeCompare(b.id));
  for (let cycle = 0; cycle < 30; cycle++) {
    const now = NOW + cycle * 700_000;
    for (const item of [...profile.stash]) assert.equal(listItem(profile, item.id, 1_000_000, 5, now), true);
    advanceMarket(profile, now + 90_000);
    if (cycle % 2 === 0) for (const listing of [...profile.listings]) {
      assert.equal(cancelListing(profile, listing.id, now + 90_001), true);
      assert.equal(cancelListing(profile, listing.id, now + 90_001), false);
    } else advanceMarket(profile, now + 600_000);
    profile = validateProfile(profile);
    assert.equal(profile.mailbox.length, 20); assert.ok(profile.mailbox.every(mail => mail.type === 'return'));
    for (const mail of [...profile.mailbox]) { assert.equal(claimMail(profile, mail.id), true); assert.equal(claimMail(profile, mail.id), false); }
    assert.deepEqual(canonical(profile.stash), canonical(original)); assert.equal(profile.credits, 750);
  }
});

test('profile validation preserves existing balances, old item values and already-settled mailbox proceeds', () => {
  const saved = validateProfile({ credits: 12_345_678_901, raids: 42, extracts: 31, best: 5400, progression: { xp: 1234, unlocked: [] } });
  const stash = createItem(saved, { name: 'Wärmebildmatrix', value: 1050, rarity: 'epic' });
  const intake = createItem(saved, { name: 'Offiziers-Chip', value: 420, rarity: 'epic' });
  const sold = createItem(saved, { name: 'Quantenprozessor', value: 780, rarity: 'epic' });
  const returned = createItem(saved, { name: 'Kupferspulen', value: 120, rarity: 'common' });
  saved.stash.push(stash); saved.intake.push(intake);
  saved.mailbox.push({ id: 'mail-40', type: 'sale', item: sold, credits: 1_000_000, reason: 'Verkauft', createdAt: NOW - 600_000 },
    { id: 'mail-41', type: 'return', item: returned, credits: 0, reason: 'Nicht verkauft', createdAt: NOW - 600_000 });
  const clean = validateProfile({ version: 2, profile: structuredClone(saved) });
  for (const key of ['credits', 'stash', 'intake', 'mailbox', 'progression', 'raids', 'extracts', 'best']) assert.deepEqual(clean[key], saved[key], key);
  advanceMarket(clean, NOW + 31_536_000_000);
  assert.deepEqual(clean.mailbox, saved.mailbox); assert.equal(claimAll(clean), true);
  assert.equal(clean.credits, saved.credits + 1_000_000); assert.equal(claimAll(clean), false);
  assert.deepEqual(clean.stash, [stash, returned]); assert.deepEqual(clean.intake, [intake]);
});

test('new container goods use 65 percent of original values, keep hard-mode uplift and never duplicate within a crate', () => {
  assert.deepEqual(LEGACY_ITEMS.map(item => item.value), [120, 160, 140, 290, 340, 270, 650, 780, 590]);
  assert.equal(sourceByName.get('Wärmebildmatrix').value, 1050); assert.equal(sourceByName.get('Leere Patronenhülsen').value, 55);
  const untouched = structuredClone(ITEM_CATALOG);
  for (const type of CONTAINER_TYPES) for (let seed = 1; seed <= 40; seed++) {
    const spot = { id: `balance-${type.id}`, type: type.id };
    const normal = rollContainerItems(spot, seededRandom(seed), 1, 'normal');
    const hard = rollContainerItems(spot, seededRandom(seed), 1, 'hard');
    const trade = normal.filter(item => !item.kind);
    assert.ok(trade.length >= 3 && trade.length <= 5);
    assert.equal(new Set(trade.map(item => item.name)).size, trade.length);
    assert.equal(new Set(normal.map(item => item.id)).size, normal.length);
    assert.deepEqual(normal.map(item => item.name), hard.map(item => item.name));
    for (const [difficulty, rolled] of [['normal', normal], ['hard', hard]]) for (const item of rolled) {
      if (item.kind) { assert.equal(item.value, 0); assert.equal(item.amount, item.kind === 'ammo' ? 36 : 1); }
      else { const original = sourceByName.get(item.name); assert.ok(original); assert.equal(item.value, Math.round(original.value * .65 * (difficulty === 'hard' ? 1.35 : 1))); }
    }
  }
  assert.deepEqual(ITEM_CATALOG, untouched);
});

test('deterministic crate samples favor common goods with per-item rarity weights 6:3:1', () => {
  const weights = { common: 6, rare: 3, epic: 1 }, samples = 4000;
  for (const type of CONTAINER_TYPES) {
    const pool = ITEM_POOLS[type.id], counts = { common: 0, rare: 0, epic: 0 };
    const totalWeight = pool.reduce((sum, item) => sum + weights[item.rarity], 0);
    for (let seed = 1; seed <= samples; seed++) {
      const first = rollContainerItems({ id: 'weight-check', type: type.id }, seededRandom(seed), 1)[0];
      counts[first.rarity]++;
    }
    for (const rarity of Object.keys(weights)) {
      const expected = pool.filter(item => item.rarity === rarity).length * weights[rarity] / totalWeight;
      assert.ok(Math.abs(counts[rarity] / samples - expected) < .025, `${type.id}/${rarity}: got ${counts[rarity] / samples}, expected ${expected}`);
    }
  }
});

test('actual newly started normal and hard raids contain the reduced goods instead of raw catalog prices', async t => {
  for (const difficulty of ['normal', 'hard']) {
    const game = await newRaid(t, {}, difficulty);
    assert.ok(game.state.containers.length > 20);
    for (const container of game.state.containers) {
      const trade = goods(container); assert.ok(trade.length >= 3 && trade.length <= 5);
      assert.equal(new Set(trade.map(item => item.name)).size, trade.length);
      for (const item of trade) assert.equal(item.value, Math.round(sourceByName.get(item.name).value * .65 * (difficulty === 'hard' ? 1.35 : 1)));
    }
  }
});

for (const skill of [false, true]) test(`real kills, officer drop, relay and extraction pay once${skill ? ' with the reduced extraction skill' : ' without an extraction skill'}`, async t => {
  const game = await newRaid(t, skill ? { progression: logisticsSkills } : {}), initialCredits = game.state.profile.credits, initialXP = game.state.profile.progression.xp;
  const first = takeFirstContainerItem(game); game.closeContainer();
  assert.equal(game.teleport(-140, 130), true); const elite = killAt(game, 'balance-elite', -140, 'elite'); killAt(game, 'balance-guard', -139);
  const chip = game.state.loot.find(item => item.name === 'Offiziers-Chip'); assert.ok(chip);
  assert.equal(chip.value, Math.round(420 * .65));
  assert.equal(game.teleport(elite.x, elite.z), true);
  for (let attempt = 0; attempt < 4 && !chip.taken; attempt++) assert.equal(game.interact(), true);
  assert.equal(chip.taken, true); assert.equal(game.state.raid.kills, 2);
  activateRelay(game); assert.equal(game.state.profile.credits, initialCredits);
  extract(game);
  const expectedBonus = 2 * 15 + 150 + (skill ? 50 : 0);
  assert.equal(game.state.result.bonus, expectedBonus); assert.equal(game.state.result.total, expectedBonus);
  assert.equal(game.state.profile.credits, initialCredits + expectedBonus);
  assert.equal(game.state.result.value, first.value + chip.value); assert.equal(game.state.profile.intake.length, 2);
  assert.equal(game.state.result.xpEarned, 320); assert.equal(game.state.profile.progression.xp, initialXP + 320);
  const settled = structuredClone(game.state.profile);
  step(game, 60); assert.equal(game.interact(), false); game.endRaid(); game.returnToHub();
  assert.deepEqual(game.state.profile, settled); assert.deepEqual(validateProfile(game.getSave()), settled);
});

test('failed extraction pays no pending kill, relay or skill bonus while keeping earned XP', async t => {
  const game = await newRaid(t, { progression: logisticsSkills }), bank = game.state.profile.credits, xp = game.state.profile.progression.xp;
  takeFirstContainerItem(game); game.closeContainer(); assert.equal(game.teleport(-140, 130), true);
  killAt(game, 'failed-balance-elite', -140, 'elite'); activateRelay(game);
  game.endRaid('Testabbruch');
  assert.equal(game.state.phase, 'dead'); assert.equal(game.state.result.total, 0); assert.equal(game.state.result.bonus, 0);
  assert.equal(game.state.profile.credits, bank); assert.deepEqual(game.state.profile.intake, []);
  assert.equal(game.state.profile.progression.xp, xp + 110); assert.equal(game.state.result.xpEarned, 110);
  game.endRaid(); step(game, 60); assert.equal(game.state.profile.credits, bank); assert.equal(game.state.profile.progression.xp, xp + 110);
});
