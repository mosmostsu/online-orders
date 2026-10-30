// รัน: node --test lib/rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiDay, dayRange, splitRounds, roundNo, shipAt, sumSkus, sizeKey, compareSizes, pivotSizes, stModel, normSku } from './rounds.js';

// key ของ ST ผ่าน normSku แบบเดียวกับหน้าเว็บ (app/round/page.js loadSt)
const stMap = (entries) => new Map(entries.map(([k, v]) => [normSku(k), v]));

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

test('รอบตามเวลาตัดของร้าน: ก่อน 12:00 = รอบ 1 · 12:00-13:59 = รอบ 2 · 14:00 ขึ้นไป = รอบ 3', () => {
  assert.deepEqual(['06:00', '11:59', '12:00', '13:59', '14:00', '18:30'].map((t) => roundNo(`2026-10-26T${t}:00+07:00`)),
    [1, 1, 2, 2, 3, 3]);
  assert.equal(roundNo('2026-10-26T05:30:00Z'), 2);   // 12:30 เวลาไทย — ตัดตามเวลาไทย ไม่ใช่ UTC
});

test('splitRounds: แถวบน = รอบของทั้งร้าน · ในรอบ = ร้าน เรียงตามเวลาเริ่มกดส่ง', () => {
  const rounds = splitRounds([
    o('SOLID', '08:40'), o('SOLID', '08:10'), o('REAL', '09:05', { platform: 'shopee' }),
    o('SOLID', '07:55', { platform: 'shopee' }), o('SOLID', '13:40'), o('SOLID', '14:05'),
  ]);
  assert.deepEqual(rounds.map((r) => [r.n, r.from, r.to, r.shops.map((s) => [s.key, s.orders.length])]), [
    [1, '2026-10-26T07:55:00+07:00', '2026-10-26T09:05:00+07:00',
      [['shopee:SOLID', 1], ['tiktok:SOLID', 2], ['shopee:REAL', 1]]],
    [2, '2026-10-26T13:40:00+07:00', '2026-10-26T13:40:00+07:00', [['tiktok:SOLID', 1]]],
    [3, '2026-10-26T14:05:00+07:00', '2026-10-26T14:05:00+07:00', [['tiktok:SOLID', 1]]],
  ]);
  assert.deepEqual(rounds[0].shops[1].from, '2026-10-26T08:10:00+07:00');
});

test('shipAt: TikTok ใช้เวลากดส่งจาก API · Shopee/Lazada ใช้เวลาที่กลายเป็น "แพ็คแล้ว" ครั้งแรก (= ปริ้นใบปะหน้า)', () => {
  const rts = '2026-10-30T07:00:00Z';     // Shopee เขียนทับเป็นเวลาขนส่งรับ
  const packed = '2026-10-29T23:40:00Z';  // 06:40 ไทย — ตอนปริ้นใบปะหน้า
  assert.equal(shipAt({ platform: 'tiktok', rts_at: rts }, packed), rts);
  assert.equal(shipAt({ platform: 'shopee', rts_at: rts }, packed), packed);
  assert.equal(shipAt({ platform: 'lazada', rts_at: rts }, null), rts);    // ไม่เคยเห็นตอนแพ็ค → ใช้เวลาเดิม
  assert.equal(shipAt({ platform: 'shopee', rts_at: null }, null), null);
});

test('splitRounds ใช้ ship_at ก่อน rts_at', () => {
  const rounds = splitRounds([o('REAL', '13:10', { platform: 'shopee', ship_at: '2026-10-26T06:40:00+07:00' })]);
  assert.deepEqual(rounds.map((r) => [r.n, r.from]), [[1, '2026-10-26T06:40:00+07:00']]);
});

test('นับใบที่ลูกค้ายกเลิกหลังกดส่งด้วย (ยอดรอบไม่เปลี่ยนตามการยกเลิก)', () => {
  const [r] = splitRounds([o('SOLID', '08:00'), o('SOLID', '08:30', { status: 'cancelled' })]);
  assert.equal(r.shops[0].orders.length, 2);
});

// ── ข้อมูลตัวอย่างจากของจริง (ST ของ Seniorsoft + ออเดอร์ TikTok/Shopee ในชีต) ──
const ST = stMap(Object.entries({
  b516bs: { name: 'กางเกงวอร์ม Fly Hawk b516 สีดำ B - S', cat: 'กางเกงวอร์ม' },
  b516bxxl: { name: 'กางเกงวอร์ม Fly Hawk b516 สีดำ B - XXL', cat: 'กางเกงวอร์ม' },
  b516b4l: { name: 'กางเกงวอร์ม Fly hawk b516 สีดำ B - 4L', cat: 'กางเกงวอร์ม' },
  bc516bjm: { name: 'กางเกงวอร์ม Fly Hawk bc516 สีดำ B - JM', cat: 'กางเกงวอร์ม' },
  '20724b6': { name: 'กางเกงวอร์ม FBT 20724 สีดำ - 6', cat: 'กางเกงวอร์ม' },
  '22724b2xl': { name: 'กางเกงวอร์ม FBT 22724 สีดำ - 2XL', cat: 'กางเกงวอร์ม' },
  '22724bm': { name: 'กางเกงวอร์ม FBT 22724 สีดำ - M', cat: 'กางเกงวอร์ม' },
  'f35543-7': { name: 'รองเท้าแตะ Adidas Adilette Aqua F35543 สีดำขาว - 7', cat: 'รองเท้าแตะ' },
  'p1ga242501-260': { name: 'รองเท้าสตั๊ด Mizuno Monarcida Neo III Select P1GA242501 สีดำเทา - 260', cat: 'รองเท้าสตั๊ด' },
  pf15ahwp41: { name: 'รองเท้าสตั๊ด Pan PF15AH Mach X ขาวชมพู WP - 41', cat: 'รองเท้าสตั๊ด' },
  hr5373: { name: 'กระเป๋าสะพายข้าง Adidas Essentials HR5373 สีกรม', cat: 'กระเป๋าสะพายข้าง' },
}));
const FLY = 'กางเกงวอร์ม Flyhawk ขาปล่อย ขาจั๊ม [b516 b517]';
const FBT = 'กางเกงวอร์ม FBT ขายาว';
const it = (sku, product_name, variant, qty = 1) => ({ os_order_items: [{ sku, product_name, variant, qty }] });

test('sizeKey รวมแค่ XXL = 2XL (ชื่อเดียวกันคนละแบบ) · 2L 3L XXXL ไม่รวม (แต่ละยี่ห้อเทียบไม่เหมือนกัน)', () => {
  assert.deepEqual(['XXL', '2xl', '2L', '3L', 'XXXL', 'xl', 'X L', 'XL.', 'JM'].map(sizeKey),
    ['2XL', '2XL', '2L', '3L', 'XXXL', 'XL', 'XL', 'XL', 'JM']);
});

test('compareSizes: เลข → ไซส์เด็ก J → SS XS S M L XL XXL 2XL 3XL… → 2L 3L 4L… → อื่นๆ', () => {
  const z = ['2XL', 'OSFM', 'S', '10', 'JM', '4L', 'SS', '4', 'XL', 'JS', '2L', 'XXL', '4XL', 'M', '3XL'];
  assert.deepEqual(z.sort(compareSizes),
    ['4', '10', 'JS', 'JM', 'SS', 'S', 'M', 'XL', '2XL', 'XXL', '3XL', '4XL', '2L', '4L', 'OSFM']);
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
    it('P1GA242501-260', 'รองเท้าสตั๊ด MIZUNO', 'US8/EUR40.5/260'),              // ชั้นเดียวที่ไซส์อยู่ท้ายข้อความ
  ], ST);
  const pick = (sku) => { const r = rows.find((x) => x.sku === sku); return [r.color, r.size, r.kind, r.code, r.inSt]; };
  assert.deepEqual(pick('b516BS'), ['สีดำ B', 'S', 'cloth', 'b516B', true]);   // ตัวเลือกมีแต่ไซส์ → เอาสีจากชื่อใน ST
  assert.deepEqual(pick('bc516BJM'), ['สีดำ B', 'JM', 'cloth', 'bc516B', true]);
  assert.deepEqual(pick('22724BM'), ['สีดำ', 'M', 'cloth', '22724B', true]);
  assert.deepEqual(pick('F35543-7'), ['F35543-ดำขาว', '7', 'shoe', 'F35543', true]);
  assert.deepEqual(pick('pf15ahWP41'), ['WP-สีขาวชมพู', '41', 'shoe', 'pf15ahWP', true]);
  assert.deepEqual(pick('HR5373'), ['HR5373 สีกรม', '', 'other', 'HR5373', true]);
  assert.deepEqual(pick('NOPE-XL'), ['แดง', 'XL', 'cloth', 'NOPE', false]);   // ไม่มีใน ST → เดาจากแพลตฟอร์ม
  assert.deepEqual(pick('b2b222XL'), ['ดำ', 'XL', 'cloth', 'b2b222', false]);
  assert.deepEqual(pick('P1GA242501-260'), ['สีดำเทา', '260', 'shoe', 'P1GA242501', true]);
});

test('stModel ตัดไซส์และสีท้ายชื่อ ST ออก — ไม่มีคำว่า "สี" ก็คืนชื่อตัดไซส์', () => {
  assert.equal(stModel('กางเกงวอร์ม Fly Hawk b516 สีดำ B - S'), 'กางเกงวอร์ม Fly Hawk b516');
  assert.equal(stModel('รองเท้าสตั๊ด Pan PF15AH Mach X ขาวชมพู WP - 41'), 'รองเท้าสตั๊ด Pan PF15AH Mach X ขาวชมพู WP');
  assert.equal(stModel(''), '');
});

test('sumSkus: SKU บนแพลตฟอร์มที่ 0 นำหน้าหาย ยังเจอใน ST', () => {
  const st = new Map([[normSku('0625410008'), { name: 'กางเกงวอร์ม Grand Sport 06254 สีดำ - 8', cat: 'กางเกงวอร์ม' }]]);
  const [r] = sumSkus([it('625410008', 'วอร์ม GS', 'สีดำ-ขาจั๊ม, 8')], st);
  assert.deepEqual([r.sku, r.inSt, r.size], ['625410008', true, '8']);
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
  // ไซส์เด็กอยู่ตารางเดียวกับผู้ใหญ่ — คอลัมน์เรียง เลข → J… → SS S M… · Flyhawk / FBT มีตารางของตัวเอง
  assert.deepEqual(t.map((x) => [x.key, x.sizes.map((z) => z.label)]), [
    ['warm-main', ['6', 'JM', 'S', 'M', 'XXL/2XL', '4L']],
  ]);
  // ชื่อที่โชว์ = ชื่อรุ่นใน ST ที่เจอบ่อยสุดในแถว (ตัดไซส์และสีออก) สั้นกว่าชื่อตะกร้า · ชื่อตะกร้าเก็บไว้ใน basket
  assert.deepEqual(t.flatMap((x) => x.rows).map((r) => [r.name, r.basket, r.color, r.codes, r.cells, r.total]), [
    ['กางเกงวอร์ม Fly Hawk b516', FLY, 'สีดำ B', ['b516B', 'bc516B'], { S: 1, '2XL': 2, '4L': 1, JM: 1 }, 5],
    ['กางเกงวอร์ม FBT 22724', FBT, 'สีดำ', ['20724B', '22724B'], { 6: 1, M: 1, '2XL': 1 }, 3],
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

test('pivotSizes: ตะกร้าเดียวกันอยู่ติดกัน เรียงสี ดำ กรม เทา ขาว น้ำเงิน แล้วสีอื่น · บอกแถวแรก/แถวสุดท้ายของตะกร้า', () => {
  const B1 = 'กางเกงกีฬา FBT รุ่น 009', B2 = 'กางเกงกีฬา Grand Sport 01595';
  const [t] = pivotSizes(sumSkus([
    it('c2b009WHM', B1, 'ขาว, M'), it('c2b009BBM', B1, 'น้ำเงิน, M'), it('c2b009RDM', B1, 'แดง, M'),
    it('c2b009GRM', B1, 'เทาเข้ม, M'), it('b2b222M', B1, 'ดำ, M'), it('c2b009NBM', B1, 'กรม, M'),
    it('015950100M', B2, 'กรม, M'), it('015951000M', B2, 'ดำ, M'),
  ]));
  assert.deepEqual(t.rows.map((r) => [r.basket === B1 ? 1 : 2, r.color, r.first, r.last]), [
    [1, 'ดำ', true, false], [1, 'กรม', false, false], [1, 'เทาเข้ม', false, false],
    [1, 'ขาว', false, false], [1, 'น้ำเงิน', false, false], [1, 'แดง', false, true],
    [2, 'ดำ', true, false], [2, 'กรม', false, true],
  ]);
});

test('pivotSizes: หัวคอลัมน์รองเท้า ซม. บอก EU กำกับ (Mizuno 260 = EU40.5)', () => {
  const [t] = pivotSizes(sumSkus([it('P1GA242501-260', 'รองเท้าสตั๊ด MIZUNO', 'P1GA242501-สีดำเทา, US8/EUR40.5/260')], ST));
  assert.equal(t.key, 'shoe-cm');
  assert.deepEqual(t.sizes, [{ key: '260', label: '260', note: 'EU40.5' }]);
});

test('pivotSizes: เสื้อผ้าแยกตาราง วอร์ม / แทรคสูท (+ผ้าร่มขายาว) / ขาสั้น / เสื้อ ตามหมวดใน ST', () => {
  const st = stMap(Object.entries({
    '22724bm': { name: 'กางเกงวอร์ม FBT 22724 สีดำ - M', cat: 'กางเกงวอร์ม' },
    '102231000m': { name: 'กางเกงแทรคสูท Grand Sport 10223 สีดำ - M', cat: 'กางเกงแทรคสูท' },
    '015951000m': { name: 'กางเกงกีฬา Grand Sport 01595 สีดำ - M', cat: 'กางเกงกีฬา' },
    '022401000m': { name: 'กางเกงลำลองขาสั้น Grand Sport 02240 สีดำ - M', cat: 'กางเกงลำลองขาสั้น' },
    '163932000l': { name: 'เสื้อวอร์ม Grand Sport 16393 สีขาว - L', cat: 'เสื้อวอร์ม' },
    'x-rain-l': { name: 'กางเกงผ้าร่ม Grand Sport 10241 สีดำ - L', cat: 'กางเกงผ้าร่มขายาว' },
    'x-rains-l': { name: 'กางเกงผ้าร่ม Grand Sport 02003 สีดำ - L', cat: 'กางเกงผ้าร่มขาสั้น' },
  }));
  const t = pivotSizes(sumSkus([
    it('163932000L', 'เสื้อวอร์ม', 'ขาว, L'), it('022401000M', 'ขาสั้นลำลอง', 'ดำ, M'), it('015951000M', 'ฟุตบอล', 'ดำ, M'),
    it('102231000M', 'แทรคสูท', 'ดำ, M'), it('22724BM', 'วอร์ม', 'ดำ, M'),
    it('X-RAIN-L', 'ผ้าร่มขายาว', 'ดำ, L'), it('X-RAINS-L', 'ผ้าร่มขาสั้น', 'ดำ, L'),
  ], st));
  // ผ้าร่มขายาว อยู่กับแทรคสูท · ผ้าร่มขาสั้น อยู่กับขาสั้น
  assert.deepEqual(t.map((x) => [x.key, x.rows.length]), [['warm-main', 1], ['track', 2], ['shorts', 3], ['top', 1]]);
});

test('pivotSizes: กางเกงวอร์มตะกร้าหลัก (มีไซส์เด็ก) รวมตารางเดียว เรียง b516/b517 → 06253/54 → 06251/52 → FBT → ขาวล้วน', () => {
  const st = stMap(Object.entries({
    b517bs: { name: 'กางเกงวอร์ม Fly Hawk b517 สีดำ B - S', cat: 'กางเกงวอร์ม' },
    bc516bjm: { name: 'กางเกงวอร์ม Fly Hawk bc516 สีดำ B - JM', cat: 'กางเกงวอร์ม' },
    '062541000m': { name: 'กางเกงวอร์ม Grand Sport 06254 สีดำ - M', cat: 'กางเกงวอร์ม' },
    '062511000m': { name: 'กางเกงวอร์ม Grand Sport 06251 สีดำ - M', cat: 'กางเกงวอร์ม' },
    c2f724bm: { name: 'กางเกงวอร์ม FBT c2f724 สีดำ - M', cat: 'กางเกงวอร์ม' },
    c2f724wm: { name: 'กางเกงวอร์ม FBT c2f724 สีขาว - M', cat: 'กางเกงวอร์ม' },
    '061842000m': { name: 'กางเกงวอร์ม Grand Sport 06184 สีขาว - M', cat: 'กางเกงวอร์ม' },
    '063931000m': { name: 'กางเกงวอร์ม Grand Sport 06393 สีกรมขาว - M', cat: 'กางเกงวอร์ม' },
    '062191000m': { name: 'กางเกงวอร์ม Grand Sport 06219 สีดำ - M', cat: 'กางเกงวอร์ม' },
  }));
  const W = 'กางเกงวอร์มขาว รวมรุ่น';
  const t = pivotSizes(sumSkus([
    it('062191000M', 'วอร์ม GS 06219', 'ดำ, M'), it('063931000M', 'วอร์ม GS 06393', 'กรมขาว, M'),
    it('C2F724WM', W, 'FBT, M'), it('061842000M', W, 'Grand Sport, M'),       // ขาวล้วน (FBT + Grand Sport) มาก่อนกฎ FBT
    it('c2f724BM', 'วอร์ม FBT', 'ดำ, M'), it('062511000M', 'วอร์ม GS 06251', 'ดำ, M'),
    it('062541000M', 'วอร์ม GS 06253', 'ดำ, M'), it('bc516BJM', 'วอร์ม Flyhawk', 'ดำ, JM'), it('b517BS', 'วอร์ม Flyhawk', 'ดำ, S'),
  ], st));
  assert.deepEqual(t.map((x) => x.key), ['warm-main', 'warm']);
  assert.deepEqual(t[0].rows.map((r) => [r.basket, r.first]), [
    ['วอร์ม Flyhawk', true], ['วอร์ม GS 06253', true], ['วอร์ม GS 06251', true], ['วอร์ม FBT', true],
    [W, true], [W, false],
  ]);
  // กรมขาว ไม่ใช่ขาวล้วน → อยู่ตารางอื่นๆ
  assert.deepEqual(t[1].rows.map((r) => r.basket), ['วอร์ม GS 06219', 'วอร์ม GS 06393']);
});

test('remarksOf: ข้อความลูกค้า + โน้ตร้าน + โน้ตในเว็บ ทุกแพลตฟอร์ม ไม่ซ้ำ', async () => {
  const { remarksOf } = await import('./rounds.js');
  assert.deepEqual(remarksOf({ rm_buyer_message: 'กล่องแข็ง', rm_seller_note: ' แถมถุงเท้า ', note: 'โทรแล้ว' }),
    [{ label: 'ลูกค้า', text: 'กล่องแข็ง' }, { label: 'โน้ตร้าน', text: 'แถมถุงเท้า' }, { label: 'โน้ตในเว็บ', text: 'โทรแล้ว' }]);
  assert.deepEqual(remarksOf({ rm_message_to_seller: 'ด่วน', rm_note: 'ด่วน' }), [{ label: 'ลูกค้า', text: 'ด่วน' }]);
  assert.deepEqual(remarksOf({ rm_remarks: '' }), []);
});
