// รัน: node --test lib/r02.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { r02Platform, serialToIso, parseR02, assignSns, compareSns } from './r02.js';

test('r02Platform: ช่องทางออนไลน์เท่านั้น เงินสด/ไทยฟินเทคไม่นับ', () => {
  assert.deepEqual(['Tiktok shop', 'Shopee', 'Lazada', 'เงินสด', 'ไทย ฟินเทค จำกัด (สำนักงานใหญ่)'].map(r02Platform),
    ['tiktok', 'shopee', 'lazada', null, null]);
});

test('serialToIso: TRANDATE เป็นเวลาไทย', () => {
  assert.equal(serialToIso(46325.42726851852), '2026-10-30T03:15:16.000Z');   // 10:15:16 ไทย
});

test('parseR02: เฉพาะใบขาย OSVS ที่ตัดสต็อก ของช่องทางออนไลน์', () => {
  const lines = parseR02([
    { CF_TRANNO: 'OSVS1', CF_FSTOCKMAIN: -1, CF_PERSON_FNAME: 'Tiktok shop', CF_TDBASEQUANTITY: -2, TRANDATE: 46325.5, CF_ITEMID: 'b516BS', CF_ITEMNAME: 'x' },
    { CF_TRANNO: 'OSVS2', CF_FSTOCKMAIN: -1, CF_PERSON_FNAME: 'เงินสด', CF_TDBASEQUANTITY: 1, TRANDATE: 46325.5, CF_ITEMID: 'a' },
    { CF_TRANNO: 'IRPS1', CF_FSTOCKMAIN: 1, CF_PERSON_FNAME: 'Shopee', CF_TDBASEQUANTITY: 1, TRANDATE: 46325.5, CF_ITEMID: 'a' },
  ]);
  assert.deepEqual(lines.map((l) => [l.doc, l.platform, l.sku, l.qty]), [['OSVS1', 'tiktok', 'b516BS', 2]]);
});

const R = (n, shops) => ({ n, shops: shops.map(([platform, shop, from]) => ({ key: `${platform}:${shop}`, platform, shop, from })) });
const L = (platform, hhmm, sku, qty = 1) => ({ platform, at: `2026-10-30T${hhmm}:00+07:00`, sku, name: sku, qty });

test('assignSns: ใบยิงลงรอบล่าสุดของแพลตฟอร์มที่เริ่มกดส่งก่อนเวลายิง', () => {
  const rounds = [
    R(1, [['tiktok', 'SOLID', '2026-10-30T08:09:00+07:00'], ['shopee', 'REAL', '2026-10-30T08:14:00+07:00']]),
    R(2, [['tiktok', 'SOLID', '2026-10-30T12:03:00+07:00']]),
    R(3, [['tiktok', 'SOLID', '2026-10-30T14:01:00+07:00']]),
  ];
  const m = assignSns(rounds, [
    L('tiktok', '10:15', 'a'), L('tiktok', '13:11', 'b'), L('tiktok', '14:55', 'c'),
    L('shopee', '12:49', 'd'),   // Shopee ไม่มีรอบ 2 → ยังเป็นของรอบ 1
    L('tiktok', '07:50', 'e'),   // ยิงก่อนรอบแรก → รอบแรก
    L('lazada', '09:00', 'f'),   // ไม่มีออเดอร์ Lazada เลย → ทิ้ง
  ]);
  assert.deepEqual([...m].map(([k, v]) => [k, v.map((l) => l.sku)]),
    [['1|tiktok', ['a', 'e']], ['2|tiktok', ['b']], ['3|tiktok', ['c']], ['1|shopee', ['d']]]);
});

test('compareSns: ขาด/เกิน/ยิงนอกรายการ · Shopee หลายร้านหักส่วนของร้านอื่นก่อน', () => {
  const c = compareSns(
    [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }, { sku: 'C', qty: 3 }],
    [{ sku: 'C', qty: 1 }, { sku: 'D', qty: 1 }],       // ร้านอื่นของ Shopee ในรอบเดียวกัน
    [L('shopee', '10:00', 'a', 2), L('shopee', '10:00', 'C', 4), L('shopee', '10:00', 'D'), L('shopee', '10:00', 'X', 2)],
  );
  assert.deepEqual(c.rows.map((r) => [r.sku, r.qty, r.sns]), [['A', 2, 2], ['B', 1, 0], ['C', 3, 3]]);
  assert.deepEqual(c.extra.map((e) => [e.sku, e.qty]), [['X', 2]]);
  assert.equal(c.bad, 2);   // B ขาด + X นอกรายการ
});

test('compareSns: SKU ที่ 0 นำหน้าหายบนแพลตฟอร์ม จับคู่กับที่ยิงใน Seniorsoft ได้', () => {
  const c = compareSns([{ sku: '625410008', qty: 2 }], [], [L('tiktok', '10:15', '0625410008', 2)]);
  assert.deepEqual([c.rows[0].sns, c.extra.length, c.bad], [2, 0, 0]);
});
