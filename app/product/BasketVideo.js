'use client';
import { useState } from 'react';
import { md5 } from '@/lib/md5';

// แถว "วิดีโอ" ในส่วนการขายและจัดส่ง (app/product/BasketMore.js) — อัปโหลดเสร็จแล้วส่งรหัสขึ้นไปให้ปุ่ม "บันทึกการจัดส่ง" ผูกเข้าตะกร้า
//   Shopee  MD5 ทั้งไฟล์ในเบราว์เซอร์ → init → ส่งทีละชิ้น 4MB ผ่านเซิร์ฟเวอร์ → complete → รอแปลงไฟล์จน SUCCEEDED
//   TikTok  ฝากไฟล์ที่ Supabase Storage (ลิงก์เซ็นแล้ว ไม่ผ่าน Netlify) → เซิร์ฟเวอร์ส่งต่อ TikTok
//   ขั้นตอนของแต่ละแพลตฟอร์มดู lib/basketVideo.js
const MAX = 30 * 1024 * 1024;
const TYPES = { shopee: ['video/mp4', 'video/quicktime'], tiktok: ['video/mp4', 'video/quicktime', 'video/webm'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ความยาว/ขนาดภาพจากไฟล์ (ถ้าเบราว์เซอร์เปิดไฟล์นี้ไม่ได้ คืน null แล้วให้แพลตฟอร์มตรวจเอง)
function meta(url) {
  return new Promise((ok) => {
    const v = document.createElement('video');
    const t = setTimeout(() => ok(null), 8000);
    v.preload = 'metadata';
    v.onloadedmetadata = () => { clearTimeout(t); ok({ duration: v.duration, w: v.videoWidth, h: v.videoHeight }); };
    v.onerror = () => { clearTimeout(t); ok(null); };
    v.src = url;
  });
}
async function json(res) {
  const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
  if (!j.ok) throw new Error(j.error);
  return j;
}

export default function BasketVideo({ platform, shop, itemId, video, picked, onPick, remove, onRemove, disabled }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const post = (body) => fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, shop }) }).then(json);

  async function shopeeUpload(file) {
    setBusy('กำลังคิด MD5…');
    const buf = new Uint8Array(await file.arrayBuffer());
    const { uploadId, partSize, parts } = await post({ action: 'video-init', md5: md5(buf), size: buf.length });
    const t0 = Date.now();
    try {
      for (let seq = 0; seq < parts; seq += 1) {
        setBusy(`อัปโหลด ${seq + 1}/${parts}…`);
        const q = new URLSearchParams({ action: 'video-part', shop, uploadId, seq: String(seq) });
        await fetch(`/api/basket/shopee?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf.slice(seq * partSize, (seq + 1) * partSize) }).then(json);
      }
      await post({ action: 'video-complete', uploadId, parts, cost: Date.now() - t0 });
      // Shopee แปลงไฟล์ต่อ — ถามผลทุก 3 วินาที ไม่เกิน 3 นาที
      for (let i = 0; i < 60; i += 1) {
        setBusy(`Shopee กำลังแปลงไฟล์… (${(i + 1) * 3} วิ)`);
        await sleep(3000);
        const { video: r } = await fetch(`/api/basket/shopee?${new URLSearchParams({ shop, itemId, videoResult: uploadId })}`).then(json);
        if (r.status === 'SUCCEEDED') return { id: uploadId, url: r.url, cover: r.cover };
        if (r.status === 'FAILED' || r.status === 'CANCELLED') throw new Error(`Shopee แปลงไฟล์ไม่ผ่าน: ${r.message || r.status}`);
      }
      throw new Error('Shopee แปลงไฟล์นานเกิน 3 นาที — ลองใหม่อีกครั้ง');
    } catch (e) {
      post({ action: 'video-cancel', uploadId }).catch(() => {});
      throw e;
    }
  }
  async function tiktokUpload(file) {
    setBusy('กำลังฝากไฟล์…');
    const { path, url } = await post({ action: 'video-stage', size: file.size, type: file.type });
    const put = await fetch(url, { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file });
    if (!put.ok) throw new Error(`ฝากไฟล์ไม่สำเร็จ (${put.status}) ${(await put.text().catch(() => '')).slice(0, 120)}`);
    setBusy('กำลังส่งให้ TikTok…');
    const r = await post({ action: 'video-upload', path });
    return { id: r.id, url: r.url };
  }

  async function pick(file) {
    if (!file) return;
    setErr(null);
    if (!TYPES[platform].includes(file.type)) { setErr(`ไฟล์ต้องเป็น ${platform === 'shopee' ? 'MP4 / MOV' : 'MP4 / MOV / WEBM'}`); return; }
    if (file.size > MAX) { setErr(`ไฟล์ใหญ่เกิน 30MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`); return; }
    const local = URL.createObjectURL(file);
    const m = await meta(local);
    if (m && platform === 'shopee' && (m.duration < 10 || m.duration > 60)) { setErr(`Shopee: วิดีโอต้องยาว 10-60 วินาที (ไฟล์นี้ ${Math.round(m.duration)} วินาที)`); return; }
    if (m && platform === 'tiktok' && m.w && m.h && (m.w / m.h > 16 / 9 + 0.01 || m.w / m.h < 9 / 16 - 0.01)) { setErr('TikTok: อัตราส่วนภาพต้องอยู่ระหว่าง 9:16 ถึง 16:9'); return; }
    try {
      const r = platform === 'shopee' ? await shopeeUpload(file) : await tiktokUpload(file);
      onPick({ ...r, url: local });
    } catch (e) { setErr(`อัปโหลดวิดีโอไม่สำเร็จ: ${e.message}`); }
    finally { setBusy(''); }
  }

  const show = picked || (!remove && video.url ? video : null);
  return (
    <div className="efield">
      <div className="eimgs" style={{ alignItems: 'center' }}>
        {show && (
          <div className={'eimg' + (picked ? ' new' : '')} style={{ width: 'auto', height: 'auto' }}>
            <video src={show.url} poster={show.cover || undefined} controls preload="metadata" style={{ display: 'block', maxWidth: 220, maxHeight: 220 }} />
          </div>
        )}
        {!show && <span className="sku">{remove ? 'จะลบวิดีโอเมื่อกดบันทึก' : 'ยังไม่มีวิดีโอ'}</span>}
        <label className="btn" style={{ padding: '4px 10px', opacity: busy || disabled ? 0.6 : 1 }}>
          {busy || (show ? 'เปลี่ยนวิดีโอ…' : 'อัปโหลดวิดีโอ…')}
          <input type="file" accept={TYPES[platform].join(',')} hidden disabled={Boolean(busy) || disabled} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {picked && !busy && <button type="button" className="btn" onClick={() => onPick(null)}>ไม่ใช้อันใหม่</button>}
        {!picked && !busy && video.url && video.canRemove && (
          <button type="button" className="btn" onClick={() => onRemove(!remove)}>{remove ? 'ไม่ลบแล้ว' : 'ลบวิดีโอ'}</button>
        )}
      </div>
      {err && <div className="danger" style={{ marginTop: 4 }}>{err}</div>}
      <div className="sub" style={{ margin: '2px 0 0' }}>
        {platform === 'shopee' ? 'MP4/MOV ยาว 10-60 วินาที ไม่เกิน 30MB' : 'MP4/MOV/WEBM ไม่เกิน 30MB อัตราส่วน 9:16 ถึง 16:9 (แนะนำ 1:1 ยาว 20-60 วินาที) · ต้องรอตรวจ · ลบวิดีโอต้องทำในหลังร้าน'}
        {picked ? ' · อัปโหลดแล้ว กด "บันทึกการจัดส่ง" เพื่อใส่เข้าตะกร้า' : ''}
      </div>
    </div>
  );
}
