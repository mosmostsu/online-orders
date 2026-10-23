import { firebaseConfig } from "./firebase-config.js";

const ROLES = { staff: "พนักงาน", manager: "ผู้จัดการ", finance: "บัญชี" };
const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
let auth = null; // โหลด auth.js (Firebase) เฉพาะตอนตั้งค่าแล้ว — CDN ล่มก็ยังขึ้นข้อความได้

const ICONS = {
  scan:  '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>',
  tag:   '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  user:  '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  box:   '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  layers:'<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/>',
  cart:  '<path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>',
  bill:  '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  lock:  '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  x:     '<path d="M6 6l12 12M18 6 6 18"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'
};
const svg = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ""}</svg>`;

/* ---- ตัดคำภาษาไทยไม่ให้ขึ้นบรรทัดกลางคำ ---- */
const KEEP = ["ซัพพลายเออร์","ออเดอร์","เช็คสต็อก","สต็อก","บาร์โค้ด","อัปโหลด","ช่องทาง","ยอดขาย","จัดซื้อ","ลูกค้า","เจ้าหนี้","ครบกำหนด","ค้างจ่าย","ประวัติ","ทันที","สินค้า","แตะเดียว","หน้าจอโฮม","แอดมิน"];
const KEEP_RE = new RegExp("(" + KEEP.join("|") + ")");
const seg = (typeof Intl !== "undefined" && Intl.Segmenter) ? new Intl.Segmenter("th", { granularity: "word" }) : null;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function thai(text) {
  if (!seg) return esc(text);
  const toks = [];
  for (const part of text.split(KEEP_RE)) {
    if (!part) continue;
    if (KEEP.includes(part)) { toks.push(part); continue; }
    for (const s of seg.segment(part)) {
      const t = s.segment;
      if (/^\s+$/.test(t)) toks.push(" ");
      else if (!s.isWordLike && toks.length && toks[toks.length - 1] !== " " && /^[,.:;)\]\/%!?]+$/.test(t)) toks[toks.length - 1] += t;
      else if (toks.length && /^[(\[~]+$/.test(toks[toks.length - 1])) toks[toks.length - 1] += t;
      else toks.push(t);
    }
  }
  return toks.map(t => t === " " ? " " : `<span class="w">${esc(t)}</span>`).join("<wbr>");
}

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* โหมดส่วนตัว: ข้าม */ } }
};

const $ = id => document.getElementById(id);
const ext = u => /^https?:/.test(u) ? ' target="_blank" rel="noopener"' : "";
const tag = a => (a.beta ? '<span class="tag">ทดลอง</span>' : "");
const inner = (a, size) => `<span class="ic">${svg(a.icon, size)}</span>
  <span class="t"><span class="name">${thai(a.name)}${tag(a)}</span><span class="desc">${thai(a.desc)}</span></span>`;
// ยังไม่มี URL = แสดงแต่กดไม่ได้ (ไม่ลิงก์ไปหน้าเปล่า)
const link = (cls, a, size) => a.url
  ? `<a class="${cls}" href="${esc(a.url)}"${ext(a.url)}>${inner(a, size)}</a>`
  : `<span class="${cls} off" aria-disabled="true">${inner(a, size)}</span>`;
const btn = a => link("btn" + (a.main ? " main" : ""), a, a.main ? 24 : 20);
const tile = a => `<li>${link("tile", a, 20)}</li>`;

const allowed = (roles, me) => !roles || roles.includes(me.role);

function renderHome(data, me) {
  $("uname").textContent = me.name;
  $("urole").textContent = " · " + ROLES[me.role];
  $("uav").textContent = [...me.name][0] || "?";
  const visible = data.sections
    .filter(s => allowed(s.roles, me))
    .map(s => ({ s, items: data.apps.filter(a => a.sec === s.id && allowed(a.roles, me)) }))
    .filter(x => x.items.length);
  const sec = ({ s, items }) => {
    const note = s.roles ? `<span class="note lock">${svg("lock", 12)}เฉพาะผู้จัดการ/บัญชี</span>` : "";
    return `<section class="sec"><div class="sec-h"><h2>${thai(s.name)}</h2>${note}</div>` +
      (s.primary ? `<div class="primary">${items.map(btn).join("")}</div>` : `<ul class="grid">${items.map(tile).join("")}</ul>`) +
      `</section>`;
  };
  let html = visible.filter(x => x.s.primary).map(sec).join("") +
    `<div class="rest">${visible.filter(x => !x.s.primary).map(sec).join("")}</div>`;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!standalone && !store.get("hideHint")) {
    html += `<div class="hint" id="hint"><span class="ic">${svg("phone")}</span>
      <span class="hint-t">${thai("เพิ่มไว้ที่หน้าจอโฮม")} <b>${thai("เปิดได้ในแตะเดียว")}</b><span class="steps" id="steps" hidden></span></span>
      <button id="how">วิธีเพิ่ม</button><button class="x" id="hx" aria-label="ปิด">${svg("x", 16)}</button></div>`;
  }
  $("main").innerHTML = html;
}

/* ---- ติดตั้งลงมือถือ ---- */
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id === "hx") { store.set("hideHint", "1"); $("hint").remove(); }
  if (t.id === "how") {
    if (installEvt) { installEvt.prompt(); installEvt = null; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const s = $("steps");
    s.textContent = ios ? "iPhone: เปิดใน Safari กดปุ่มแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”"
                        : "Android: กดเมนู ⋮ ใน Chrome แล้วเลือก “ติดตั้งแอป”";
    s.hidden = !s.hidden;
  }
});

function loginError(e) {
  const code = esc(e.code || e.message || "unknown");
  const hint = {
    "auth/popup-closed-by-user": "หน้าต่างล็อกอินปิดก่อนเสร็จ ถ้าไม่ได้ปิดเอง ให้เปิดเว็บด้วย Chrome หรือ Safari โดยตรง (ไม่ใช่ในแอป LINE/Facebook)",
    "auth/unauthorized-domain": "โดเมนนี้ยังไม่ได้เพิ่มใน Firebase → Authentication → Authorized domains",
    "auth/operation-not-allowed": "ยังไม่ได้เปิด Google ใน Firebase → Authentication → Sign-in method",
    "auth/network-request-failed": "เครือข่ายมีปัญหา ลองใหม่อีกครั้ง"
  }[e.code] || "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง";
  return `${hint}<br><small>รหัส: ${code}</small>`;
}

/* ---- หน้าจอสถานะ (ล็อกอิน/ไม่มีสิทธิ์/ยังไม่ตั้งค่า) ---- */
function gate(msg, withLogin) {
  $("uname").textContent = ""; $("urole").textContent = ""; $("uav").textContent = "";
  $("uav").hidden = true;
  $("main").innerHTML = `<div class="gate"><p>${msg}</p>${withLogin ? '<button class="go" id="login">เข้าสู่ระบบด้วย Google</button>' : ""}</div>`;
  const b = $("login");
  if (b) b.onclick = async () => {
    b.disabled = true;
    try { await auth.login(); } catch (e) { b.disabled = false; gate(loginError(e), true); }
  };
}

/* ---- จำหน้าล่าสุดไว้ในเครื่อง: เปิดครั้งต่อไปวาดทันที แล้วค่อยเช็คสิทธิ์กับ Firebase ตามหลัง ---- */
const LAST = "lastHome";
const readLast = () => { try { return JSON.parse(store.get(LAST)) || null; } catch { return null; } };
const forget = () => { try { localStorage.removeItem(LAST); } catch { /* ข้าม */ } };

async function main() {
  // เริ่มโหลด apps.json กับระบบล็อกอินพร้อมกัน ไม่ต้องรอกันทีละไฟล์
  const dataP = fetch("apps.json", { cache: "no-cache" }).then(r => r.json());
  const authP = configured ? import("./auth.js") : null;
  dataP.catch(() => {}); authP?.catch(() => {});

  const last = configured ? readLast() : null;
  let shown = "";
  const show = (data, me) => {
    const key = JSON.stringify([data, me]);
    if (key === shown) return; // ข้อมูลเดิม ไม่วาดซ้ำ (กันกล่องวิธีเพิ่มที่เปิดอยู่หาย)
    shown = key;
    $("uav").hidden = false;
    renderHome(data, me);
  };
  if (last) show(last.data, last.me);

  let data;
  try {
    data = await dataP;
  } catch {
    if (!last) return gate("โหลดรายการแอปไม่ได้ ลองรีเฟรชอีกครั้ง", false);
    data = last.data;
  }

  if (!configured) {
    // ยังไม่ใส่ Firebase config: ดูตัวอย่างได้เฉพาะเครื่องตัวเอง ห้ามขึ้นเว็บจริงโดยไม่มีล็อกอิน
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      const staff = new URLSearchParams(location.search).get("role") === "staff";
      return show(data, staff ? { name: "แนน", role: "staff" } : { name: "มอส", role: "manager" });
    }
    return gate("ยังไม่ได้ตั้งค่า Firebase (ดู firebase-config.js)", false);
  }
  try { auth = await authP; }
  catch { if (!last) gate("โหลดระบบล็อกอินไม่ได้ ตรวจอินเทอร์เน็ตแล้วรีเฟรช", false); return; }
  $("uav").onclick = () => { if (confirm("ออกจากระบบ?")) { forget(); auth.logout(); } };
  auth.watch(r => {
    if (r.user) { store.set(LAST, JSON.stringify({ data, me: r.user })); return show(data, r.user); }
    if (r.error && last) return; // เน็ตสะดุดตอนเช็คสิทธิ์: คงหน้าที่จำไว้
    forget(); shown = "";
    if (r.denied) gate(`อีเมล ${esc(r.denied)} ยังไม่ได้รับสิทธิ์ ติดต่อผู้จัดการเพื่อเพิ่มอีเมล`, true);
    else if (r.error) gate("ตรวจสอบสิทธิ์ไม่สำเร็จ ลองใหม่อีกครั้ง", true);
    else gate("เข้าสู่ระบบด้วยอีเมล Google ที่ได้รับสิทธิ์", true);
  });
}
main();

if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
