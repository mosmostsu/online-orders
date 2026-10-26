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

test('pivotSizes: แถว = ชื่อ+สี คอลัมน์ = ไซส์ เลขก่อน ตามด้วย S M L XL 2XL', () => {
  const p = pivotSizes([
    { sku: 'a', name: 'กางเกง', color: 'ดำ', size: 'XL', qty: 1 },
    { sku: 'b', name: 'กางเกง', color: 'ดำ', size: 'S', qty: 7 },
    { sku: 'c', name: 'กางเกง', color: 'ดำ', size: '2XL', qty: 2 },
    { sku: 'd', name: 'รองเท้า', color: 'ดำ', size: '40', qty: 1 },
    { sku: 'e', name: 'รองเท้า', color: 'ดำ', size: '37', qty: 4 },
    { sku: 'f', name: 'รองเท้า', color: 'ขาว', size: '9.5', qty: 1 },
    { sku: 'g', name: 'หมวก', color: '', size: '', qty: 3 },
  ]);
  // รหัสรุ่น+สี = ส่วนต้นที่ทุก SKU ในแถวมีร่วมกัน (b516B ของ b516BS / b516BXL)
  assert.deepEqual(pivotSizes([
    { sku: 'b516BS', name: 'ก', color: 'ดำ', size: 'S', qty: 1 },
    { sku: 'b516BXL', name: 'ก', color: 'ดำ', size: 'XL', qty: 1 },
    { sku: 'HR5373', name: 'ข', color: '', size: '', qty: 1 },
  ]).rows.map((r) => r.code), ['b516B', 'HR5373']);
  assert.deepEqual(p.sizes, ['9.5', '37', '40', 'S', 'XL', '2XL']);
  assert.deepEqual(p.rows.map((r) => [r.name, r.color, r.cells, r.total]), [
    ['กางเกง', 'ดำ', { XL: 1, S: 7, '2XL': 2 }, 10],
    ['รองเท้า', 'ดำ', { 40: 1, 37: 4 }, 5],
    ['รองเท้า', 'ขาว', { 9.5: 1 }, 1],
    ['หมวก', '', {}, 3],
  ]);
});
