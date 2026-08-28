// แยกว่าออเดอร์นี้ส่งแบบด่วนหรือส่งปกติ
//
// ส่งด่วน = คนขับมารับภายในไม่กี่สิบนาที (Shopee Instant/Express, Lalamove, Grab, ส่งภายในวัน)
// ต่างจากส่งปกติที่รอรถมารับรอบเย็น
// เรื่องนี้สำคัญกับงานตามของ เพราะใบด่วนที่ถูกยกเลิกมีเวลาให้วิ่งไปดึงแค่ไม่กี่นาที
//
// ดูจากชื่อขนส่งเป็นหลัก เพราะทุกเจ้าส่งชื่อมาให้อยู่แล้ว ไม่ต้องยิง API เพิ่ม
const EXPRESS_WORDS = [
  'instant', 'express delivery', 'same day', 'sameday', 'ส่งด่วน', 'ด่วนภายในวัน',
  'lalamove', 'grab', 'robinhood', 'line man', 'lineman', 'bolt',
  '4h', '3h', '2h', 'within day', 'quick',
];

// ชื่อพวกนี้มีคำว่า express ก็จริงแต่เป็นขนส่งธรรมดา ไม่ใช่ส่งด่วนภายในวัน
const NOT_EXPRESS = ['flash express', 'j&t express', 'kerry express', 'ninja', 'best express', 'spx express', 'shopee express standard'];

export function isExpressShipping(carrier, option) {
  const t = `${carrier || ''} ${option || ''}`.toLowerCase().trim();
  if (!t) return false;
  if (NOT_EXPRESS.some((w) => t.includes(w))) return false;
  return EXPRESS_WORDS.some((w) => t.includes(w));
}
