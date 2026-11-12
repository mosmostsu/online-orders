import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const ROLES = { staff: 1, manager: 1, finance: 1 };
const auth = getAuth(initializeApp(firebaseConfig));

// รอได้ไม่เกิน ms แล้วโยน error — กันหน้าค้างเงียบเมื่อเน็ต/Firebase ไม่ตอบ
export const within = (p, ms, what) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(what + " timeout"), { code: "timeout" })), ms))
]);

// allowlist = มีเอกสาร users/{อีเมล} ใน Firestore (role: staff|manager|finance)
// อ่านผ่าน REST ตรงๆ แทน Firestore SDK: SDK ใช้ช่องทาง WebChannel ที่ค้างได้นานบนเน็ตมือถือบางเจ้า และไฟล์ใหญ่โหลดช้า
async function lookup(user) {
  const email = (user.email || "").toLowerCase();
  const token = await within(user.getIdToken(), 10000, "token");
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  let res;
  try { res = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: ctl.signal, cache: "no-store" }); }
  finally { clearTimeout(t); }
  if (res.status === 404 || res.status === 403) return null; // ไม่มีเอกสาร/ไม่มีสิทธิ์อ่าน = ไม่อยู่ใน allowlist
  if (!res.ok) throw new Error("firestore " + res.status);
  const f = (await res.json()).fields || {};
  const role = f.role?.stringValue;
  if (!ROLES[role]) return null;
  return { email, name: f.name?.stringValue || user.displayName || email, role };
}

// cb({user}) เข้าได้ | cb({denied:email}) ไม่อยู่ใน allowlist | cb({}) ยังไม่ล็อกอิน | cb({error})
export function watch(cb) {
  let denied = null; // จำอีเมลที่ถูกปฏิเสธ ไม่ให้การ signOut ตามมาเขียนทับข้อความ
  onAuthStateChanged(auth, async u => {
    if (!u) return cb(denied ? { denied } : {});
    denied = null;
    try {
      const me = await lookup(u);
      if (me) return cb({ user: me });
      denied = u.email;
      cb({ denied });
      await signOut(auth);
    } catch (e) {
      cb({ error: e });
    }
  }, e => cb({ error: e }));
}

export async function login() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, p);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await signInWithRedirect(auth, p);
    else if (e.code !== "auth/cancelled-popup-request") throw e;
  }
}

export const logout = () => signOut(auth);
