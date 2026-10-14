import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const ROLES = { staff: 1, manager: 1, finance: 1 };

let auth, db;
{
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// allowlist = มีเอกสาร users/{อีเมล} ใน Firestore (role: staff|manager|finance)
async function lookup(user) {
  const email = (user.email || "").toLowerCase();
  const snap = await getDoc(doc(db, "users", email));
  if (!snap.exists()) return null;
  const d = snap.data();
  if (!ROLES[d.role]) return null;
  return { email, name: d.name || user.displayName || email, role: d.role };
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
  });
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
