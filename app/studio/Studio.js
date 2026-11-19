'use client';
// หน้าตา Studio ทั้งหมด (ข้อมูลมาจาก page.js) · บันทึกผ่าน POST /api/studio แล้ว router.refresh()
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  STATUSES, SHOPS, statusLabel, weekDays, addDays, postQueue, cutQueue, lowFootage, captionText, basketOf, listingUrl,
} from '@/lib/studio';
import './studio.css';

const TABS = [
  { key: 'week', label: 'แผนสัปดาห์' },
  { key: 'cut', label: 'คิวตัดคลิป' },
  { key: 'shoot', label: 'ต้องถ่าย' },
  { key: 'post', label: 'วันนี้โพสต์' },
];
const DOW = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const dm = (iso) => { if (!iso) return ''; const [, m, d] = String(iso).split('-'); return `${+d}/${+m}`; };
const safe = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
// ลิงก์ไฟล์ Google Drive → หน้าเล่นวิดีโอแบบฝัง (คนดูต้องล็อกอิน Google ที่เห็นไฟล์นั้น)
const drivePreview = (u) => { const m = /\/d\/([\w-]{10,})/.exec(u || '') || /[?&]id=([\w-]{10,})/.exec(u || ''); return m ? `https://drive.google.com/file/d/${m[1]}/preview` : ''; };

async function save(kind, op, row) {
  const res = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, op, row }) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('ต้องใส่รหัสใหม่ — รีเฟรชหน้านี้');
  if (!res.ok || !j.ok) throw new Error(j.error || 'บันทึกไม่สำเร็จ');
  return j.row;
}

export default function Studio({ clips, shoots, folders, listings, cands, shopIds, driveError, today }) {
  const router = useRouter();
  const [tab, setTab] = useState('week');
  const [week, setWeek] = useState(today);
  const [shopF, setShopF] = useState('ALL');
  const [dlg, setDlg] = useState(null); // {type:'clip'|'shoot'|'folder', data}
  const [toast, setToast] = useState(null); // {msg, undo}
  const [busy, setBusy] = useState(false);
  const [play, setPlay] = useState(null); // {title, src}
  const watch = (c) => setPlay({ title: c.product, src: drivePreview(c.video_url) });

  useEffect(() => {
    const read = () => { const h = location.hash.slice(1); setTab(TABS.some((t) => t.key === h) ? h : 'week'); };
    read(); addEventListener('hashchange', read);
    const focus = () => router.refresh(); addEventListener('focus', focus);
    return () => { removeEventListener('hashchange', read); removeEventListener('focus', focus); };
  }, [router]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), toast.undo ? 5000 : 2500); return () => clearTimeout(t); }, [toast]);

  const folderBy = useMemo(() => Object.fromEntries(folders.map((f) => [f.key, f])), [folders]);
  const basket = useCallback((c) => {
    const b = basketOf(c, folderBy, listings);
    if (!b) return null;
    const s = SHOPS.find((x) => x.key === c.shop);
    const url = b.url || (b.id && s?.platform ? listingUrl(s.platform, b.id, shopIds[`${s.platform}:${s.shop}`]) : '');
    return { ...b, url };
  }, [folderBy, listings, shopIds]);
  const coverOf = (f) => { for (const s of SHOPS) { const b = f.baskets?.[s.key]; const l = b?.id && listings[`${s.platform}:${s.shop}:${b.id}`]; if (l?.thumb_url) return l.thumb_url; } return ''; };

  const run = async (fn, okMsg, undo) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); if (okMsg) setToast({ msg: okMsg, undo }); router.refresh(); return true; } catch (e) { setToast({ msg: e.message }); return false; } finally { setBusy(false); }
  };
  const putClip = (row, msg) => run(() => save('clip', 'upsert', row), msg);
  const strip = ({ updated_at, ...r }) => r;

  const visClips = shopF === 'ALL' ? clips : clips.filter((c) => c.shop === shopF);
  const visFolders = shopF === 'ALL' ? folders : folders.filter((f) => (f.shops || []).includes(shopF));
  const counts = { cut: cutQueue(clips).length + clips.filter((c) => c.status === 'cut').length, shoot: shoots.filter((s) => !s.done).length, post: postQueue(clips, today).length };

  const ShopChips = () => (
    <div className="st-chips">
      {['ALL', ...SHOPS.map((s) => s.key)].map((k) => (
        <button key={k} type="button" className="st-chip" data-on={shopF === k ? '1' : '0'} onClick={() => setShopF(k)}>{k === 'ALL' ? 'ทุกร้าน' : k}</button>
      ))}
    </div>
  );

  const Thumb = ({ src, size = 40 }) => (safe(src) ? <img src={src} alt="" width={size} height={size} className="st-thumb" loading="lazy" /> : null);

  const Footage = () => {
    const low = new Set(lowFootage(visFolders).map((f) => f.key));
    const rows = [...visFolders].sort((a, b) => a.n - b.n);
    return (
      <section className="st-foot">
        <h2>คลังฟุต <span className="sub">{driveError ? `อ่าน Drive ไม่ได้ ใช้ตัวเลขสำรอง (${driveError})` : 'นับสดจาก Drive · ส้ม = น้อยกว่า 5 คลิป'}</span></h2>
        <ShopChips />
        <div className="st-fgrid">
          {rows.map((f) => (
            <button key={f.key} type="button" className="st-fc" data-low={low.has(f.key) ? '1' : '0'} onClick={() => setDlg({ type: 'folder', data: f })}>
              <Thumb src={coverOf(f)} />
              <span className="st-fc-t"><span className="st-muted">{f.cat}</span><br />{f.sub}<br />
                <span className="st-muted">{(f.shops || []).join(' · ') || 'ยังไม่เลือกร้าน'}{f.latest ? ` · ล่าสุด ${dm(f.latest.slice(0, 10))}` : ''}</span></span>
              <span className="st-n">{f.n}</span>
            </button>
          ))}
          {!rows.length && <div className="st-empty">ไม่มีโฟลเดอร์ของร้านนี้ — กดการ์ดโฟลเดอร์ในแท็บ "ทุกร้าน" แล้วติ๊กร้าน</div>}
        </div>
      </section>
    );
  };

  const ClipCard = ({ c }) => {
    const b = basket(c);
    return (
      <button type="button" className="st-card" data-s={c.status} onClick={() => setDlg({ type: 'clip', data: c })}>
        <Thumb src={b?.thumb_url} size={36} />
        <span className="st-card-t"><b>{c.product}</b><span className="st-muted">{[c.shop, c.angle, c.length_s ? `${c.length_s} วิ` : ''].filter(Boolean).join(' · ')}</span>
          <span className="st-pill" data-s={c.status}>{statusLabel(c.status)}</span></span>
      </button>
    );
  };

  const Week = () => {
    const days = weekDays(week);
    return (
      <>
        <div className="st-bar"><h2>สัปดาห์ {dm(days[0])} – {dm(days[6])}</h2>
          <button className="btn" type="button" onClick={() => setWeek(addDays(week, -7))} aria-label="สัปดาห์ก่อน">◀</button>
          <button className="btn" type="button" onClick={() => setWeek(today)}>วันนี้</button>
          <button className="btn" type="button" onClick={() => setWeek(addDays(week, 7))} aria-label="สัปดาห์ถัดไป">▶</button>
          <button className="btn st-pri" type="button" onClick={() => setDlg({ type: 'clip', data: { date: today, status: 'idea', shop: shopF === 'ALL' ? 'SOLID' : shopF } })}>+ คลิปใหม่</button>
        </div>
        <ShopChips />
        <div className="st-week">
          {days.map((d, i) => {
            const list = visClips.filter((c) => c.date === d).sort((a, b) => (a.slot || 0) - (b.slot || 0));
            return (
              <div key={d} className="st-day" data-today={d === today ? '1' : '0'}>
                <h3>{DOW[i]} {dm(d)} <span className="st-muted">{list.length || ''}</span></h3>
                {list.map((c) => <ClipCard key={c.id} c={c} />)}
                <button className="btn st-add" type="button" onClick={() => setDlg({ type: 'clip', data: { date: d, status: 'idea', shop: shopF === 'ALL' ? 'SOLID' : shopF } })}>+ เพิ่ม</button>
              </div>
            );
          })}
        </div>
        <Footage />
      </>
    );
  };

  const Cut = () => {
    const q = cutQueue(visClips), wait = visClips.filter((c) => c.status === 'cut');
    return (
      <>
        <div className="st-note">มอสพิมพ์ในแชท Claude ว่า <b>“ตัดคิว”</b> — Claude อ่านรายการ “เข้าคิวตัด” จากหน้านี้ ตัดคลิปลง <b>#TTvid/คลิปพร้อมโพสต์</b> แล้วเปลี่ยนเป็น “รออนุมัติ”</div>
        <ShopChips />
        <div className="st-bar"><h2>เข้าคิวตัด ({q.length})</h2></div>
        <div className="st-list">
          {q.map((c) => (
            <div key={c.id} className="st-row"><h3>{c.product} <span className="st-muted">· {c.shop}</span></h3>
              <div className="st-muted">{dm(c.date)} · {c.angle || '-'} · {c.length_s || '?'} วิ · ฟุต: {c.folder || '-'}</div>
              {c.note && <pre>{c.note}</pre>}
              <div className="st-acts"><button className="btn" type="button" onClick={() => setDlg({ type: 'clip', data: c })}>แก้ใบสั่ง</button></div>
            </div>
          ))}
          {!q.length && <div className="st-empty">ยังไม่มีคลิปในคิว</div>}
        </div>
        <div className="st-bar"><h2>ตัดแล้ว รออนุมัติ ({wait.length})</h2></div>
        <div className="st-list">
          {wait.map((c) => (
            <div key={c.id} className="st-row"><h3>{c.product} <span className="st-muted">· {c.shop}</span></h3>
              <div className="st-muted">{dm(c.date)}{c.file ? ` · ไฟล์: ${c.file}` : ''}</div>
              <div className="st-acts">
                <button className="btn st-pri" type="button" onClick={() => putClip({ ...strip(c), status: 'approved' }, 'อนุมัติแล้ว')}>อนุมัติ</button>
                <button className="btn" type="button" onClick={() => putClip({ ...strip(c), status: 'queued' }, 'ส่งกลับไปตัดใหม่')}>ส่งกลับไปตัดใหม่</button>
                {drivePreview(c.video_url) && <button className="btn" type="button" onClick={() => watch(c)}>▶ ดูคลิป</button>}
                <button className="btn" type="button" onClick={() => setDlg({ type: 'clip', data: c })}>แก้</button>
              </div>
            </div>
          ))}
          {!wait.length && <div className="st-empty">ไม่มีคลิปรออนุมัติ</div>}
        </div>
      </>
    );
  };

  const Shoot = () => {
    const open = shoots.filter((s) => !s.done), done = shoots.filter((s) => s.done);
    const Row = ({ s }) => {
      const f = folderBy[s.folder];
      return (
        <div className="st-row"><h3>{s.product}</h3>
          <div className="st-muted">{s.due ? `ภายใน ${dm(s.due)} · ` : ''}เก็บที่ {s.folder || '-'}{f ? ` · มีแล้ว ${f.n} คลิป` : ''}</div>
          <div className="st-shots">
            {(s.shots || []).map((x, i) => (
              <label key={i}><input type="checkbox" checked={Boolean((s.got || [])[i])}
                onChange={(e) => { const got = [...(s.got || [])]; got[i] = e.target.checked; run(() => save('shoot', 'upsert', { ...strip(s), got })); }} />{x}</label>
            ))}
          </div>
          <div className="st-acts">
            {safe(f?.drive_url) && <a className="btn st-pri" href={f.drive_url} target="_blank" rel="noopener noreferrer">เปิดโฟลเดอร์ Drive</a>}
            <button className="btn" type="button" onClick={() => run(() => save('shoot', 'upsert', { ...strip(s), done: !s.done }), s.done ? 'ย้ายกลับไปค้าง' : 'ถ่ายเสร็จแล้ว')}>{s.done ? 'ยังไม่เสร็จ' : 'ถ่ายเสร็จแล้ว'}</button>
            <button className="btn" type="button" onClick={() => setDlg({ type: 'shoot', data: s })}>แก้</button>
          </div>
        </div>
      );
    };
    return (
      <>
        <div className="st-bar"><h2>ต้องถ่าย ({open.length})</h2><button className="btn st-pri" type="button" onClick={() => setDlg({ type: 'shoot', data: {} })}>+ งานถ่าย</button></div>
        <div className="st-note">ให้คนถ่ายเปิด <a href="/shoot"><b>หน้าถ่ายฟุต (/shoot)</b></a> บนมือถือ — กดถ่ายทีละช็อต ไฟล์ขึ้น Drive พร้อมชื่อสินค้า+ช็อต ไม่ต้องใช้รหัสยอดขาย · ครบทุกช็อตแล้วคลิปที่รอฟุตจะเข้าคิวตัดเอง · ยังไม่เคยเชื่อม Drive? <a href="/api/auth/google">กดเชื่อมครั้งเดียว</a></div>
        <div className="st-list">{open.map((s) => <Row key={s.id} s={s} />)}{!open.length && <div className="st-empty">ไม่มีงานถ่ายค้าง</div>}</div>
        {done.length > 0 && <details className="st-done"><summary>เสร็จแล้ว ({done.length})</summary><div className="st-list">{done.map((s) => <Row key={s.id} s={s} />)}</div></details>}
        <Footage />
      </>
    );
  };

  const Post = () => {
    const q = postQueue(visClips, today);
    const copy = async (t, what) => { try { await navigator.clipboard.writeText(t); setToast({ msg: `ก๊อป${what}แล้ว` }); } catch { setToast({ msg: 'ก๊อปไม่ได้ — กดค้างที่ข้อความแล้วก๊อปเอง' }); } };
    return (
      <>
        <div className="st-bar"><h2>วันนี้ต้องโพสต์ ({q.length})</h2></div>
        <ShopChips />
        <div className="st-list">
          {q.map((c) => {
            const b = basket(c);
            return (
              <PostRow key={c.id} c={c} b={b} overdue={c.date < today} onCopy={copy}
                onPlay={drivePreview(c.video_url) ? () => watch(c) : null}
                onPosted={(posted_url) => run(() => save('clip', 'upsert', { ...strip(c), status: 'posted', posted_url }), 'บันทึกว่าโพสต์แล้ว',
                  () => run(() => save('clip', 'upsert', strip(c))))} />
            );
          })}
          {!q.length && <div className="st-empty">วันนี้ไม่มีคลิปที่อนุมัติแล้วรอโพสต์</div>}
        </div>
      </>
    );
  };

  return (
    <div className="st">
      <div className="row"><div><h1>Studio</h1><div className="sub">วางแผนคลิป · คิวตัด · ถ่ายฟุต · โพสต์</div></div></div>
      <nav className="st-tabs">
        {TABS.map((t) => (
          <a key={t.key} href={`#${t.key}`} data-on={tab === t.key ? '1' : '0'}>{t.label}{counts[t.key] ? <span className="st-badge">{counts[t.key]}</span> : null}</a>
        ))}
      </nav>
      {tab === 'week' && <Week />}
      {tab === 'cut' && <Cut />}
      {tab === 'shoot' && <Shoot />}
      {tab === 'post' && <Post />}

      {dlg?.type === 'clip' && <ClipDialog c={dlg.data} folders={folders} onClose={() => setDlg(null)}
        onSave={(row) => run(() => save('clip', 'upsert', row), 'บันทึกแล้ว').then((ok) => ok && setDlg(null))}
        onDelete={(c) => run(() => save('clip', 'delete', { id: c.id }), 'ลบแล้ว', () => run(() => save('clip', 'upsert', strip(c)))).then((ok) => ok && setDlg(null))} />}
      {dlg?.type === 'shoot' && <ShootDialog s={dlg.data} folders={folders} onClose={() => setDlg(null)}
        onSave={(row) => run(() => save('shoot', 'upsert', row), 'บันทึกแล้ว').then((ok) => ok && setDlg(null))}
        onDelete={(s) => run(() => save('shoot', 'delete', { id: s.id }), 'ลบแล้ว', () => run(() => save('shoot', 'upsert', strip(s)))).then((ok) => ok && setDlg(null))} />}
      {dlg?.type === 'folder' && <FolderDialog f={dlg.data} cands={cands[dlg.data.key] || {}} listings={listings} onClose={() => setDlg(null)}
        onSave={(row) => run(() => save('folder', 'upsert', row), 'บันทึกแล้ว').then((ok) => ok && setDlg(null))} />}

      {play && <Modal title={play.title} onClose={() => setPlay(null)}>
        <iframe className="st-player" src={play.src} title={play.title} allow="autoplay; fullscreen" allowFullScreen />
        <div className="st-muted">เล่นจาก Google Drive · ถ้าขึ้นว่าไม่มีสิทธิ์ ให้ล็อกอิน Google บัญชีที่เห็นโฟลเดอร์คลิป</div>
        <div className="st-acts"><button className="btn" type="button" onClick={() => setPlay(null)}>ปิด</button></div>
      </Modal>}
      {toast && <div className="st-toast" role="status">{toast.msg}{toast.undo && <button type="button" onClick={() => { const u = toast.undo; setToast(null); u(); }}>เลิกทำ</button>}</div>}
    </div>
  );
}

function PostRow({ c, b, overdue, onCopy, onPosted, onPlay }) {
  const [u, setU] = useState(c.posted_url || '');
  const cap = captionText(c);
  return (
    <div className="st-row">
      <div className="st-head">{safe(b?.thumb_url) && <img src={b.thumb_url} alt="" width={56} height={56} className="st-thumb" />}
        <h3>{c.product} <span className="st-muted">· {c.shop}</span></h3></div>
      <div className="st-muted">{overdue && <span className="st-late">ค้างจาก {dm(c.date)}</span>}{c.file ? ` ${c.file}` : ''}</div>
      <pre>{cap || '(ยังไม่มีแคปชั่น)'}</pre>
      {b?.title && <div className="st-muted">ตะกร้า: {b.title}</div>}
      <div className="st-acts">
        {onPlay && <button className="btn" type="button" onClick={onPlay}>▶ ดูคลิป</button>}
        <button className="btn" type="button" onClick={() => onCopy(cap, 'แคปชั่น')} disabled={!cap}>ก๊อปแคปชั่น</button>
        {safe(b?.url) ? <button className="btn" type="button" onClick={() => onCopy(b.url, 'ลิงก์ตะกร้า')}>ก๊อปลิงก์ตะกร้า</button> : <span className="st-muted">ยังไม่ผูกตะกร้า</span>}
        {b?.id && <button className="btn" type="button" onClick={() => onCopy(b.id, 'รหัสสินค้า')}>ก๊อปรหัส {b.id}</button>}
      </div>
      <div className="st-acts"><input value={u} onChange={(e) => setU(e.target.value)} placeholder="วางลิงก์คลิปที่โพสต์" inputMode="url" />
        <button className="btn st-pri" type="button" onClick={() => onPosted(safe(u.trim()) || null)}>โพสต์แล้ว</button></div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="st-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-dlg" role="dialog" aria-modal="true" aria-label={title}><h3>{title}</h3>{children}</div>
    </div>
  );
}

function ClipDialog({ c, folders, onClose, onSave, onDelete }) {
  const [v, setV] = useState({ shop: 'SOLID', status: 'idea', length_s: 30, ...c, hashtags: (c.hashtags || []).join(' ') });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const { updated_at, ...rest } = v;
    onSave({ ...rest, length_s: Number(v.length_s) || null, hashtags: String(v.hashtags || '').split(/\s+/).filter(Boolean), slot: c.slot || Date.now() % 1e6 });
  };
  return (
    <Modal title={c.id ? 'แก้คลิป' : 'คลิปใหม่'} onClose={onClose}>
      <form onSubmit={submit} className="st-form">
        <label>สินค้า<input required value={v.product || ''} onChange={set('product')} /></label>
        <div className="st-two"><label>วันที่โพสต์<input type="date" required value={v.date || ''} onChange={set('date')} /></label>
          <label>ลงร้าน<select value={v.shop} onChange={set('shop')}>{SHOPS.map((s) => <option key={s.key}>{s.key}</option>)}</select></label></div>
        <div className="st-two"><label>สถานะ<select value={v.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label>ความยาว (วิ)<input type="number" min="5" max="180" value={v.length_s || ''} onChange={set('length_s')} /></label></div>
        <label>มุม/บท<input value={v.angle || ''} onChange={set('angle')} placeholder="รีวิวจริง, เด็กอนุบาล, เทียบไซส์" /></label>
        <label>โฟลเดอร์ฟุต<select value={v.folder || ''} onChange={set('folder')}><option value="">—</option>{folders.map((f) => <option key={f.key} value={f.key}>{f.key} ({f.n})</option>)}</select></label>
        <label>ใบสั่ง AI / โน้ต<textarea rows={3} value={v.note || ''} onChange={set('note')} /></label>
        <label>แคปชั่น<textarea rows={3} value={v.caption || ''} onChange={set('caption')} /></label>
        <label>แฮชแท็ก (เว้นวรรค)<input value={v.hashtags} onChange={set('hashtags')} /></label>
        <label>ลิงก์ตะกร้า (ว่าง = ใช้ตะกร้าของโฟลเดอร์ตามร้าน)<input inputMode="url" value={v.basket_url || ''} onChange={set('basket_url')} /></label>
        <label>ไฟล์ที่ตัดเสร็จ<input value={v.file || ''} onChange={set('file')} /></label>
        <label>ลิงก์วิดีโอ Google Drive (ไว้กดดูคลิปในหน้านี้)<input inputMode="url" value={v.video_url || ''} onChange={set('video_url')} /></label>
        <div className="st-acts"><button className="btn st-pri" type="submit">บันทึก</button><button className="btn" type="button" onClick={onClose}>ยกเลิก</button>
          {c.id && <button className="btn st-del" type="button" onClick={() => onDelete(c)}>ลบ</button>}</div>
      </form>
    </Modal>
  );
}

function ShootDialog({ s, folders, onClose, onSave, onDelete }) {
  const [v, setV] = useState({ ...s, shots: (s.shots || []).join('\n') });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const shots = String(v.shots || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const { updated_at, ...rest } = v;
    onSave({ ...rest, shots, got: (s.got || []).slice(0, shots.length), done: Boolean(s.done) });
  };
  return (
    <Modal title={s.id ? 'แก้งานถ่าย' : 'งานถ่ายใหม่'} onClose={onClose}>
      <form onSubmit={submit} className="st-form">
        <label>สินค้า<input required value={v.product || ''} onChange={set('product')} /></label>
        <div className="st-two"><label>ถ่ายภายใน<input type="date" value={v.due || ''} onChange={set('due')} /></label>
          <label>เก็บที่โฟลเดอร์<select value={v.folder || ''} onChange={set('folder')}><option value="">—</option>{folders.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}</select></label></div>
        <label>ช็อตที่ต้องถ่าย (บรรทัดละช็อต)<textarea rows={5} value={v.shots} onChange={set('shots')} /></label>
        <div className="st-acts"><button className="btn st-pri" type="submit">บันทึก</button><button className="btn" type="button" onClick={onClose}>ยกเลิก</button>
          {s.id && <button className="btn st-del" type="button" onClick={() => onDelete(s)}>ลบ</button>}</div>
      </form>
    </Modal>
  );
}

function FolderDialog({ f, cands, listings, onClose, onSave }) {
  const [shops, setShops] = useState(f.shops || []);
  const [baskets, setBaskets] = useState(f.baskets || {});
  const toggle = (k) => setShops(shops.includes(k) ? shops.filter((x) => x !== k) : [...shops, k]);
  const pick = (s, l) => setBaskets({ ...baskets, [s.key]: baskets[s.key]?.id === l.product_id ? undefined : { platform: s.platform, id: l.product_id } });
  return (
    <Modal title={f.sub} onClose={onClose}>
      <div className="st-muted">{f.cat} · ฟุต {f.n} คลิป</div>
      {safe(f.drive_url) && <a className="btn" href={f.drive_url} target="_blank" rel="noopener noreferrer">เปิดโฟลเดอร์ Drive</a>}
      <div className="st-lbl">ขายร้านไหนบ้าง</div>
      <div className="st-chips">{SHOPS.map((s) => <button key={s.key} type="button" className="st-chip" data-on={shops.includes(s.key) ? '1' : '0'} onClick={() => toggle(s.key)}>{s.key}</button>)}</div>
      {SHOPS.filter((s) => shops.includes(s.key)).map((s) => (
        <div key={s.key} className="st-bsk">
          <div className="st-lbl">ตะกร้า {s.key}</div>
          {s.platform ? (
            <div className="st-cands">
              {(cands[s.key] || []).map((k) => { const l = listings[k]; if (!l) return null; const on = baskets[s.key]?.id === l.product_id; return (
                <button key={k} type="button" className="st-cand" data-on={on ? '1' : '0'} onClick={() => pick(s, l)}>
                  {safe(l.thumb_url) && <img src={l.thumb_url} alt="" width={40} height={40} className="st-thumb" loading="lazy" />}
                  <span><span className="st-clamp">{l.title}</span><span className="st-muted">{l.product_id}</span></span></button>); })}
              {!(cands[s.key] || []).length && <div className="st-muted">ไม่เจอตะกร้าที่ชื่อตรงในร้าน {s.key}</div>}
            </div>
          ) : (
            <input inputMode="url" placeholder="วางลิงก์ตะกร้า" value={baskets[s.key]?.url || ''} onChange={(e) => setBaskets({ ...baskets, [s.key]: e.target.value ? { url: e.target.value } : undefined })} />
          )}
        </div>
      ))}
      <div className="st-acts"><button className="btn st-pri" type="button" onClick={() => onSave({ key: f.key, shops, baskets: Object.fromEntries(Object.entries(baskets).filter(([k, b]) => b && shops.includes(k))) })}>บันทึก</button>
        <button className="btn" type="button" onClick={onClose}>ปิด</button></div>
    </Modal>
  );
}
