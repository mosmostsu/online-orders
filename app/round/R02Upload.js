'use client';
// ปุ่มอัปโหลดรีพอร์ต R02.102 จาก Seniorsoft — อ่านในเบราว์เซอร์ (lib/r02.js) ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์
// จำผลไว้ในเครื่องตามวัน (localStorage) กดรีเฟรชแล้วไม่ต้องอัปใหม่ · ไฟล์ทั้งวันอัปซ้ำได้ ไฟล์ใหม่ทับของเดิม
import { useEffect, useRef, useState } from 'react';
import { readSheetRows, parseR02, docsOf, fixParts, CASH } from '@/lib/r02';
import { PLATFORM_LABEL } from '@/lib/shopGroups';

const KEY = (day) => `r02:${day}`;
export function saveR02(day, v) {
  try { if (v) localStorage.setItem(KEY(day), JSON.stringify(v)); else localStorage.removeItem(KEY(day)); } catch { /* เต็ม/บล็อก — ใช้ได้แค่จนปิดหน้า */ }
}
const thaiDayOf = (iso) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
// ยิงพลาด: เลือกทีละใบว่านับเป็นช่องทางไหน — จำไว้กับไฟล์ของวันนั้นเท่านั้น (อัปไฟล์ใหม่ของวันเดียวกัน แก้ที่เลือกไว้ยังอยู่)
const FIX_OPTS = [['tiktok', 'TikTok'], ['shopee', 'Shopee'], ['lazada', 'Lazada'], ['thisshop', 'ThisShop'], ['skip', 'ไม่นับ']];
const ROUND_OPTS = [1, 2, 3];
const plabel = (p) => (p === CASH ? 'เงินสด — ไม่นับ' : PLATFORM_LABEL[p] || p);
const hhmm = (s) => new Date(s).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

export default function R02Upload({ day, round, value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY(day)) || 'null');
      if (saved?.lines) onChange(saved);
    } catch { /* เปิดแบบส่วนตัว/บล็อก storage — แค่ไม่จำ */ }
  }, [day]);   // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (file) => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const all = parseR02(await readSheetRows(new Uint8Array(await file.arrayBuffer())));
      const lines = all.filter((l) => thaiDayOf(l.at) === day);
      if (!lines.length) {
        const days = [...new Set(all.map((l) => thaiDayOf(l.at)))].join(', ');
        setMsg(all.length ? `ไฟล์นี้เป็นของวันที่ ${days} ไม่ใช่วันที่เปิดอยู่` : 'ไม่พบใบขาย OSVS ของ TikTok / Shopee / Lazada / ThisShop ในไฟล์ — ใช่ไฟล์ R02.102 ไหม');
        return;
      }
      save({ file: file.name, at: new Date().toISOString(), lines, fix: value?.fix || {}, merge: value?.merge || {}, subs: value?.subs || [] });
    } catch (e) {
      setMsg('อ่านไฟล์ไม่ได้: ' + (e.message || e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const save = (v) => { onChange(v); saveR02(day, v); };

  // p = ช่องทาง ('' = ตามชื่อลูกค้า, 'skip' = ไม่นับ) · r = รอบ (null = ตามเวลายิง)
  const setFix = (doc, p, r) => {
    const fix = { ...(value.fix || {}) };
    const to = p === 'skip' ? 'skip' : r ? `${p}|${r}` : p;
    if (to) fix[doc] = to; else delete fix[doc];
    save({ ...value, fix });
  };

  // ยิงปนกันทั้งรอบ (เช่น ของ Shopee ยิงเข้า Tiktok shop) — เทียบยอดรวมทุกช่องทางของรอบนี้ เฉพาะวันนี้
  const setMerge = (on) => {
    const merge = { ...(value.merge || {}) };
    if (on) merge[round] = true; else delete merge[round];
    save({ ...value, merge });
  };

  const clear = () => {
    onChange(null);
    try { localStorage.removeItem(KEY(day)); } catch { /* ไม่เป็นไร */ }
  };

  const docs = value ? docsOf(value.lines) : [];
  const fixed = docs.filter((d) => value.fix?.[d.doc]).length;
  // ที่ย้ายทีละตัว (ปุ่ม "นับเป็นของรอบ n" ในตารางของเกิน) — โชว์ไว้ให้ยกเลิกได้
  const moved = Object.entries(value?.fix || {}).filter(([k]) => k.includes('#'));
  const unmove = (k) => { const fix = { ...value.fix }; delete fix[k]; save({ ...value, fix }); };
  const subs = value?.subs || [];
  const unsub = (i) => save({ ...value, subs: subs.filter((_, j) => j !== i) });
  return (
    <span className="r02">
      <input ref={input} type="file" accept=".xlsx,.XLSX" hidden onChange={(e) => load(e.target.files?.[0])} />
      <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'กำลังอ่าน…' : value ? '📄 อัป R02.102 ใหม่' : '📄 อัปโหลด R02.102 เพื่อเช็ค'}
      </button>
      {value && (
        <span className="sub" style={{ margin: 0 }}>
          {value.file} · {docs.length} ใบ · อัป {hhmm(value.at)} น. ·{' '}
          <button className="linkbtn" onClick={clear}>เอาออก</button>
        </span>
      )}
      {msg && <span className="stale">{msg}</span>}
      {value && (
        <label className="r02merge" data-on={value.merge?.[round] ? '1' : '0'}>
          <input type="checkbox" checked={!!value.merge?.[round]} onChange={(e) => setMerge(e.target.checked)} />
          รอบ {round} ยิงปนกัน — นับทุกช่องทางรวมกัน (เฉพาะวันนี้)
        </label>
      )}
      {value && (
        <details className="r02fix">
          <summary>ยิงพลาด? แก้ทีละใบ{fixed ? ` · แก้แล้ว ${fixed} ใบ` : ''}{moved.length ? ` · ย้ายรอบ ${moved.length} ตัว` : ''}{subs.length ? ` · ส่งแทน ${subs.length}` : ''}</summary>
          {subs.length > 0 && (
            <div className="r02moved">
              ส่งของแทน (เปลี่ยนสี/ไซส์):{' '}
              {subs.map((x, i) => (
                <span key={i} className="r02moved-i">
                  รอบ {x.n} {PLATFORM_LABEL[x.platform] || x.platform}: {x.from} แทน {x.to} ({x.qty}) <button className="linkbtn" onClick={() => unsub(i)}>ยกเลิก</button>
                </span>
              ))}
            </div>
          )}
          {moved.length > 0 && (
            <div className="r02moved">
              ย้ายไปนับรอบอื่นทีละตัว:{' '}
              {moved.map(([k, v]) => (
                <span key={k} className="r02moved-i">
                  {k.replace('#', ' · ')} → รอบ {fixParts(v).r} <button className="linkbtn" onClick={() => unmove(k)}>ยกเลิก</button>
                </span>
              ))}
            </div>
          )}
          <table>
            <thead><tr><th>เวลายิง</th><th>เลขใบ</th><th>ลูกค้าใน Seniorsoft</th><th className="num">ชิ้น</th><th>นับเป็นช่องทาง</th><th>นับในรอบ</th></tr></thead>
            <tbody>
              {docs.map((d) => { const f = fixParts(value.fix?.[d.doc]); return (
                <tr key={d.doc} data-fixed={value.fix?.[d.doc] ? '1' : '0'}>
                  <td>{hhmm(d.at)}</td>
                  <td><span className="rsku">{d.doc}</span></td>
                  <td>{d.cust || plabel(d.platform)}</td>
                  <td className="num">{d.qty}</td>
                  <td>
                    <select value={f.p} onChange={(e) => setFix(d.doc, e.target.value, f.r)}>
                      <option value="">ตามชื่อลูกค้า ({plabel(d.platform)})</option>
                      {FIX_OPTS.filter(([k]) => k !== d.platform).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={f.r || ''} disabled={f.p === 'skip'} onChange={(e) => setFix(d.doc, f.p, Number(e.target.value) || null)}>
                      <option value="">ตามเวลายิง</option>
                      {ROUND_OPTS.map((n) => <option key={n} value={n}>รอบ {n}</option>)}
                    </select>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </details>
      )}
    </span>
  );
}
