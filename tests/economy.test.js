import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEconomy, createItem, storeItem, storeAll, listItem, marketQuote, saleChance, advanceMarket, cancelListing, claimMail, claimAll } from '../src/economy.js';
const now = 1_800_000_000_000;
const make = () => ({ credits: 750, ...validateEconomy() });
const item = { name: 'Funkmodul', value: 340, rarity: 'rare' };
const seedItem = p => { const i = createItem(p,item);p.stash.push(i);return i; };

test('legacy economy migrates to empty storage without altering credits', () => {
  assert.deepEqual(validateEconomy(), {stash:[], intake:[], listings:[], mailbox:[], nextItemId:1, marketTime:0});
});
test('intake must be deliberately stored and keeps item identity', () => {
  const p=make(), a=createItem(p,item), b=createItem(p,item);p.intake.push(a,b);
  assert.equal(storeItem(p,a.id),true);assert.equal(storeItem(p,a.id),false);
  assert.equal(storeAll(p),true);assert.equal(storeAll(p),false);
  assert.deepEqual(p.stash,[a,b]);assert.equal(p.credits,750);
});
test('listing validates price/duration/ownership and escrows exactly one item', () => {
  const p=make(), a=seedItem(p);
  for(const price of [NaN,Infinity,0,-1,1.1,1_000_001]) assert.equal(listItem(p,a.id,price,5,now),false);
  assert.equal(listItem(p,a.id,400,3,now),false);assert.equal(p.stash.length,1);
  assert.equal(listItem(p,a.id,400,5,now),true);assert.equal(listItem(p,a.id,400,5,now),false);
  assert.equal(p.stash.length,0);assert.deepEqual(p.listings[0].item,a);assert.equal(p.credits,750);
});
test('first buyer takes at least sixty seconds; no instant sale', () => {
  const p=make(), a=seedItem(p);listItem(p,a.id,1,2,now);
  assert.equal(advanceMarket(p,now+59_999),false);assert.equal(p.listings.length,1);assert.equal(p.mailbox.length,0);
});
test('prices fluctuate smoothly, stay bounded, and expensive asks reduce chance', () => {
  const quotes=new Set();for(let t=0;t<86_400;t+=13){const q=marketQuote(item,now+t*1000);quotes.add(q);assert.ok(q>=item.value*.71&&q<=item.value*1.29);}
  assert.ok(quotes.size>80);assert.ok(saleChance(item,100,now)>saleChance(item,340,now));assert.ok(saleChance(item,340,now)>saleChance(item,1000,now));
});
test('offline catch-up equals continuous processing and saved reload cannot reroll', () => {
  const p=make();for(let i=0;i<20;i++){const a=seedItem(p);listItem(p,a.id,100+i*50,5,now);}
  const a=structuredClone(p),b=structuredClone(p);
  for(let t=now;t<now+600_000;t+=1000)advanceMarket(a,t);
  advanceMarket(a,now+600_000);advanceMarket(b,now+600_000);
  // Mail record order depends on polling cadence; results per item and balances do not.
  const outcomes=p=>p.mailbox.map(m=>({type:m.type,item:m.item.id,credits:m.credits,createdAt:m.createdAt})).sort((x,y)=>x.item.localeCompare(y.item));
  assert.deepEqual(outcomes(a),outcomes(b));assert.equal(a.mailbox.length,20);assert.equal(a.listings.length,0);
  const reloaded={credits:750,...validateEconomy(p)};advanceMarket(reloaded,now+600_000);assert.deepEqual(outcomes(b),outcomes(reloaded));
});
test('sold offer pays the chosen price only once when claimed', () => {
  const p=make(),a=seedItem(p);listItem(p,a.id,1,10,now);advanceMarket(p,now+600_000);
  assert.equal(p.mailbox[0].type,'sale');assert.equal(p.mailbox[0].credits,1);assert.equal(p.credits,750);
  const id=p.mailbox[0].id;assert.equal(claimMail(p,id),true);assert.equal(p.credits,751);assert.equal(claimMail(p,id),false);assert.equal(p.stash.length,0);
});
test('unfilled and cancelled offers return recoverable items through mailbox', () => {
  const p=make(),a=seedItem(p);listItem(p,a.id,1_000_000,2,now);advanceMarket(p,now+120_000);
  assert.equal(p.mailbox[0].type,'return');assert.equal(p.stash.length,0);
  claimAll(p);assert.deepEqual(p.stash,[a]);listItem(p,a.id,340,5,now+120_000);
  const id=p.listings[0].id;assert.equal(cancelListing(p,id,now+120_001),true);assert.equal(cancelListing(p,id,now+120_001),false);
  assert.equal(p.mailbox[0].reason,'Abgebrochen');claimAll(p);assert.deepEqual(p.stash,[a]);assert.equal(p.credits,750);
});
test('clock rollback never rechecks buyers or extends an offer', () => {
  const p=make(),a=seedItem(p);listItem(p,a.id,1_000_000,5,now);advanceMarket(p,now+80_000);
  const before=JSON.stringify(p);advanceMarket(p,now-500_000);assert.equal(JSON.stringify(p),before);
});
test('migration rejects duplicate items and duplicate mailbox claims; serial never collides', () => {
  const p=make(),a=seedItem(p);p.intake.push(structuredClone(a));
  p.mailbox.push({id:'mail-40',type:'sale',item:{...a,id:'item-35'},credits:500,createdAt:now});p.mailbox.push(structuredClone(p.mailbox[0]));
  const clean={credits:750,...validateEconomy(p)};assert.equal(clean.stash.length+clean.intake.length,1);assert.equal(clean.mailbox.length,1);
  const next=createItem(clean,item);assert.equal(next.id,'item-41');claimAll(clean);assert.equal(clean.credits,1250);assert.equal(claimAll(clean),false);
});
test('twenty active offer limit preserves the twenty-first item', () => {
  const p=make();for(let i=0;i<20;i++){const a=seedItem(p);assert.equal(listItem(p,a.id,500,5,now),true);}
  const extra=seedItem(p);assert.equal(listItem(p,extra.id,500,5,now),false);assert.deepEqual(p.stash,[extra]);
});
