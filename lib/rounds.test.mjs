// รัน: node --test lib/rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiDay, dayRange, splitRounds, sumSkus, sizeKey, compareSizes, pivotSizes, stModel } from './rounds.js';

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

// ── ข้อมูลตัวอย่างจากของจริง (ST ของ Seniorsoft + ออเดอร์ TikTok/Shopee ในชีต) ──
const ST = new Map(Object.entries({
  b516bs: { name: 'กางเกงวอร์ม Fly Hawk b516 สีดำ B - S', cat: 'กางเกงวอร์ม' },
  b516bxxl: { name: 'กางเกงวอร์ม Fly Hawk b516 สีดำ B - XXL', cat: 'กางเกงวอร์ม' },
  b516b4l: { name: 'กางเกงวอร์ม Fly hawk b516 สีดำ B - 4L', cat: 'กางเกงวอร์ม' },
  bc516bjm: { name: 'กางเกงวอร์ม Fly Hawk bc516 สีดำ B - JM', cat: 'กางเกงวอร์ม' },
  '20724b6': { name: 'กางเกงวอร์ม FBT 20724 สีดำ - 6', cat: 'กางเกงวอร์ม' },
  '22724b2xl': { name: 'กางเกงวอร์ม FBT 22724 สีดำ - 2XL', cat: 'กางเกงวอร์ม' },
  '22724bm': { name: 'กางเกงวอร์ม FBT 22724 สีดำ - M', cat: 'กางเกงวอร์ม' },
  'f35543-7': { name: 'รองเท้าแตะ Adidas Adilette Aqua F35543 สีดำขาว - 7', cat: 'รองเท้าแตะ' },
  pf15ahwp41: { name: 'รองเท้าสตั๊ด Pan PF15AH Mach X ขาวชมพู WP - 41', cat: 'รองเท้าสตั๊ด' },
  hr5373: { name: 'กระเป๋าสะพายข้าง Adidas Essentials HR5373 สีกรม', cat: 'กระเป๋าสะพายข้าง' },
}));
const FLY = 'กางเกงวอร์ม Flyhawk ขาปล่อย ขาจั๊ม [b516 b517]';
const FBT = 'กางเกงวอร์ม FBT ขายาว';
const it = (sku, product_name, variant, qty = 1) => ({ os_order_items: [{ sku, product_name, variant, qty }] });

test('sizeKey ไม่รวมไซส์ต่างชื่อ (แต่ละยี่ห้อเทียบไม่เหมือนกัน — Flyhawk 3L = 2XL) แค่ไม่สนตัวพิมพ์/ช่องว่าง/จุด', () => {
  assert.deepEqual(['XXL', '2xl', '2L', '3L', 'xl', 'X L', 'XL.', 'JM'].map(sizeKey),
    ['XXL', '2XL', '2L', '3L', 'XL', 'XL', 'XL', 'JM']);
});

test('compareSizes: เลข → ไซส์เด็ก J → SS XS S M L XL XXL 2XL 3XL… → 2L 3L 4L… → อื่นๆ', () => {
  const z = ['2XL', 'OSFM', 'S', '10', 'JM', '4L', 'SS', '4', 'XL', 'JS', '2L', 'XXL', '4XL', 'M', '3XL'];
  assert.deepEqual(z.sort(compareSizes),
    ['4', '10', 'JS', 'JM', 'SS', 'S', 'M', 'XL', 'XXL', '2XL', '3XL', '4XL', '2L', '4L', 'OSFM']);
});

test('sumSkus: ไซส์มาจาก ST · สีมาจากตัวเลือกบนแพลตฟอร์ม (ตัดชั้นไซส์ออก)', () => {
  const rows = sumSkus([
    it('b516BS', FLY, 'S'),                          // TikTok ตัวเลือกชั้นเดียว = ไซส์ล้วน → ไม่มีสี
    it('bc516BJM', FLY, 'JMเด็ก'),                    // ไซส์บนแพลตฟอร์มมีคำต่อท้าย
    it('22724BM', FBT, 'สีดำ, M'),
    it('F35543-7', 'รองเท้าแตะ Adidas Adilette Aqua', 'F35543-ดำขาว,UK7/EU40.5/255'),
    it('pf15ahWP41', 'รองเท้าสตั๊ด PAN MACH X', 'WP-สีขาวชมพู,41'),
    it('HR5373', 'กระเป๋า Adidas', 'HR5373 สีกรม'),
    it('NOPE-XL', 'เสื้อไม่มีใน ST', 'แดง, XL [อก 44]', 2),
    it('b2b222XL', 'กางเกงฟุตบอล FBT รุ่น 009', 'ดำ, XL [เอว30-37, ยาว20]'),   // จุลภาคในวงเล็บไม่ใช่ตัวแบ่งชั้น
  ], ST);
  const pick = (sku) => { const r = rows.find((x) => x.sku === sku); return [r.color, r.size, r.kind, r.code, r.inSt]; };
  assert.deepEqual(pick('b516BS'), ['', 'S', 'cloth', 'b516B', true]);
  assert.deepEqual(pick('bc516BJM'), ['', 'JM', 'cloth', 'bc516B', true]);
  assert.deepEqual(pick('22724BM'), ['สีดำ', 'M', 'cloth', '22724B', true]);
  assert.deepEqual(pick('F35543-7'), ['F35543-ดำขาว', '7', 'shoe', 'F35543', true]);
  assert.deepEqual(pick('pf15ahWP41'), ['WP-สีขาวชมพู', '41', 'shoe', 'pf15ahWP', true]);
  assert.deepEqual(pick('HR5373'), ['HR5373 สีกรม', '', 'other', 'HR5373', true]);
  assert.deepEqual(pick('NOPE-XL'), ['แดง', 'XL', 'cloth', 'NOPE', false]);   // ไม่มีใน ST → เดาจากแพลตฟอร์ม
  assert.deepEqual(pick('b2b222XL'), ['ดำ', 'XL', 'cloth', 'b2b222', false]);
});

test('stModel ตัดไซส์และสีท้ายชื่อ ST ออก — ไม่มีคำว่า "สี" ก็คืนชื่อตัดไซส์', () => {
  assert.equal(stModel('กางเกงวอร์ม Fly Hawk b516 สีดำ B - S'), 'กางเกงวอร์ม Fly Hawk b516');
  assert.equal(stModel('รองเท้าสตั๊ด Pan PF15AH Mach X ขาวชมพู WP - 41'), 'รองเท้าสตั๊ด Pan PF15AH Mach X ขาวชมพู WP');
  assert.equal(stModel(''), '');
});

test('sumSkus รวมชิ้นตาม SKU (ไม่สนตัวพิมพ์) เรียงตาม SKU', () => {
  const rows = sumSkus([it('b516BS', FLY, 'S'), it('B516BS', FLY, 'S', 2), it('22724BM', FBT, 'สีดำ, M')], ST);
  assert.deepEqual(rows.map((r) => [r.sku, r.qty]), [['22724BM', 1], ['b516BS', 3]]);
});

test('pivotSizes: ตะกร้า+สี = แถวเดียว แม้ใน ST จะแยกหลายรหัส/สะกดต่างกัน', () => {
  const t = pivotSizes(sumSkus([
    it('b516BS', FLY, 'S'), it('b516BXXL', FLY, 'XXL', 2), it('b516B4L', FLY, '4L'), it('bc516BJM', FLY, 'JMเด็ก'),
    it('20724B6', FBT, 'สีดำ, 6'), it('22724BM', FBT, 'สีดำ, M'), it('22724B2XL', FBT, 'สีดำ, 2XL'),
  ], ST));
  // ไซส์เด็ก (J… / เลข) แยกไปตาราง "เสื้อผ้าเด็ก" — ตะกร้าเดียวกันจึงแตกเป็นแถวผู้ใหญ่ + แถวเด็ก
  assert.deepEqual(t.map((x) => [x.key, x.sizes.map((z) => z.key)]), [
    ['cloth', ['S', 'M', 'XXL', '2XL', '4L']],
    ['cloth-kid', ['6', 'JM']],
  ]);
  const [adult, kid] = t;
  // ชื่อที่โชว์ = ชื่อรุ่นใน ST ที่เจอบ่อยสุดในแถว (ตัดไซส์และสีออก) สั้นกว่าชื่อตะกร้า · ชื่อตะกร้าเก็บไว้ใน basket
  assert.deepEqual(adult.rows.map((r) => [r.name, r.basket, r.color, r.codes, r.cells, r.total]), [
    ['กางเกงวอร์ม FBT 22724', FBT, 'สีดำ', ['22724B'], { M: 1, '2XL': 1 }, 2],
    ['กางเกงวอร์ม Fly Hawk b516', FLY, '', ['b516B'], { S: 1, XXL: 2, '4L': 1 }, 4],
  ]);
  assert.deepEqual(kid.rows.map((r) => [r.name, r.codes, r.cells, r.total]), [
    ['กางเกงวอร์ม FBT 20724', ['20724B'], { 6: 1 }, 1],
    ['กางเกงวอร์ม Fly Hawk bc516', ['bc516B'], { JM: 1 }, 1],
  ]);
});

test('pivotSizes: รองเท้าแยกตามหน่วยไซส์ UK / EU / ซม. · ของไม่มีไซส์อยู่ตาราง อื่นๆ', () => {
  const t = pivotSizes(sumSkus([
    it('F35543-7', 'แตะ Adidas', 'F35543-ดำขาว,UK7/EU40.5/255'),
    it('pf15ahWP41', 'สตั๊ด PAN', 'WP-สีขาวชมพู,41'),
    it('HR5373', 'กระเป๋า Adidas', ''),
  ], ST));
  assert.deepEqual(t.map((x) => [x.key, x.sizes.map((z) => z.key)]), [['shoe-uk', ['7']], ['shoe-eu', ['41']], ['other', []]]);
});
