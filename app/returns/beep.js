// เสียงตอนยิงบาร์โค้ด — สร้างเสียงเองด้วย Web Audio ไม่ต้องมีไฟล์เสียง
//   ok   = ปี๊บ เสียงสูง (เจอกล่อง)
//   save = ปี๊บ-ปี๊บ ขึ้นเสียง (บันทึกแล้ว)
//   err  = ตื๊ด ตื๊ด เสียงต่ำยาว (ไม่เจอ / ผิดพลาด)
// ตั้งดังเต็มที่ (ร้านเสียงดัง ผู้ใช้ขอ 26 พ.ย.) — เสียงคลื่นเหลี่ยม ดังเต็มตลอดแล้วตัดจบ ไม่ค่อย ๆ เบา
// เบราว์เซอร์ยอมให้มีเสียงหลังผู้ใช้กด/พิมพ์อะไรสักอย่างแล้ว — ปืนยิงพิมพ์+Enter ให้ ถือว่ากดแล้ว
let ctx = null;
let out = null;

function audio() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    // บีบให้ดังสุดโดยไม่แตก
    out = ctx.createDynamicsCompressor();
    out.threshold.value = -10;
    out.ratio.value = 4;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(a, freq, start, dur, type = 'square', vol = 1) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = a.currentTime + 0.01 + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.setValueAtTime(vol, t0 + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(g).connect(out || a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  ok: [[2700, 0, 0.2]],
  save: [[2000, 0, 0.16], [3000, 0.2, 0.28]],
  err: [[170, 0, 0.35, 'sawtooth'], [170, 0.45, 0.35, 'sawtooth']],
};

// เรียกตอนผู้ใช้กดปุ่ม/พิมพ์ ให้เบราว์เซอร์ปลดล็อกเสียงไว้ก่อน
export function unlockSound() {
  audio();
}

// ปลดล็อกจากการกด/พิมพ์ครั้งแรกที่ไหนก็ได้ในหน้า
export function listenUnlock() {
  if (typeof window === 'undefined') return () => {};
  const on = () => unlockSound();
  window.addEventListener('pointerdown', on, true);
  window.addEventListener('keydown', on, true);
  return () => {
    window.removeEventListener('pointerdown', on, true);
    window.removeEventListener('keydown', on, true);
  };
}

export function beep(kind = 'ok') {
  try {
    const a = audio();
    if (!a) return;
    for (const [f, s, d, type] of SOUNDS[kind] || SOUNDS.ok) tone(a, f, s, d, type);
  } catch { /* ไม่มีเสียงก็ใช้งานต่อได้ */ }
}
