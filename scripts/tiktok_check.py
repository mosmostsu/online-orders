# ทดสอบว่าคุยกับ TikTok ได้จริงไหม — ไม่แตะ DB ไม่ refresh โทเคน
# รัน: python scripts/tiktok_check.py [จำนวนวันย้อนหลัง]
import hashlib, hmac, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
    if m:
        ENV[m.group(1)] = m.group(2)

APP_KEY = ENV["TIKTOK_APP_KEY"]
APP_SECRET = ENV["TIKTOK_APP_SECRET"]
TOKEN = ENV["TIKTOK_ACCESS_TOKEN"]
BASE = ENV.get("TIKTOK_API_BASE", "https://open-api.tiktokglobalshop.com")

# สถานะของ TikTok -> สถานะกลางของเรา (ต้องตรงกับ lib/status.js)
STATUS = {
    "UNPAID": "รอชำระเงิน", "ON_HOLD": "รอชำระเงิน",
    "AWAITING_SHIPMENT": "รอจัดส่ง", "PARTIALLY_SHIPPING": "รอจัดส่ง",
    "AWAITING_COLLECTION": "แพ็คแล้ว รอขนส่งรับ",
    "IN_TRANSIT": "จัดส่งแล้ว", "DELIVERED": "ถึงมือลูกค้า",
    "COMPLETED": "สำเร็จ", "CANCELLED": "ยกเลิก",
}


def sign(path, query, body_str):
    keys = sorted(k for k in query if k not in ("sign", "access_token"))
    s = path + "".join("%s%s" % (k, query[k]) for k in keys) + (body_str or "")
    s = APP_SECRET + s + APP_SECRET
    return hmac.new(APP_SECRET.encode(), s.encode(), hashlib.sha256).hexdigest()


def call(path, query=None, body=None, method="GET"):
    q = dict(query or {})
    q["app_key"] = APP_KEY
    q["timestamp"] = str(int(time.time()))
    body_str = json.dumps(body, ensure_ascii=False, separators=(",", ":")) if body is not None else ""
    q["sign"] = sign(path, q, body_str)

    url = BASE + path + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(
        url,
        data=body_str.encode("utf-8") if body_str else None,
        method=method,
        headers={"content-type": "application/json", "x-tts-access-token": TOKEN},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read())
    if res.get("code") != 0:
        raise SystemExit("%s ล้มเหลว: code=%s %s" % (path, res.get("code"), res.get("message")))
    return res.get("data") or {}


days = int(sys.argv[1]) if len(sys.argv) > 1 else 7

shops = call("/authorization/202309/shops", {"version": "202309"}).get("shops", [])
print("ร้านที่เข้าถึงได้:", ", ".join("%s (%s)" % (s.get("name"), s.get("id")) for s in shops) or "(ไม่มี)")
if not shops:
    raise SystemExit("โทเคนใช้ได้แต่ไม่เห็นร้าน — ยังไม่ได้ผูกร้านกับแอปนี้")

shop = shops[0]
cipher = shop["cipher"]
print("ใช้ร้าน:", shop.get("name"))

# ขั้นที่ 1 — search ได้มาแค่ order id
since = int(time.time()) - days * 86400
ids, page_token = [], None
while True:
    q = {"page_size": "50", "sort_field": "create_time", "sort_order": "DESC", "shop_cipher": cipher}
    if page_token:
        q["page_token"] = page_token
    data = call("/order/202309/orders/search", q, {"update_time_ge": since}, "POST")
    for o in data.get("orders") or []:
        oid = o.get("id") or o.get("order_id")
        if oid:
            ids.append(str(oid))
    page_token = data.get("next_page_token")
    if not page_token:
        break

print("\nเจอ %d ออเดอร์ (ย้อนหลัง %d วัน)" % (len(ids), days))
if not ids:
    raise SystemExit(0)

# ขั้นที่ 2 — ดึงรายละเอียดทีละ 50
by_status, to_ship_sku = Counter(), Counter()
for i in range(0, len(ids), 50):
    data = call("/order/202507/orders", {"ids": ",".join(ids[i:i + 50]), "shop_cipher": cipher})
    for o in data.get("orders") or []:
        st = o.get("status")
        by_status[st] += 1
        if st in ("AWAITING_SHIPMENT", "AWAITING_COLLECTION", "PARTIALLY_SHIPPING"):
            for li in o.get("line_items") or []:
                if li.get("seller_sku"):
                    to_ship_sku[li["seller_sku"]] += 1

print("\nแยกตามสถานะ:")
for st, n in by_status.most_common():
    print("  %-22s %s" % (STATUS.get(st, st), n))

print("\nรอจัดส่ง (ของที่ต้องหยิบ): %d SKU · %d ชิ้น" % (len(to_ship_sku), sum(to_ship_sku.values())))
for sku, qty in to_ship_sku.most_common(15):
    print("  %-26s %s" % (sku, qty))
