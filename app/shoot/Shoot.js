'use client';
// หน้าถ่ายฟุตฝั่งเบราว์เซอร์ — แต่ละช็อตมีปุ่ม "ถ่าย" (เปิดกล้องมือถือ) กับ "เลือกคลิป" (จากเครื่อง)
// อัปเป็นชิ้นละ 8MB ตรงเข้า Drive (เน็ตหลุดกลางทางส่งต่อจากชิ้นที่ค้าง ไม่ต้องเริ่มใหม่) แล้วแจ้งเซิร์ฟเวอร์ให้ติ๊กช็อต
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { chunkRanges, nextOffset, MAX_BYTES } from '@/lib/shoot';

const dm = (d) => { const [, m, day] = String(d).split('-'); return `${Number(day)}/${Number(m)}`; };
const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);

async function call(body) {
  const r = await fetch('/api/shoot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `บันทึกไม่สำเร็จ (${r.status})`);
  return j;
}

// ส่ง 1 ชิ้น → { done, file } | { next } · 308 = Drive รับชิ้นนี้แล้ว รอชิ้นถัดไป
function putChunk(url, file, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
    x.upload.onprogress = (e) => onProgress(start + e.loaded);
    x.onerror = () => reject(new Error('เน็ตหลุด'));
    x.ontimeout = () => reject(new Error('หมดเวลา'));
    x.onload = () => {
      if (x.status === 200 || x.status === 201) { try { resolve({ done: true, file: JSON.parse(x.responseText) }); } catch { reject(new Error('Drive ตอบกลับไม่ครบ')); } return; }
      if (x.status === 308) { resolve({ next: nextOffset(x.getResponseHeader('Range')) ?? end + 1 }); return; }
      reject(new Error(`Drive ตอบ ${x.status}`));
    };
    x.send(file.slice(start, end + 1));
  });
}

async function upload(url, file, onProgress) {
  const ranges = chunkRanges(file.size);
  for (let i = 0; i < ranges.length; i += 1) {
    const { start, end } = ranges[i];
    let res = null;
    for (let attempt = 0; attempt < 4 && !res; attempt += 1) {
      try { res = await putChunk(url, file, start, end, onProgress); } catch (e) {
        if (attempt === 3) throw new Error(`อัปไม่สำเร็จ (${e.message}) — เช็คสัญญาณแล้วกดใหม่`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (res.done) return res.file;
    if (i === ranges.length - 1) throw new Error('Drive ยังรับไฟล์ไม่ครบ — กดอัปใหม่');
  }
  throw new Error('ไฟล์ว่าง');
}

export default function Shoot({ shoots, drive }) {
  const router = useRouter();
  const [state, setState] = useState({}); // "id:index" → { pct, msg, err }
  const [busy, setBusy] = useState('');
  const pick = useRef(null);   // { id, index }
  const camRef = useRef(null), fileRef = useRef(null);

  const set = (k, v) => setState((s) => ({ ...s, [k]: v }));
  const open = (id, index, cam) => { if (busy) return; pick.current = { id, index }; (cam ? camRef : fileRef).current?.click(); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const p = pick.current;
    if (!file || !p) return;
    const k = `${p.id}:${p.index}`;
    if (!String(file.type).startsWith('video/')) { set(k, { err: 'รับเฉพาะไฟล์วิดีโอ' }); return; }
    if (file.size > MAX_BYTES) { set(k, { err: 'ไฟล์ใหญ่เกิน 2 GB' }); return; }
    setBusy(k);
    try {
      set(k, { pct: 0, msg: `กำลังอัป 0/${mb(file.size)} MB` });
      const { uploadUrl, name } = await call({ op: 'start', id: p.id, index: p.index, fileName: file.name, mime: file.type, size: file.size });
      const done = await upload(uploadUrl, file, (sent) => set(k, { pct: Math.min(99, Math.round((sent / file.size) * 100)), msg: `กำลังอัป ${mb(sent)}/${mb(file.size)} MB` }));
      const r = await call({ op: 'done', id: p.id, index: p.index, fileId: done.id });
      set(k, { pct: 100, msg: `อัปแล้ว: ${name}${r.done ? ' · ครบทุกช็อตแล้ว' : ''}` });
      router.refresh();
    } catch (err) { set(k, { err: err.message }); } finally { setBusy(''); }
  };

  const total = shoots.reduce((n, s) => n + (s.shots || []).filter((_, i) => !(s.got || [])[i]).length, 0);
  return (
    <div className="sh">
      <div className="row"><div><h1>ถ่ายฟุต</h1><div className="sub">{shoots.length ? `${shoots.length} สินค้า · เหลือ ${total} ช็อต` : 'ไม่มีงานถ่ายค้าง'}</div></div></div>
      {!drive.ok && <div className="st-note"><b>ยังอัปไม่ได้</b> — {drive.why === 'env' ? 'ยังไม่ได้ตั้งค่า Google ใน Netlify' : 'ยังไม่ได้เชื่อม Google Drive'} · แจ้งเจ้าของร้าน</div>}
      <div className="st-note">ถ่ายแนวตั้ง · ไม่ใส่ตัวหนังสือ สติกเกอร์ หรือเพลง · ช็อตละ 5-8 วินาที · ถ่ายใหม่ได้ ไฟล์เก่าไม่หาย</div>
      <input ref={camRef} type="file" accept="video/*" capture="environment" hidden onChange={onFile} />
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      <div className="st-list">
        {shoots.map((s) => (
          <div className="st-row" key={s.id}>
            <h3>{s.product}</h3>
            {s.due && <div className="st-muted">ภายใน {dm(s.due)}</div>}
            <ol className="sh-shots">
              {(s.shots || []).map((x, i) => {
                const k = `${s.id}:${i}`; const st = state[k]; const got = Boolean((s.got || [])[i]);
                return (
                  <li key={i} className={got ? 'sh-got' : ''}>
                    <div className="sh-text">{got ? '✓ ' : ''}{x}</div>
                    <div className="sh-btns">
                      <button className="btn st-pri" type="button" disabled={!drive.ok || Boolean(busy)} onClick={() => open(s.id, i, true)}>{got ? 'ถ่ายใหม่' : 'ถ่าย'}</button>
                      <button className="btn" type="button" disabled={!drive.ok || Boolean(busy)} onClick={() => open(s.id, i, false)}>เลือกคลิป</button>
                    </div>
                    {st?.msg && !st.err && <div className="sh-prog"><div className="sh-bar"><i style={{ width: `${st.pct || 0}%` }} /></div><span>{st.msg}</span></div>}
                    {st?.err && <div className="sh-err" role="alert">{st.err}</div>}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
