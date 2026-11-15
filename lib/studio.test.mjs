// รัน: node --test lib/studio.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES, nextStatus, prevStatus, weekDays, postQueue, cutQueue, lowFootage, captionText, SHOPS, basketCandidates, basketOf, buildFolders, listingUrl } from './studio.js';

test('statuses', () => {
  assert.deepEqual(STATUSES.map(s => s.key), ['idea', 'need_footage', 'queued', 'cut', 'approved', 'posted']);
  assert.equal(nextStatus('cut'), 'approved'); assert.equal(nextStatus('posted'), null);
  assert.equal(prevStatus('approved'), 'cut'); assert.equal(prevStatus('idea'), null);
});
test('weekDays Monday-first', () => { assert.equal(weekDays('2026-11-18')[0], '2026-11-16'); assert.equal(weekDays('2026-11-22')[6], '2026-11-22'); });
test('postQueue overdue first, approved only', () => {
  const c = [{ id: 'a', status: 'approved', date: '2026-11-17', slot: 1 }, { id: 'b', status: 'cut', date: '2026-11-17' }, { id: 'c', status: 'approved', date: '2026-11-15' }, { id: 'd', status: 'approved', date: '2026-11-18' }];
  assert.deepEqual(postQueue(c, '2026-11-17').map(x => x.id), ['c', 'a']);
});
test('cutQueue', () => assert.deepEqual(cutQueue([{ id: 'x', status: 'queued', date: '2026-11-20' }, { id: 'z', status: 'queued', date: '2026-11-18' }, { id: 'y', status: 'idea' }]).map(x => x.id), ['z', 'x']));
test('lowFootage', () => assert.deepEqual(lowFootage([{ key: 'a', n: 2 }, { key: 'b', n: 24 }, { key: 'c', n: 4 }]).map(x => x.key), ['a', 'c']));
test('captionText', () => { assert.equal(captionText({ caption: 'a', hashtags: ['#b', '#c'] }), 'a\n\n#b #c'); assert.equal(captionText({}), ''); });
test('SHOPS', () => assert.deepEqual(SHOPS.map(s => s.key), ['SOLID', 'REAL', 'MVP', 'PACE']));

test('basketCandidates matches by folder rules, max 8', () => {
  const L = [{ product_id: '1', title: 'กางเกงวอร์ม Flyhawk [b516 b517]' }, { product_id: '2', title: 'เสื้อโปโล' }];
  assert.deepEqual(basketCandidates('กางเกงวอร์ม/Flyhawk b516-b517', L).map(x => x.product_id), ['1']);
  assert.deepEqual(basketCandidates('กางเกงวอร์ม/รวมยี่ห้อ-อื่นๆ', L), []);
  // folder with no rule falls back to words of the sub name
  assert.deepEqual(basketCandidates('เสื้อโปโล-เสื้อกีฬา/โปโล', L).map(x => x.product_id), ['2']);
});

test('basketOf: clip override, else folder basket for clip shop, else null', () => {
  const listings = { 'tiktok:SOLID:1': { product_id: '1', title: 'T', thumb_url: 'u' } };
  const folders = { 'f/a': { baskets: { SOLID: { platform: 'tiktok', id: '1' }, PACE: { url: 'https://pace/x' } } } };
  assert.equal(basketOf({ folder: 'f/a', shop: 'SOLID' }, folders, listings).title, 'T');
  assert.equal(basketOf({ folder: 'f/a', shop: 'PACE' }, folders, listings).url, 'https://pace/x');
  assert.equal(basketOf({ folder: 'f/a', shop: 'MVP' }, folders, listings), null);
  assert.equal(basketOf({ folder: 'f/a', shop: 'SOLID', basket_url: 'https://own' }, folders, listings).url, 'https://own');
});

test('listingUrl', () => {
  assert.equal(listingUrl('tiktok', '9'), 'https://shop.tiktok.com/view/product/9?region=TH');
  assert.match(listingUrl('shopee', '5', '7'), /shopee\.co\.th\/product\/7\/5/);
});

test('buildFolders counts videos per cat/sub, newest time, ignores non-video', () => {
  const cats = [{ id: 'c1', name: 'กางเกงวอร์ม' }];
  const subs = [{ id: 's1', name: 'Flyhawk b516-b517', parents: ['c1'] }, { id: 's2', name: 'ว่าง', parents: ['c1'] }];
  const files = [
    { parents: ['s1'], mimeType: 'video/mp4', modifiedTime: '2026-11-10T00:00:00Z' },
    { parents: ['s1'], mimeType: 'video/quicktime', modifiedTime: '2026-11-14T00:00:00Z' },
    { parents: ['s1'], mimeType: 'text/plain', modifiedTime: '2026-11-20T00:00:00Z' },
  ];
  const f = buildFolders(cats, subs, files);
  assert.deepEqual(f.map(x => [x.key, x.n, x.latest]), [['กางเกงวอร์ม/Flyhawk b516-b517', 2, '2026-11-14T00:00:00Z'], ['กางเกงวอร์ม/ว่าง', 0, null]]);
  assert.equal(f[0].drive_url, 'https://drive.google.com/drive/folders/s1');
});
