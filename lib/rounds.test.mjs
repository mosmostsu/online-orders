// รัน: node --test lib/rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiDay, dayRange, splitRounds, sumSkus, splitVariant, pivotSizes } from './rounds.js';

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

test('splitVariant แยกสีกับไซส์จากชื่อตัวเลือก', () => {
  assert.deepEqual(splitVariant('WP-สีขาวชมพู,41'), { color: 'WP-สีขาวชมพู', size: '41' });   // Shopee
  assert.deepEqual(splitVariant('กรม, L'), { color: 'กรม', size: 'L' });                      // TikTok
  assert.deepEqual(splitVariant('Color family:Black, Size:L'), { color: 'Black', size: 'L' }); // Lazada
  assert.deepEqual(splitVariant('F9N1510-LB'), { color: 'F9N1510-LB', size: '' });
  assert.deepEqual(splitVariant(null), { color: '', size: '' });
});

test('sumSkus รวมชิ้นตาม SKU เรียงตาม SKU แบบชีต ไม่มี SKU ใช้ชื่อแทนและไว้ท้าย', () => {
  const rows = sumSkus([
    { os_order_items: [{ sku: 'b516BXL', product_name: 'กางเกง', variant: 'สีดำ-ขาปล่อย,XL', qty: 1 }, { sku: 'B10', product_name: 'ถุงเท้า', qty: 1 }] },
    { os_order_items: [{ sku: 'B10', product_name: 'ถุงเท้า', qty: 3 }, { sku: null, product_name: 'หมวก', qty: 2 }, { sku: 'b516BS', product_name: 'กางเกง', variant: 'สีดำ-ขาปล่อย,S', qty: 1 }] },
  ]);
  assert.deepEqual(rows, [
    { sku: 'B10', name: 'ถุงเท้า', color: '', size: '', qty: 4 },
    { sku: 'b516BS', name: 'กางเกง', color: 'สีดำ-ขาปล่อย', size: 'S', qty: 1 },
    { sku: 'b516BXL', name: 'กางเกง', color: 'สีดำ-ขาปล่อย', size: 'XL', qty: 1 },
    { sku: '', name: 'หมวก', color: '', size: '', qty: 2 },
  ]);
});

test('pivotSizes แยกตาราง รองเท้า (ไซส์เลข) / เสื้อผ้า (S-XL) / ไม่มีไซส์', () => {
  const p = pivotSizes([
    { sku: 'b516BXL', name: 'กางเกง', color: 'ดำ', size: 'XL', qty: 1 },
    { sku: 'b516BS', name: 'กางเกง', color: 'ดำ', size: 'S', qty: 7 },
    { sku: 'b516B2XL', name: 'กางเกง', color: 'ดำ', size: '2XL', qty: 2 },
    { sku: 'bk4BK40', name: 'รองเท้า', color: 'ดำ', size: '40', qty: 1 },
    { sku: 'bk4BK37', name: 'รองเท้า', color: 'ดำ', size: '37', qty: 4 },
    { sku: 'F35543-7', name: 'แตะ', color: 'ดำขาว', size: 'UK7/EU40.5/255', qty: 1 },
    { sku: 'HR5373', name: 'กระเป๋า', color: '', size: '', qty: 3 },
  ]);
  assert.deepEqual(p.map((t) => [t.key, t.sizes, t.rows.map((r) => [r.name, r.code, r.cells, r.total])]), [
    ['shoe', ['37', '40', 'UK7/EU40.5/255'], [
      ['รองเท้า', 'bk4BK', { 40: 1, 37: 4 }, 5],
      ['แตะ', 'F35543-7', { 'UK7/EU40.5/255': 1 }, 1],
    ]],
    ['cloth', ['S', 'XL', '2XL'], [['กางเกง', 'b516B', { XL: 1, S: 7, '2XL': 2 }, 10]]],
    ['none', [], [['กระเป๋า', 'HR5373', {}, 3]]],
  ]);
});

test('pivotSizes ไม่มีของประเภทไหน ไม่ต้องมีตารางนั้น', () => {
  const p = pivotSizes([{ sku: 'a', name: 'ก', color: '', size: 'M', qty: 1 }]);
  assert.deepEqual(p.map((t) => t.key), ['cloth']);
});
