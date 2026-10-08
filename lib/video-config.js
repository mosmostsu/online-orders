// แบรนด์/หมวดของคลิปวิดีโอ — จับจากคำบรรยายด้วย keyword (ชีทไม่มีคอลัมน์แบรนด์/รหัสสินค้า)
// แก้ mapping ที่ไฟล์นี้ไฟล์เดียว: เพิ่ม/ลบ keyword ได้เลย ไม่ต้องแตะที่อื่น
//
// กติกา: ไม่แยกตัวพิมพ์เล็กใหญ่ · keyword ภาษาอังกฤษ/ตัวเลขต้องเป็น "คำเต็ม" (pan ไม่ตรงกับ Japan/span)
// ไทยจับแบบมีคำนี้อยู่ในข้อความ · ไม่ตรงอะไรเลย = "อื่นๆ" (ห้ามเดาเกินหลักฐาน)
// เรียงตามลำดับในรายการ — ตัวแรกที่ตรงชนะ (หมวดที่เจาะจงกว่าอยู่ก่อน เช่น ลูกบอล ก่อน สตั๊ด/ฟุตซอล)

export const OTHER = 'อื่นๆ';

export const BRANDS = [
  { name: 'Grandsport', keys: ['grandsport', 'grand sport', 'แกรนด์สปอร์ต', 'แกรนด์ สปอร์ต'] },
  { name: 'FBT', keys: ['fbt'] },
  { name: 'Flyhawk', keys: ['flyhawk', 'fly hawk', 'ฟลายฮอค', 'ฟลายฮอว์ค'] },
  { name: 'Warrix', keys: ['warrix', 'วอริกซ์', 'วอร์ริกซ์'] },
  { name: 'Pan', keys: ['pan', 'แพน'] },
  { name: 'Wingz', keys: ['wingz'] },
  { name: 'Zeta', keys: ['zeta'] },
  { name: 'Mizuno', keys: ['mizuno', 'มิซูโน่', 'มิซูโนะ'] },
  { name: 'Eepro', keys: ['eepro'] },
  { name: 'H3', keys: ['h3'] },
  { name: 'Breaker', keys: ['breaker', 'เบรกเกอร์', 'เบรคเกอร์'] },
  { name: 'Molten', keys: ['molten'] },
  { name: 'Butterfly', keys: ['butterfly'] },
  { name: 'Pegan', keys: ['pegan', 'พีแกน'] },
  { name: 'Imane', keys: ['imane'] },
  { name: 'Cadenza', keys: ['cadenza'] },
  { name: 'EGO Sport', keys: ['ego sport', 'egosport', 'ego'] },
  { name: 'BCS', keys: ['bcs'] },
  { name: 'Popteen', keys: ['popteen', 'ป๊อปทีน', 'ป็อปทีน'] },
  { name: 'Catcha', keys: ['catcha', 'แคทช่า'] },
];

export const CATEGORIES = [
  { name: 'ลูกบอล', keys: ['ลูกบอล', 'ลูกฟุตบอล', 'ลูกฟุตซอล', 'ลูกวอลเลย์', 'ลูกบาส', 'ลูกตะกร้อ'] },
  { name: 'ถุงมือผู้รักษาประตู', keys: ['ถุงมือ', 'ผู้รักษาประตู', 'โกล์', 'โกล'] },
  { name: 'ไม้แบด/ปิงปอง', keys: ['ไม้แบด', 'แบดมินตัน', 'ปิงปอง', 'ไม้ปิงปอง'] },
  { name: 'รองเท้านักเรียน', keys: ['รองเท้านักเรียน', 'ผ้าใบนักเรียน', 'นักเรียน'] },
  { name: 'รองเท้าวิ่ง', keys: ['รองเท้าวิ่ง', 'วิ่ง'] },
  { name: 'สตั๊ด/ฟุตซอล/ร้อยปุ่ม', keys: ['สตั๊ด', 'สตั้ด', 'ฟุตซอล', 'ร้อยปุ่ม', 'ปุ่มร้อย'] },
  { name: 'กางเกงวอร์ม/ผ้าร่ม', keys: ['กางเกงวอร์ม', 'ผ้าร่ม', 'ขายาว'] },
  { name: 'กางเกงกีฬาขาสั้น', keys: ['ขาสั้น', 'กางเกงกีฬา', 'กางเกงฟุตบอล'] },
  { name: 'เสื้อโปโล', keys: ['เสื้อโปโล', 'โปโล', 'polo'] },
  { name: 'เสื้อวอร์ม/แจ็คเก็ต', keys: ['เสื้อวอร์ม', 'แจ็คเก็ต', 'แจ็กเก็ต', 'เสื้อกันหนาว', 'jacket'] },
];

const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// คอมไพล์ keyword ครั้งเดียวตอนโหลดโมดูล
function compile(list) {
  return list.map((it) => ({
    name: it.name,
    tests: it.keys.map((k) => {
      const key = k.toLowerCase();
      return isAscii(key)
        ? { re: new RegExp(`(?<![a-z0-9])${esc(key)}(?![a-z0-9])`) }
        : { sub: key };
    }),
  }));
}
const BRANDS_C = compile(BRANDS);
const CATS_C = compile(CATEGORIES);

function pick(compiled, text) {
  const t = String(text || '').toLowerCase();
  for (const it of compiled) {
    if (it.tests.some((x) => (x.re ? x.re.test(t) : t.includes(x.sub)))) return it.name;
  }
  return OTHER;
}

export const brandOf = (caption) => pick(BRANDS_C, caption);
export const categoryOf = (caption) => pick(CATS_C, caption);
