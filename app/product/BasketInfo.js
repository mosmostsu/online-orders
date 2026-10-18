'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// ส่วน "ข้อมูลสินค้า" ในหน้าแก้ไขสินค้า — ชื่อ / รายละเอียด / หมวด · บันทึกที่ /api/basket/<platform> action 'info'
//   Shopee: รายละเอียดเป็นข้อความล้วน (แบบมีรูปแทรกแก้จากเว็บไม่ได้) · เปลี่ยนหมวดได้ — หมวดใหม่บังคับแอตทริบิวต์ไหนที่ยังไม่มี เว็บถามให้กรอก
//   TikTok / Lazada: รายละเอียดเป็น HTML (ดูตัวอย่างได้) · หมวดเปลี่ยนในหลังร้านเท่านั้น
//   TikTok แก้แล้วต้องรอตรวจ
const LABEL = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok' };

export default function BasketInfo({ platform, shop, itemId, info, sellerUrl, auditing }) {
  const label = LABEL[platform] || platform;
  const router = useRouter();
  const [title, setTitle] = useState(info.title || '');
  const [desc, setDesc] = useState(info.description || '');
  const [preview, setPreview] = useState(false);
  const [cat, setCat] = useState(null);        // null | { q, list, chosen: { id, path } | null, need: [], attrs: {} }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const api = (q) => `/api/basket/${platform}?${new URLSearchParams({ shop, itemId, ...q })}`;
  const titleCh = title.replace(/\s+/g, ' ').trim() !== (info.title || '');
  const descCh = info.descEditable && desc.replace(/\r\n/g, '\n').trim() !== String(info.description || '').trim();
  const catCh = Boolean(cat?.chosen && Number(cat.chosen.id) !== Number(info.category?.id));
  const needLeft = (cat?.need || []).filter((a) => !cat.attrs[a.id]?.value_id && !String(cat.attrs[a.id]?.original_value_name || '').trim()).length;
  const dirty = titleCh || descCh || catCh;

  async function openCats() {
    if (cat) { setCat(null); return; }
    setCat({ q: '', list: null, chosen: null, need: [], attrs: {} });
    try {
      const j = await fetch(api({ cats: '1' })).then((r) => r.json());
      if (!j.ok) throw new Error(j.error);
      setCat((c) => (c ? { ...c, list: j.cats } : c));
    } catch (e) { setMsg({ ok: false, text: `โหลดรายการหมวดไม่ได้: ${e.message}` }); setCat(null); }
  }
  async function choose(c) {
    setCat((x) => ({ ...x, chosen: c, need: [], attrs: {} }));
    try {
      const j = await fetch(api({ catNeeds: String(c.id) })).then((r) => r.json());
      if (!j.ok) throw new Error(j.error);
      setCat((x) => (x ? { ...x, need: j.need || [] } : x));
    } catch (e) { setMsg({ ok: false, text: `อ่านแอตทริบิวต์ของหมวดไม่ได้: ${e.message}` }); }
  }
  const setAttr = (id, v) => setCat((x) => ({ ...x, attrs: { ...x.attrs, [id]: v } }));
  const found = useMemo(() => {
    if (!cat?.list) return [];
    const words = cat.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return cat.list.filter((c) => words.every((w) => c.path.toLowerCase().includes(w))).slice(0, 40);
  }, [cat?.list, cat?.q]);

  async function save() {
    const lines = [titleCh && `ชื่อ: ${title.trim()}`, descCh && 'รายละเอียด: แก้แล้ว', catCh && `หมวด: ${info.category?.path || info.category?.id} → ${cat.chosen.path}`].filter(Boolean);
    if (!window.confirm(`บันทึกข้อมูลสินค้าลงตะกร้าจริงใน ${label} ${shop}?\n\n${lines.join('\n')}${platform === 'tiktok' ? '\n\nTikTok ต้องรอตรวจก่อนของใหม่จะขึ้น' : ''}`)) return;
    setBusy(true); setMsg(null);
    try {
      const body = {
        action: 'info', shop, itemId,
        ...(titleCh ? { title } : {}),
        ...(descCh ? { description: desc } : {}),
        ...(catCh ? { category: { id: cat.chosen.id, attrs: cat.attrs } } : {}),
      };
      const res = await fetch(`/api/basket/${platform}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ ok: false, error: `เซิร์ฟเวอร์ตอบ ${res.status}` }));
      if (!j.ok) {
        if (j.payload?.need) setCat((x) => (x ? { ...x, need: j.payload.need } : x));
        throw new Error(j.error);
      }
      setMsg({ ok: true, text: `✓ บันทึกแล้ว${j.warnings?.length ? ' · ' + j.warnings.join(' · ') : ''}` });
      setCat(null);
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const reset = () => { setTitle(info.title || ''); setDesc(info.description || ''); setCat(null); setMsg(null); };
  const canSave = !busy && dirty && !(catCh && needLeft) && !(auditing && platform === 'tiktok') && title.trim();

  return (
    <section className="pcard esec">
      <div className="eimg-head">
        <h2 className="esec-h" style={{ margin: 0 }}>ข้อมูลสินค้า</h2>
        <div className="etop-r">
          {msg && <span className={msg.ok ? 'ok-t' : 'danger'}>{msg.text}</span>}
          {!msg && dirty && <span className="sku">ยังไม่ได้บันทึก</span>}
          {dirty && <button type="button" className="btn" onClick={reset} disabled={busy}>ยกเลิก</button>}
          <button type="button" className="btn dark" onClick={save} disabled={!canSave}>{busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}</button>
        </div>
      </div>

      <div className="erow">
        <div className="elabel">ชื่อสินค้า</div>
        <div className="efield">
          <input className={'bin info-in' + (titleCh ? ' chg' : '')} value={title} maxLength={info.titleMax} onChange={(e) => setTitle(e.target.value)} />
          <div className="sub" style={{ margin: '2px 0 0' }}>{title.trim().length}/{info.titleMax}</div>
        </div>
      </div>

      <div className="erow">
        <div className="elabel">หมวดหมู่</div>
        <div className="efield">
          <div className="bedit-bar" style={{ margin: 0 }}>
            <span>{info.category?.path || (info.category?.id ? `#${info.category.id}` : '—')}</span>
            {catCh && <span className="badge warn">→ {cat.chosen.path}</span>}
            {info.category?.editable
              ? <button type="button" className="btn" onClick={openCats}>{cat ? 'ปิด' : 'เปลี่ยนหมวด'}</button>
              : sellerUrl && <a className="link" href={sellerUrl} target="_blank" rel="noreferrer">{label} เปลี่ยนหมวดผ่าน API ไม่ได้ — เปลี่ยนในหลังร้าน ↗</a>}
          </div>
          {cat && (
            <div className="note" style={{ marginTop: 8 }}>
              <div className="sub" style={{ margin: '0 0 6px' }}>⚠ เปลี่ยนหมวดแล้ว Shopee อาจส่งตะกร้าไปตรวจใหม่ และค่าแอตทริบิวต์เดิมที่หมวดใหม่ไม่มีจะหายไป</div>
              {!cat.list ? <span className="sku">กำลังโหลดรายการหมวด…</span> : (
                <>
                  <input className="bin info-in" placeholder="ค้นหาหมวด เช่น กางเกง กีฬา" value={cat.q} onChange={(e) => setCat((x) => ({ ...x, q: e.target.value }))} />
                  {found.length > 0 && (
                    <div className="cat-list">
                      {found.map((c) => (
                        <button key={c.id} type="button" className={'cat-row' + (cat.chosen?.id === c.id ? ' on' : '')} onClick={() => choose(c)}>{c.path}</button>
                      ))}
                    </div>
                  )}
                  {cat.q.trim() && !found.length && <div className="sku">ไม่เจอหมวดที่ตรง</div>}
                </>
              )}
              {cat.chosen && cat.need.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                  <b>หมวดนี้บังคับกรอก</b>
                  {cat.need.map((a) => (
                    <label key={a.id} className="bedit-bar" style={{ margin: 0 }}>
                      <span style={{ minWidth: 140 }}>{a.name}</span>
                      {a.values.length > 0 ? (
                        <select className="bin info-sel" value={cat.attrs[a.id]?.value_id || ''}
                          onChange={(e) => { const v = a.values.find((x) => String(x.value_id) === e.target.value); setAttr(a.id, v ? { value_id: v.value_id, original_value_name: v.name } : null); }}>
                          <option value="">— เลือก —</option>
                          {a.values.map((v) => <option key={v.value_id} value={v.value_id}>{v.name}</option>)}
                        </select>
                      ) : (
                        <input className="bin info-sel" value={cat.attrs[a.id]?.original_value_name || ''} onChange={(e) => setAttr(a.id, { value_id: 0, original_value_name: e.target.value })} />
                      )}
                    </label>
                  ))}
                </div>
              )}
              {cat.chosen && !cat.need.length && <div className="sku" style={{ marginTop: 6 }}>แอตทริบิวต์บังคับของหมวดนี้ใช้ค่าเดิมได้ครบ</div>}
            </div>
          )}
        </div>
      </div>

      <div className="erow">
        <div className="elabel">รายละเอียด</div>
        <div className="efield">
          {!info.descEditable ? (
            <div className="note">รายละเอียดของตะกร้านี้เป็นแบบมีรูปแทรก — แก้จากเว็บแล้วรูปจะหาย {sellerUrl && <a className="link" href={sellerUrl} target="_blank" rel="noreferrer">แก้ในหลังร้าน ↗</a>}</div>
          ) : (
            <>
              {info.descHtml && (
                <div className="bedit-bar" style={{ margin: '0 0 6px' }}>
                  <button type="button" className="chip" data-on={preview ? '0' : '1'} onClick={() => setPreview(false)}>แก้ HTML</button>
                  <button type="button" className="chip" data-on={preview ? '1' : '0'} onClick={() => setPreview(true)}>ดูตัวอย่าง</button>
                </div>
              )}
              {preview && info.descHtml
                ? <iframe className="info-prev" sandbox="" srcDoc={desc} title="ตัวอย่างรายละเอียด" />
                : <textarea className={'bin info-desc' + (descCh ? ' chg' : '')} value={desc} maxLength={info.descMax} onChange={(e) => setDesc(e.target.value)} />}
              <div className="sub" style={{ margin: '2px 0 0' }}>{desc.length}/{info.descMax}{info.descHtml ? ' · HTML' : ' · ข้อความล้วน'}</div>
            </>
          )}
        </div>
      </div>
      {platform === 'tiktok' && <div className="sub" style={{ margin: '6px 0 0' }}>TikTok: แก้ชื่อ/รายละเอียดแล้วต้องรอตรวจ (ตะกร้าเดิมยังขายต่อ){auditing ? ' · ตอนนี้ยังรอตรวจการแก้ครั้งก่อน แก้เพิ่มไม่ได้' : ''}</div>}
    </section>
  );
}
