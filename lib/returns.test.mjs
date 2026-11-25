// รัน: node --test lib/returns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normCode, tiktokReturnState, tiktokRecordsState, shopeeReturnState, tiktokTrackingState,
  shopeeTrackingState, shopeeReverseState, lazadaOrderState, laterState, toCsv, csvRows,
} from './returns.js';

test('normCode ตัดช่องว่าง/ขึ้นบรรทัด และทำเป็นตัวใหญ่', () => {
  assert.equal(normCode(' jtth209880627935\n'), 'JTTH209880627935');
});

test('normCode แปลงโค้ดที่ยิงตอนแป้นไทยกลับเป็นอังกฤษ', () => {
  assert.equal(normCode('๋ธธ็/จต'), 'JTTH209');   // ตัวใหญ่ = ปืนกด Shift
  assert.equal(normCode('่ะะ้'), 'JTTH');         // ตัวเล็ก
  assert.equal(normCode('TH265840979173Q'), 'TH265840979173Q');   // ไม่มีตัวไทย ไม่แตะ
});

test('tiktokReturnState', () => {
  const r = (return_status, extra = {}) => ({ return_type: 'RETURN_AND_REFUND', return_status, return_tracking_number: 'JT1', ...extra });
  assert.equal(tiktokReturnState(r('AWAITING_BUYER_SHIP', { return_tracking_number: '' })), 'waiting');
  assert.equal(tiktokReturnState(r('BUYER_SHIPPED_ITEM')), 'transit');
  assert.equal(tiktokReturnState(r('RETURN_OR_REFUND_REQUEST_COMPLETE')), 'transit');
  assert.equal(tiktokReturnState(r('RETURN_OR_REFUND_REQUEST_CANCEL')), 'not_needed');
  assert.equal(tiktokReturnState(r('RETURN_OR_REFUND_REQUEST_PENDING')), null);
  assert.equal(tiktokReturnState({ return_type: 'REFUND', return_status: 'RETURN_OR_REFUND_REQUEST_COMPLETE' }), null);
  assert.equal(tiktokReturnState({ ...r('BUYER_SHIPPED_ITEM'), return_type: 'EXCHANGE' }), 'transit');
});

test('tiktokRecordsState เจอร้านกดยืนยันรับ = ถึงแล้ว', () => {
  assert.deepEqual(
    tiktokRecordsState([{ event: 'BUYER_SHIPPED', create_time: 1 }, { event: 'SELLER_CONFIRM_RECEIVE', create_time: 1787829644 }]),
    { state: 'arrived', at: '2026-08-27T11:20:44.000Z' },
  );
  assert.equal(tiktokRecordsState([{ event: 'REFUND_SUCCESS', create_time: 1 }]), null);
});

test('shopeeReturnState', () => {
  assert.equal(shopeeReturnState({ status: 'ACCEPTED', needs_logistics: true, tracking_number: 'TH1' }), 'transit');
  assert.equal(shopeeReturnState({ status: 'ACCEPTED', needs_logistics: true, tracking_number: '' }), 'waiting');
  assert.equal(shopeeReturnState({ status: 'ACCEPTED', needs_logistics: false }), null);
  assert.equal(shopeeReturnState({ status: 'CANCELLED', needs_logistics: true, tracking_number: 'TH1' }), 'not_needed');
});

test('tiktokTrackingState 80101 = คืนถึงผู้ขาย', () => {
  assert.deepEqual(
    tiktokTrackingState([{ action_code: 80101, update_time_millis: 1795591591000 }, { action_code: 70207, update_time_millis: 1795583298000 }]),
    { state: 'arrived', at: '2026-11-25T07:26:31.000Z' },
  );
  assert.equal(tiktokTrackingState([{ action_code: 70207, update_time_millis: 1 }]), null);
});

test('shopeeTrackingState RETURNED = ถึงแล้ว', () => {
  assert.deepEqual(
    shopeeTrackingState([{ logistics_status: 'RETURNED', update_time: 1795492607 }, { logistics_status: 'RETURN_STARTED', update_time: 1 }]),
    { state: 'arrived', at: '2026-11-24T03:56:47.000Z' },
  );
  assert.deepEqual(shopeeTrackingState([{ logistics_status: 'RETURN_INITIATED', update_time: 1 }]), { state: 'transit', at: null });
});

test('shopeeReverseState', () => {
  assert.deepEqual(
    shopeeReverseState({ reverse_logistics_status: 'LOGISTICS_DELIVERY_DONE', reverse_logistics_update_time: 1794117211 }),
    { state: 'arrived', at: '2026-11-08T05:53:31.000Z' },
  );
  assert.equal(shopeeReverseState({ reverse_logistics_status: 'LOGISTICS_PICKUP_DONE' }), null);
});

test('lazadaOrderState', () => {
  assert.equal(lazadaOrderState('shipped_back_success'), 'arrived');
  assert.equal(lazadaOrderState('canceled'), null);
});

test('laterState ไม่ถอยหลัง', () => {
  assert.equal(laterState('arrived', 'transit'), 'arrived');
  assert.equal(laterState('transit', 'arrived'), 'arrived');
  assert.equal(laterState('transit', 'not_needed'), 'not_needed');
  assert.equal(laterState('arrived', 'not_needed'), 'arrived');
  assert.equal(laterState(null, 'waiting'), 'waiting');
});

test('toCsv ใส่ BOM และเครื่องหมายคำพูด', () => {
  assert.equal(toCsv([{ a: 'x,"y"' }], [{ key: 'a', label: 'ก' }]), '﻿ก\r\n"x,""y"""');
});

test('csvRows แตกกล่องเป็นแถวละ SKU', () => {
  const rows = csvRows([{ platform: 'tiktok', shop: 'SOLID', kind: 'buyer', order_id: '1', items: [{ sku: 'a', qty: 1 }, { sku: 'b', qty: 2 }], state: 'transit', recv: null }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].sku, 'b');
  assert.equal(rows[0].recv, 'ยังไม่รับ');
});
