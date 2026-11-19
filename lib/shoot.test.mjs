// รัน: node --test lib/shoot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK, safeName, extOf, shotFileName, chunkRanges, nextOffset, afterShot, shotsLeft } from './shoot.js';

test('safeName ตัดอักขระต้องห้ามและเว้นวรรคซ้ำ', () => {
  assert.equal(safeName('Flyhawk B516/B517 - ช็อต: "คนใส่"'), 'Flyhawk B516 B517 - ช็อต คนใส่');
  assert.equal(safeName('  a\n\tb  '), 'a b');
  assert.equal(safeName('x'.repeat(100), 10).length, 10);
  assert.equal(safeName(null), '');
});
test('extOf ใช้นามสกุลไฟล์ก่อน แล้วค่อยดู mime', () => {
  assert.equal(extOf('IMG_0012.MOV', 'video/quicktime'), 'mov');
  assert.equal(extOf('video', 'video/quicktime'), 'mov');
  assert.equal(extOf('', 'video/webm'), 'webm');
  assert.equal(extOf('', ''), 'mp4');
});
test('shotFileName', () => {
  assert.equal(
    shotFileName({ date: '2026-11-21', product: 'Pegan กางเกงผ้าร่มขายาว', index: 0, shot: 'ใกล้: เอว ยางยืด + เชือกผูก', ext: 'mov', stamp: '181500' }),
    '2026-11-21_Pegan กางเกงผ้าร่มขายาว_ช็อต01_ใกล้ เอว ยางยืด + เชือกผูก_181500.mov');
  assert.equal(shotFileName({ date: '2026-11-21', product: 'A/B', index: 9, shot: '' }), '2026-11-21_A B_ช็อต10.mp4');
  assert.ok(!/[\\/:*?"<>|]/.test(shotFileName({ date: '2026-11-21', product: 'a:b*c?', index: 1, shot: '<x>|y' })));
});
test('chunkRanges ครอบทั้งไฟล์ ไม่ซ้อน ทุกชิ้นยกเว้นชิ้นท้ายเป็นจำนวนเท่าของ 256KiB', () => {
  assert.deepEqual(chunkRanges(0), []);
  assert.deepEqual(chunkRanges(10, 4), [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 9 }]);
  assert.deepEqual(chunkRanges(8, 4), [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  assert.equal(CHUNK % (256 * 1024), 0);
  const size = CHUNK * 2 + 5; const r = chunkRanges(size);
  assert.equal(r.length, 3); assert.equal(r[2].end, size - 1);
  assert.equal(r.reduce((s, x) => s + x.end - x.start + 1, 0), size);
});
test('nextOffset', () => {
  assert.equal(nextOffset('bytes=0-8388607'), 8388608);
  assert.equal(nextOffset(null), null); assert.equal(nextOffset('x'), null);
});
test('afterShot ติ๊กเฉพาะช็อตนั้น และ done เมื่อครบ', () => {
  const s = { shots: ['a', 'b', 'c'], got: [true, false] };
  assert.deepEqual(afterShot(s, 2), { got: [true, false, true], done: false });
  assert.deepEqual(afterShot(s, 1), { got: [true, true, false], done: false });
  assert.deepEqual(afterShot({ shots: ['a', 'b'], got: [true, false] }, 1), { got: [true, true], done: true });
  assert.deepEqual(afterShot({ shots: [], got: [] }, 0), { got: [], done: false });
  assert.equal(shotsLeft(s), 2);
});
