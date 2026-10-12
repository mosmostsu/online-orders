# สร้าง lib/thaimartTemplates.js จากไฟล์เทมเพลตนำเข้าสินค้าที่ดาวน์โหลดจาก seller.thaimart.com (ทีละหมวด)
# รัน: python scripts/make_thaimart_templates.py <ไฟล์หมวดรองเท้า/เสื้อผ้า.xlsx> <ไฟล์หมวดลูกฟุตบอล/ถุงเท้า/อุปกรณ์.xlsx>
# ชื่อเส้นทางหมวด (path) อ่านจากช่อง A4 ของเทมเพลต (บรรทัดแรก) — ต้องตรงกับที่ Thaimart คาดในคอลัมน์ A
import base64, json, os, re, sys, zipfile, xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
KEYS = ['shoes', 'balls']
LABELS = {'shoes': 'รองเท้ากีฬา / เสื้อผ้ากีฬา', 'balls': 'ลูกฟุตบอล / ถุงเท้ากีฬา / อุปกรณ์กีฬา'}


def category_path(path):
    z = zipfile.ZipFile(path)
    ss = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m']))
          for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for c in root.iter('{%s}c' % NS['m']):
        if c.get('r') == 'A4':
            return ss[int(c.find('m:v', NS).text)].split('\n')[0].strip()
    raise SystemExit(f'ไม่พบ A4 ใน {path}')


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__ or 'ต้องระบุไฟล์ 2 ไฟล์')
    out = ["// เทมเพลตนำเข้าสินค้าของ Thaimart (seller.thaimart.com → นำเข้าสินค้า) ตามหมวด — เก็บไฟล์จริงที่ดาวน์โหลดมาเป็น base64",
           "// สร้างด้วย scripts/make_thaimart_templates.py (อย่าแก้มือ) · คอลัมน์ A–X เหมือนกันทุกหมวด ข้อมูลเริ่มแถว 5",
           "// หมวดอื่น (ออกกำลังกาย/ฟิตเนส, ตกปลา) ยังไม่มีเทมเพลต — โหลดจาก Thaimart แล้วรันสคริปต์ใหม่", "export const TEMPLATES = {"]
    for key, f in zip(KEYS, sys.argv[1:]):
        b = base64.b64encode(open(f, 'rb').read()).decode()
        out.append(f"  {key}: {{\n    label: {json.dumps(LABELS[key], ensure_ascii=False)},\n"
                   f"    path: {json.dumps(category_path(f), ensure_ascii=False)},\n    b64: '{b}',\n  }},")
    out.append('};')
    dst = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lib', 'thaimartTemplates.js')
    open(dst, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print('เขียน', dst)


if __name__ == '__main__':
    main()
