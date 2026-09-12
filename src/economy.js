// Local buyers advance on wall-clock time; outcomes are stable across reloads.
export const MARKET_CHECK_MS = 30_000;
export const MARKET_DURATIONS = [2, 5, 10];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const integer = (v, fallback = 0, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(v) ? clamp(Math.floor(v), 0, max) : fallback;
const hash = text => { let n = 2166136261; for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
const draw = text => { let n=hash(text);n=Math.imul(n ^ n>>>16,0x21f0aaad);n=Math.imul(n ^ n>>>15,0x735a2d97);return ((n ^ n>>>15)>>>0)/4294967296; };
const clock = now => integer(now, Date.now());
const allocate = (profile, prefix) => `${prefix}-${profile.nextItemId++}`;

function cleanItem(item) {
  if (!item || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(item.value) || item.value < 1) return null;
  return { id: typeof item.id === 'string' ? item.id.slice(0, 100) : '', name: item.name.slice(0, 100),
    value: integer(item.value, 1, 1_000_000), rarity: ['common','rare','epic'].includes(item.rarity) ? item.rarity : 'common' };
}

export function createItem(profile, item) {
  const clean = cleanItem(item);
  if (!clean) throw new TypeError('Invalid inventory item');
  return { ...clean, id: allocate(profile, 'item') };
}

export function validateEconomy(src = {}) {
  src = src && typeof src === 'object' ? src : {};
  const result = { stash: [], intake: [], listings: [], mailbox: [], nextItemId: integer(src.nextItemId, 1) || 1, marketTime: clock(src.marketTime ?? 0) };
  const ids = new Set();
  // Reserve every saved serial before generating a replacement for a damaged ID.
  for (const list of [src.stash, src.intake, src.listings, src.mailbox]) if (Array.isArray(list)) for (const entry of list) {
    for (const id of [entry?.id, entry?.item?.id]) {
      const serial = typeof id === 'string' && /^(?:item|listing|mail)-(\d+)$/.exec(id);
      if (serial) result.nextItemId = Math.max(result.nextItemId, integer(Number(serial[1])) + 1);
    }
  }
  function uniqueItem(raw) {
    const item = cleanItem(raw);
    if (!item || ids.has(item.id)) return null;
    if (!/^item-\d+$/.test(item.id)) item.id = allocate(result, 'item');
    ids.add(item.id); return item;
  }
  for (const key of ['intake','stash']) if (Array.isArray(src[key])) for (const raw of src[key]) {
    const item = uniqueItem(raw); if (item) result[key].push(item);
  }
  const recordIds = new Set();
  function recordId(raw, prefix) {
    let id = typeof raw === 'string' && new RegExp(`^${prefix}-\\d+$`).test(raw) ? raw : allocate(result, prefix);
    if (recordIds.has(id)) return null;
    recordIds.add(id); return id;
  }
  if (Array.isArray(src.listings)) for (const raw of src.listings) {
    if (!raw || !Number.isInteger(raw.price) || raw.price < 1 || raw.price > 1_000_000 || !Number.isFinite(raw.createdAt) || !Number.isFinite(raw.expiresAt)) continue;
    const id = recordId(raw.id, 'listing'); if (!id) continue;
    const item = uniqueItem(raw.item); if (!item) continue;
    const createdAt = clock(raw.createdAt), expiresAt = clamp(clock(raw.expiresAt), createdAt + MARKET_CHECK_MS, createdAt + 600_000);
    result.listings.push({ id, item, price: raw.price, createdAt, expiresAt,
      nextCheckAt: clamp(clock(raw.nextCheckAt ?? createdAt + MARKET_CHECK_MS), createdAt + MARKET_CHECK_MS, expiresAt + MARKET_CHECK_MS), checks: integer(raw.checks, 0, 20) });
  }
  if (Array.isArray(src.mailbox)) for (const raw of src.mailbox) {
    if (!raw || !['sale','return'].includes(raw.type)) continue;
    const id = recordId(raw.id, 'mail'); if (!id) continue;
    const item = raw.type === 'return' ? uniqueItem(raw.item) : cleanItem(raw.item);
    if (!item) continue;
    const credits = raw.type === 'sale' ? integer(raw.credits, 0, 1_000_000) : 0;
    if (raw.type === 'sale' && !credits) continue;
    result.mailbox.push({ id, type: raw.type, item, credits, reason: raw.type === 'sale' ? 'Verkauft' : raw.reason === 'Abgebrochen' ? raw.reason : 'Nicht verkauft', createdAt: clock(raw.createdAt ?? 0) });
  }
  return result;
}

export function marketQuote(item, now = Date.now()) {
  const seed = hash(item.name), seconds = clock(now) / 1000;
  const multiplier = 1 + .12 * Math.sin(seconds / 43 + seed % 53) + .1 * Math.sin(seconds / 157 + seed % 97) + .06 * Math.sin(seconds / 613 + seed % 29);
  return Math.max(1, Math.round(item.value * multiplier));
}

export function saleChance(item, price, now = Date.now()) {
  if (!Number.isFinite(price) || price < 1) return 0;
  const ratio = price / marketQuote(item, now);
  return clamp(.38 * Math.exp(-4.5 * (ratio - 1)), .001, .88);
}

export function storeItem(profile, id) {
  const index = profile.intake.findIndex(item => item.id === id);
  if (index < 0) return false;
  profile.stash.push(profile.intake.splice(index, 1)[0]); return true;
}
export function storeAll(profile) {
  if (!profile.intake.length) return false;
  profile.stash.push(...profile.intake.splice(0)); return true;
}

export function listItem(profile, id, price, durationMinutes = 5, now = Date.now()) {
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000 || !MARKET_DURATIONS.includes(durationMinutes) || profile.listings.length >= 20) return false;
  const index = profile.stash.findIndex(item => item.id === id);
  if (index < 0) return false;
  const createdAt = Math.max(clock(now), profile.marketTime), listingId = allocate(profile, 'listing');
  const item = profile.stash.splice(index, 1)[0];
  profile.listings.push({ id: listingId, item, price, createdAt, expiresAt: createdAt + durationMinutes * 60_000,
    nextCheckAt: createdAt + MARKET_CHECK_MS + Math.floor(draw(listingId + createdAt) * 15_000), checks: 0 });
  return true;
}

function settle(profile, listing, type, at, reason) {
  profile.mailbox.push({ id: allocate(profile, 'mail'), type, item: listing.item,
    credits: type === 'sale' ? listing.price : 0, reason, createdAt: at });
}

export function advanceMarket(profile, now = Date.now()) {
  const time = Math.max(clock(now), profile.marketTime);
  profile.marketTime = time;
  let changed = false;
  profile.listings = profile.listings.filter(listing => {
    while (listing.nextCheckAt <= time && listing.nextCheckAt <= listing.expiresAt) {
      const at = listing.nextCheckAt;
      listing.checks++; listing.nextCheckAt += MARKET_CHECK_MS; changed = true;
      if (draw(`${listing.id}:${listing.createdAt}:${listing.item.id}:${listing.checks}`) < saleChance(listing.item, listing.price, at)) {
        settle(profile, listing, 'sale', at, 'Verkauft'); return false;
      }
    }
    if (time >= listing.expiresAt) { settle(profile, listing, 'return', listing.expiresAt, 'Nicht verkauft'); changed = true; return false; }
    return true;
  });
  return changed;
}

export function cancelListing(profile, id, now = Date.now()) {
  advanceMarket(profile, now);
  const index = profile.listings.findIndex(listing => listing.id === id);
  if (index < 0) return false;
  const listing = profile.listings.splice(index, 1)[0];
  settle(profile, listing, 'return', Math.max(clock(now), profile.marketTime), 'Abgebrochen'); return true;
}

export function claimMail(profile, id) {
  const index = profile.mailbox.findIndex(mail => mail.id === id);
  if (index < 0) return false;
  const mail = profile.mailbox[index];
  if (mail.type === 'sale') profile.credits += mail.credits;
  else profile.stash.push(mail.item);
  profile.mailbox.splice(index, 1); return true;
}
export function claimAll(profile) {
  if (!profile.mailbox.length) return false;
  for (const id of profile.mailbox.map(mail => mail.id)) claimMail(profile, id);
  return true;
}
