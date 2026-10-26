// รัน: node --test lib/rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiDay, dayRange, splitRounds, sumSkus } from './rounds.js';

const o = (shop, hhmm, extra = {}) => ({
  platform: 'tiktok', shop, order_id: shop + hhmm, status: 'packed',
  rts_at: `2026-10-26T${hhmm}:00+07:00`, os_order_items: [], ...extra,
});

test('thaiDay ใช้วันตามเวลาไทย ไม่ใช่ UTC', () => {
  assert.equal(thaiDay(new Date('2026-10-25T18:30:00Z')), '2026-10-26');   // 01:30 ไทย
  assert.equal(thaiDay(new Date('2026-10-25T16:59:00Z')), '2026-10-25');   // 23:59 ไทย
});

test('dayRange คืนเที่ยงคืนถึงเที่ยงคืนเวลาไทย', () => {
  assert.deepEqual(dayRange('2026-10-26'), {
    from: '2026-10-25T17:00:00.000Z', to: '2026-10-26T17:00:00.000Z',
  });
});

test('กดส่งห่างกันเกิน 45 นาที = รอบใหม่ แยกตามร้าน', () => {
  const rounds = splitRounds([
    o('SOLID', '08:10'), o('SOLID', '08:40'), o('SOLID', '09:20'),   // ห่าง 30 / 40 นาที — รอบเดียว
    o('SOLID', '13:40'), o('SOLID', '14:05'),
    o('REAL', '09:05', { platform: 'shopee' }),
  ]);
  assert.deepEqual(
    rounds.map((r) => [r.key, r.orders.length]),
    [['tiktok:SOLID:1', 3], ['shopee:REAL:1', 1], ['tiktok:SOLID:2', 2]],
  );
  assert.equal(rounds[0].from, '2026-10-26T08:10:00+07:00');
  assert.equal(rounds[0].to, '2026-10-26T09:20:00+07:00');
});

test('ห่างพอดี 45 นาทียังเป็นรอบเดิม', () => {
  const rounds = splitRounds([o('SOLID', '08:00'), o('SOLID', '08:45')]);
  assert.equal(rounds.length, 1);
});

test('ใบยกเลิกแยกไว้ ไม่นับในยอด แต่ยังช่วยต่อรอบ', () => {
  const [r] = splitRounds([
    o('SOLID', '08:00'), o('SOLID', '08:30', { status: 'cancelled' }), o('SOLID', '09:10'),
  ]);
  assert.equal(r.orders.length, 2);
  assert.equal(r.cancelled.length, 1);
});

test('sumSkus รวมชิ้นตาม SKU เรียงมากไปน้อย ไม่มี SKU ใช้ชื่อแทน', () => {
  const rows = sumSkus([
    { os_order_items: [{ sku: 'A', product_name: 'รองเท้า', qty: 1 }, { sku: 'B', product_name: 'ถุงเท้า', qty: 1 }] },
    { os_order_items: [{ sku: 'B', product_name: 'ถุงเท้า', qty: 3 }, { sku: null, product_name: 'หมวก', qty: 2 }] },
  ]);
  assert.deepEqual(rows, [
    { sku: 'B', name: 'ถุงเท้า', qty: 4 },
    { sku: '', name: 'หมวก', qty: 2 },
    { sku: 'A', name: 'รองเท้า', qty: 1 },
  ]);
});
