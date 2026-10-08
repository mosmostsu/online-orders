// วิดีโอ — ลงคลิป TikTok วันไหน เป็นคลิปอะไร (TikTok Display API + ชีทเสริม ไม่แก้ชีท) · ดู lib/video.js
// ตัวกรอง/หน้า/ปฏิทินทั้งหมดอยู่ใน URL (เหมือนหน้า /summary) ไม่ต้องใช้ JavaScript ฝั่งเบราว์เซอร์
import Link from 'next/link';
import { getVideos, TABS } from '@/lib/video';
import { BRANDS, CATEGORIES, OTHER } from '@/lib/video-config';
import Nav from '../Nav';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const GAP_DAYS = 7;
const WEEKS_SHOWN = 12;
const GAPS_SHOWN = 10;
const SHORT = 80;
const DAY_MS = 86400000;
const ACCT = { solid: 'solid_sports_', meta: 'meta_sports_' };
const ACCT_LABEL = { all: 'ทั้งหมด', solid: 'Solid', meta: 'Meta' };
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const num = (n) => Number(n || 0).toLocaleString('en-US');
const numOrDash = (n) => (n === null || n === undefined ? '—' : num(n));
const pad = (n) => String(n).padStart(2, '0');
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
// แสดงวันที่ค.ศ. ตามชีท (วันที่ต้องตรงกับชีท)
const show = (d) => { const [y, m, dd] = d.split('-'); return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`; };
const monday = (d) => { const ms = toMs(d); return toDate(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS); };
const shortAcct = (a) => (a === ACCT.solid ? 'Solid' : 'Meta');

function today() {
  // เวลาไทย (UTC+7)
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function weeklyCounts(videos, now) {
  const counts = new Map();
  for (const v of videos) { const w = monday(v.uploadedDate); counts.set(w, (counts.get(w) || 0) + 1); }
  const out = [];
  let w = toMs(monday(now));
  for (let i = 0; i < WEEKS_SHOWN; i++, w -= 7 * DAY_MS) out.push({ week: toDate(w), n: counts.get(toDate(w)) || 0 });
  return out;
}

// ช่วงที่ไม่มีคลิปติดกันเกิน 7 วัน (นับวันว่างระหว่างคลิป) รวมช่วงจากคลิปล่าสุดถึงวันนี้
function gapsOf(videos, now) {
  const days = [...new Set(videos.map((v) => v.uploadedDate))].sort();
  const gaps = [];
  for (let i = 1; i < days.length; i++) {
    const empty = (toMs(days[i]) - toMs(days[i - 1])) / DAY_MS - 1;
    if (empty > GAP_DAYS) gaps.push({ from: toDate(toMs(days[i - 1]) + DAY_MS), to: toDate(toMs(days[i]) - DAY_MS), days: empty });
  }
  if (days.length) {
    const last = days[days.length - 1];
    const empty = (toMs(now) - toMs(last)) / DAY_MS;
    if (empty > GAP_DAYS) gaps.push({ from: toDate(toMs(last) + DAY_MS), to: now, days: empty, open: true });
  }
  return gaps.reverse();
}

function Caption({ text }) {
  if (!text) return <span className="sku">—</span>;
  const flat = text.replace(/\s+/g, ' ');
  if (text.length <= SHORT && !text.includes('\n')) return <span>{text}</span>;
  return (
    <details className="vcap">
      <summary>{flat.slice(0, SHORT)}…</summary>
      <div className="vfull">{text}</div>
    </details>
  );
}

function Status({ v }) {
  if (!v) return <span className="sku">—</span>;
  const tone = v === 'ลงแล้ว' ? 'ok' : v === 'โหลดไม่ได้' ? 'err' : v === 'โพสต์' ? 'hot' : 'dim';
  return <span className={'badge ' + tone}>{v}</span>;
}

export default async function VideoPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const now = today();
  const acct = ACCT[sp.acct] ? sp.acct : 'all';
  const from = isDate(sp.from) ? sp.from : '';
  const to = isDate(sp.to) ? sp.to : '';
  const brand = String(sp.brand || '');
  const cat = String(sp.cat || '');
  const q = String(sp.q || '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const day = isDate(sp.day) ? sp.day : '';
  const month = isMonth(sp.m) ? sp.m : (day || now).slice(0, 7);

  let err = null, data = null;
  try { data = await getVideos(); } catch (e) { err = String(e.message || e); }

  const qs = (o) => {
    const p = new URLSearchParams();
    const v = { acct, from, to, brand, cat, q, page, day, m: month, ...o };
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '') continue;
      if ((k === 'acct' && x === 'all') || (k === 'page' && Number(x) === 1)) continue;
      if (k === 'm' && x === now.slice(0, 7)) continue;
      p.set(k, String(x));
    }
    const s = p.toString();
    return s ? `/video?${s}` : '/video';
  };

  if (err) {
    return (
      <>
        <Nav active="video" />
        <div className="row"><div><h1>วิดีโอ</h1><div className="sub">คลิป TikTok ที่ลงแล้ว</div></div></div>
        <div className="note"><b>ดึงข้อมูลคลิปไม่ได้</b><br />{err}</div>
      </>
    );
  }

  const byAcct = data.videos.filter((v) => acct === 'all' || v.account === ACCT[acct]);
  const needle = q.toLowerCase();
  const filtered = byAcct.filter((v) =>
    (!from || v.uploadedDate >= from) && (!to || v.uploadedDate <= to) &&
    (!brand || v.brand === brand) && (!cat || v.category === cat) &&
    (!needle || v.caption.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const weeks = weeklyCounts(byAcct, now);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.n));
  const gaps = gapsOf(byAcct, now);

  // ปฏิทินรายเดือน (ใช้ byAcct คือเคารพตัวกรองช่องอย่างเดียว ไม่ซ่อนวันด้วยตัวกรองอื่น)
  const perDay = new Map();
  for (const v of byAcct) {
    if (!v.uploadedDate.startsWith(month)) continue;
    const e = perDay.get(v.uploadedDate) || { solid: 0, meta: 0 };
    e[v.account === ACCT.solid ? 'solid' : 'meta']++;
    perDay.set(v.uploadedDate, e);
  }
  const [my, mm] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(my, mm - 1, 1)).getUTCDay(); // วันอาทิตย์เริ่มต้น
  const dim = new Date(Date.UTC(my, mm, 0)).getUTCDate();
  const prevM = mm === 1 ? `${my - 1}-12` : `${my}-${pad(mm - 1)}`;
  const nextM = mm === 12 ? `${my + 1}-01` : `${my}-${pad(mm + 1)}`;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  const dayVideos = day ? byAcct.filter((v) => v.uploadedDate === day) : [];

  const brandOpts = [...BRANDS.map((b) => b.name), OTHER];
  const catOpts = [...CATEGORIES.map((c) => c.name), OTHER];
  const lastDate = data.videos[0]?.uploadedDate;
  const filtersOn = from || to || brand || cat || q;

  return (
    <>
      <Nav active="video" />

      <div className="row">
        <div>
          <h1>วิดีโอ</h1>
          <div className="sub">
            คลิป TikTok ที่ลงแล้ว · {num(data.videos.length)} คลิป{lastDate ? ` · ล่าสุด ${show(lastDate)}` : ''}
            {data.updated.map((u) => u.at && ` · ${shortAcct(u.account)} ชีทอัปเดต ${u.at}`)}
          </div>
        </div>
      </div>

      {data.warnings?.length > 0 && (
        <div className="note">{data.warnings.map((w) => <div key={w}>{w}</div>)}</div>
      )}

      <div className="chans">
        {Object.keys(ACCT_LABEL).map((k) => (
          <Link prefetch={false} key={k} className="chan" data-plat="tiktok" data-on={acct === k ? '1' : '0'}
            href={qs({ acct: k, page: 1 })}>
            TikTok <b>{ACCT_LABEL[k]}</b>
            {k !== 'all' && <span> @{ACCT[k]}</span>}
          </Link>
        ))}
      </div>

      <div className="mcards">
        <div className="mcard hero"><span className="mlabel">คลิปทั้งหมด</span><b>{num(byAcct.length)}</b></div>
        <div className="mcard"><span className="mlabel">30 วันที่ผ่านมา</span>
          <b>{num(byAcct.filter((v) => v.uploadedDate > toDate(toMs(now) - 30 * DAY_MS)).length)}</b></div>
        <div className="mcard"><span className="mlabel">ช่วงว่าง &gt; {GAP_DAYS} วัน</span><b className={gaps.length ? 'danger' : ''}>{num(gaps.length)}</b></div>
        {data.sheetOn && <div className="mcard"><span className="mlabel">ข้าม (ไม่มีวันที่)</span><b>{num(data.skipped)}</b></div>}
      </div>

      <div className="vgrid">
        <div className="pcard">
          <h2 className="vh">คลิปต่อสัปดาห์ ({WEEKS_SHOWN} สัปดาห์ล่าสุด)</h2>
          <div className="vweeks">
            {weeks.map((w) => (
              <div key={w.week} className="vweek">
                <span className="sku">{show(w.week).replace(/ \d{4}$/, '')}</span>
                <span className="vbar"><i style={{ width: `${(w.n / maxWeek) * 100}%` }} data-zero={w.n ? '0' : '1'} /></span>
                <b>{w.n}</b>
              </div>
            ))}
          </div>
          <h2 className="vh" style={{ marginTop: 14 }}>ช่วงที่ไม่มีคลิปติดกันเกิน {GAP_DAYS} วัน</h2>
          {gaps.length === 0 ? <div className="sub">ไม่มี</div> : (
            <ul className="vgaps">
              {gaps.slice(0, GAPS_SHOWN).map((g) => (
                <li key={g.from}>{show(g.from)} – {show(g.to)} <span className="sku">· {num(g.days)} วัน{g.open ? ' (ถึงวันนี้)' : ''}</span></li>
              ))}
              {gaps.length > GAPS_SHOWN && <li className="sku">…และอีก {gaps.length - GAPS_SHOWN} ช่วงที่เก่ากว่า</li>}
            </ul>
          )}
          <div className="sub" style={{ marginTop: 8, marginBottom: 0 }}>แสดงเฉยๆ — อาจเป็นช่วงไม่ได้ลง หรือยังไม่ได้บันทึกลงชีท</div>
        </div>

        <div className="pcard">
          <div className="vcalhead">
            <Link prefetch={false} className="pgbtn" href={qs({ m: prevM })}>‹</Link>
            <b>{MONTHS[mm - 1]} {my}</b>
            <Link prefetch={false} className="pgbtn" href={qs({ m: nextM })}>›</Link>
          </div>
          <div className="vcal">
            {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => <span key={d} className="vdow">{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const ds = `${month}-${pad(d)}`;
              const e = perDay.get(ds);
              return (
                <Link prefetch={false} key={ds} className="vday" data-has={e ? '1' : '0'} data-on={day === ds ? '1' : '0'}
                  href={qs({ day: day === ds ? '' : ds })}>
                  {d}
                  {e && <span className="vdots">{e.solid > 0 && <i data-a="solid" />}{e.meta > 0 && <i data-a="meta" />}</span>}
                </Link>
              );
            })}
          </div>
          <div className="sub" style={{ marginTop: 8, marginBottom: 0 }}><i className="vdot" data-a="solid" /> Solid &nbsp; <i className="vdot" data-a="meta" /> Meta</div>
        </div>
      </div>

      {day && (
        <div className="pcard" style={{ marginBottom: 14 }}>
          <h2 className="vh">{show(day)} · {dayVideos.length} คลิป</h2>
          {dayVideos.length === 0 ? <div className="sub" style={{ marginBottom: 0 }}>วันนี้ไม่มีคลิป</div> : (
            ['solid', 'meta'].filter((k) => acct === 'all' || acct === k).map((k) => {
              const list = dayVideos.filter((v) => v.account === ACCT[k]);
              return list.length > 0 && (
                <div key={k} className="vdaygrp">
                  <div className="sku">@{ACCT[k]} · {list.length} คลิป</div>
                  {list.map((v) => (
                    <div key={v.videoId} className="vdayrow">
                      <div><Caption text={v.caption} /></div>
                      <div className="vmeta">
                        <span className="badge dim">{v.brand}</span> <span className="badge dim">{v.category}</span>{' '}
                        <a className="link" href={v.link} target="_blank" rel="noopener noreferrer">เปิดคลิป ↗</a>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="pcard">
        <form className="vfilters" action="/video" method="get">
          {acct !== 'all' && <input type="hidden" name="acct" value={acct} />}
          {day && <input type="hidden" name="day" value={day} />}
          {month !== now.slice(0, 7) && <input type="hidden" name="m" value={month} />}
          <label>ตั้งแต่<input type="date" name="from" defaultValue={from} /></label>
          <label>ถึง<input type="date" name="to" defaultValue={to} /></label>
          <label>แบรนด์
            <select name="brand" defaultValue={brand}>
              <option value="">ทั้งหมด</option>
              {brandOpts.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label>หมวด
            <select name="cat" defaultValue={cat}>
              <option value="">ทั้งหมด</option>
              {catOpts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="vq">ค้นหาคำบรรยาย
            <input name="q" defaultValue={q} placeholder="คำที่อยู่ในคำบรรยาย" autoComplete="off" inputMode="search" />
          </label>
          <button className="btn" type="submit">กรอง</button>
          {filtersOn && <Link prefetch={false} className="link" href={qs({ from: '', to: '', brand: '', cat: '', q: '', page: 1 })}>ล้างตัวกรอง</Link>}
        </form>

        <div className="sub" style={{ margin: '10px 0' }}>เจอ {num(filtered.length)} คลิป · เรียงใหม่สุดก่อน</div>

        {rows.length === 0 ? (
          <div className="note">ไม่มีคลิปที่ตรงกับตัวกรอง</div>
        ) : (
          <div className="vtablewrap">
            <table className="vtable">
              <thead>
                <tr><th>วันที่ลง</th><th>ช่อง</th><th>แบรนด์</th><th>หมวด</th><th>คำบรรยาย</th><th>คลิป</th>{data.hasMetrics && <><th>วิว</th><th>ไลก์</th></>}<th>IG</th><th>FB</th></tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={`${v.account}:${v.videoId}`}>
                    <td className="mono">{v.uploadedDate}</td>
                    <td>{shortAcct(v.account)}</td>
                    <td>{v.brand === OTHER ? <span className="sku">{OTHER}</span> : v.brand}</td>
                    <td>{v.category === OTHER ? <span className="sku">{OTHER}</span> : v.category}</td>
                    <td className="vcapcell"><Caption text={v.caption} /></td>
                    <td><a className="link" href={v.link} target="_blank" rel="noopener noreferrer">เปิด ↗</a></td>
                    {data.hasMetrics && <><td className="num">{numOrDash(v.metrics?.views)}</td><td className="num">{numOrDash(v.metrics?.likes)}</td></>}
                    <td><Status v={v.statusIG} /></td>
                    <td><Status v={v.statusFB} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="ppager">
            <Link prefetch={false} className="pgbtn" data-off={cur <= 1 ? '1' : '0'} href={qs({ page: Math.max(1, cur - 1) })}>‹</Link>
            <span><b>{cur}</b> / {pages}</span>
            <Link prefetch={false} className="pgbtn" data-off={cur >= pages ? '1' : '0'} href={qs({ page: Math.min(pages, cur + 1) })}>›</Link>
          </div>
        )}
      </div>
    </>
  );
}
