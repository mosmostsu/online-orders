// รัน: node --test lib/mvpOrders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMvpOrder, mvpStatus } from './mvpOrders.js';

// ค่าจริงจาก Seller Center ร้าน MVP 26/11/2026 (ตัดข้อมูลลูกค้าออก)
const base = {
  order_sn: '261126AG0XG5HE', list: 'processed', status: 1,
  create_time: 1795661609, arrange_time: 1795669920, pickup_time: 0, logistics_mtime: 1795674300,
  ship_by_date: 1795798799, total_price: '398', carrier: 'Standard Delivery - ส่งธรรมดาในประเทศ',
  items: [{ item_id: 25643976492, model_id: 248166650474, sku: 'b516BXL', name: 'กางเกงวอร์ม Fly Hawk b516', variant: 'สีดำ,XL', qty: 1, price: '398', image: 'sg-11134201-x' }],
};

test('สถานะจากแท็บ + เวลาของ Seller Center', () => {
  assert.equal(mvpStatus({ list: 'toship' }), 'to_ship');
  assert.equal(mvpStatus({ list: 'processed' }), 'packed');
  assert.equal(mvpStatus({ list: 'toship', arrange_time: 5 }), 'to_ship');   // แท็บชนะเวลา
  assert.equal(mvpStatus({ arrange_time: 5 }), 'packed');
  assert.equal(mvpStatus({ list: 'shipping' }), 'shipped');
  assert.equal(mvpStatus({ list: 'processed', pickup_time: 9 }), 'shipped');
  assert.equal(mvpStatus({ status: 4 }), 'done');
  assert.equal(mvpStatus({ status: 5, arrange_time: 5 }), 'cancelled');
});

test('แปลงเป็นออเดอร์ shopee/MVP — rts_at = เวลากดส่งจริง', () => {
  const now = new Date('2026-11-26T08:00:00Z');
  const { order, items } = normalizeMvpOrder(base, 'MVP', now);
  assert.equal(order.platform, 'shopee');
  assert.equal(order.shop, 'MVP');
  assert.equal(order.order_id, '261126AG0XG5HE');
  assert.equal(order.status, 'packed');
  assert.equal(order.rts_at, '2026-11-26T05:12:00.000Z');   // 12:12 ไทย → รอบ 2
  assert.equal(order.collected_at, null);
  assert.equal(order.cancelled_at, null);
  assert.equal(order.item_count, 1);
  assert.equal(order.raw, null);
  assert.deepEqual(items.map((i) => [i.line_id, i.sku, i.qty, i.image_url]),
    [['25643976492|248166650474', 'b516BXL', 1, 'https://cf.shopee.co.th/file/sg-11134201-x']]);
});

test('ยกเลิก: ใช้เวลาพัสดุขยับล่าสุด ไม่มีใช้เวลาที่เห็น · บรรทัดซ้ำรวมจำนวน', () => {
  const now = new Date('2026-11-26T08:00:00Z');
  const c = normalizeMvpOrder({ ...base, status: 5, list: 'cancelled' }, 'MVP', now).order;
  assert.equal(c.status, 'cancelled');
  assert.equal(c.cancelled_at, new Date(1795674300 * 1000).toISOString());
  const c2 = normalizeMvpOrder({ ...base, status: 5, list: 'cancelled', arrange_time: 0, logistics_mtime: 0 }, 'MVP', now).order;
  assert.equal(c2.cancelled_at, now.toISOString());
  assert.equal(c2.rts_at, null);
  const two = normalizeMvpOrder({ ...base, items: [base.items[0], base.items[0]] }, 'MVP', now);
  assert.equal(two.items.length, 1);
  assert.equal(two.items[0].qty, 2);
  assert.equal(two.order.item_count, 2);
});
