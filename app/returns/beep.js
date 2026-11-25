// เสียงตอนยิงบาร์โค้ด — สร้างเสียงเองด้วย Web Audio ไม่ต้องมีไฟล์เสียง
//   ok   = ติ๊ดสั้นเสียงสูง (เจอกล่อง)
//   save = ติ๊ด-ติ๊ด ขึ้นเสียง (บันทึกแล้ว)
//   err  = ตื๊ด ๆ เสียงต่ำ (ไม่เจอ / ผิดพลาด)
// เบราว์เซอร์ยอมให้มีเสียงหลังผู้ใช้กด/พิมพ์อะไรสักอย่างแล้ว — ปืนยิงพิมพ์+Enter ให้ ถือว่ากดแล้ว
let ctx = null;

function audio() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(a, freq, start, dur, type = 'square', vol = 0.18) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  ok: [[1800, 0, 0.09]],
  save: [[1300, 0, 0.08], [2000, 0.1, 0.12]],
  err: [[220, 0, 0.18, 'sawtooth'], [220, 0.24, 0.18, 'sawtooth']],
};

// เรียกตอนผู้ใช้กดปุ่ม/พิมพ์ครั้งแรก ให้เบราว์เซอร์ปลดล็อกเสียงไว้ก่อน
export function unlockSound() {
  audio();
}

export function beep(kind = 'ok') {
  try {
    const a = audio();
    if (!a) return;
    for (const [f, s, d, type] of SOUNDS[kind] || SOUNDS.ok) tone(a, f, s, d, type);
  } catch { /* ไม่มีเสียงก็ใช้งานต่อได้ */ }
}
