# เช็คว่าคุยกับ Shopee ได้จริงไหม — ไม่แตะ DB ไม่ต่ออายุโทเคน
# รัน: python scripts/shopee_check.py [จำนวนวันย้อนหลัง]
import hashlib, hmac, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
    if m:
        ENV[m.group(1)] = m.group(2)

PID = ENV["SHOPEE_PARTNER_ID"]
KEY = ENV["SHOPEE_PARTNER_KEY"]
BASE = ENV.get("SHOPEE_API_BASE", "https://partner.shopeemobile.com")
SHOP_ID = ENV.get("SHOPEE_TEST_SHOP_ID") or sys.argv[2] if len(sys.argv) > 2 else ENV.get("SHOPEE_TEST_SHOP_ID", "")
TOKEN = ENV.get("SHOPEE_TEST_ACCESS_TOKEN", "")

STATUS = {
    "UNPAID": "รอชำระเงิน", "READY_TO_SHIP": "รอจัดส่ง", "PROCESSED": "แพ็คแล้ว รอขนส่งรับ",
    "RETRY_SHIP": "แพ็คแล้ว รอขนส่งรับ", "SHIPPED": "จัดส่งแล้ว", "TO_CONFIRM_RECEIVE": "จัดส่งแล้ว",
    "COMPLETED": "สำเร็จ", "CANCELLED": "ยกเลิก", "IN_CANCEL": "ยกเลิก", "TO_RETURN": "ยกเลิก",
}


def call(path, params=None):
    ts = str(int(time.time()))
    base_str = PID + path + ts + TOKEN + str(SHOP_ID)
    sign = hmac.new(KEY.encode(), base_str.encode(), hashlib.sha256).hexdigest()
    q = {"partner_id": PID, "timestamp": ts, "access_token": TOKEN, "shop_id": str(SHOP_ID), "sign": sign}
    q.update(params or {})
    url = BASE + path + "?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit("%s ล้มเหลว: HTTP %s %s" % (path, e.code, e.read()[:300].decode()))
    if res.get("error"):
        raise SystemExit("%s ล้มเหลว: %s %s" % (path, res["error"], res.get("message")))
    return res.get("response") or {}


days = float(sys.argv[1]) if len(sys.argv) > 1 else 3
now = int(time.time())
print("ปลายทาง:", BASE)
print("ร้าน:", SHOP_ID, "\n")

# ขั้นที่ 1 — เอาเลขออเดอร์ (ไม่ระบุสถานะ = ได้ทุกสถานะรอบเดียว)
sns, cursor = [], ""
while True:
    p = {
        "time_range_field": "update_time",
        "time_from": now - int(days * 86400),
        "time_to": now,
        "page_size": 100,
        "response_optional_fields": "order_status",
    }
    if cursor:
        p["cursor"] = cursor
    d = call("/api/v2/order/get_order_list", p)
    sns += [o["order_sn"] for o in (d.get("order_list") or [])]
    cursor = d.get("next_cursor") or ""
    if not d.get("more"):
        break
print("เจอ %d ออเดอร์ (ย้อนหลัง %s วัน)" % (len(sns), days))
if not sns:
    raise SystemExit(0)

# ขั้นที่ 2 — รายละเอียดทีละ 50
FIELDS = ("item_list,package_list,pay_time,pickup_done_time,ship_by_date,total_amount,order_status,"
          "recipient_address,buyer_username,cancel_by,cancel_reason,buyer_cancel_reason,update_time,create_time,shipping_carrier")
by_status, to_ship_sku, orders = Counter(), Counter(), []
for i in range(0, len(sns), 50):
    d = call("/api/v2/order/get_order_detail",
             {"order_sn_list": ",".join(sns[i:i + 50]), "response_optional_fields": FIELDS})
    for o in d.get("order_list") or []:
        orders.append(o)
        by_status[o.get("order_status")] += 1
        if o.get("order_status") in ("READY_TO_SHIP", "PROCESSED", "RETRY_SHIP"):
            for it in o.get("item_list") or []:
                if it.get("model_sku"):
                    to_ship_sku[it["model_sku"]] += int(it.get("model_quantity_purchased") or 1)

print("\nแยกตามสถานะ:")
for st, n in by_status.most_common():
    print("  %-24s %4d" % (STATUS.get(st, st), n))

print("\nรอจัดส่ง/แพ็คแล้ว: %d SKU · %d ชิ้น" % (len(to_ship_sku), sum(to_ship_sku.values())))
for sku, qty in to_ship_sku.most_common(10):
    print("  %-26s %s" % (sku, qty))

# ตรวจว่าฟิลด์เวลาที่เราพึ่งพามาจริงไหม
print("\nฟิลด์เวลาที่ได้มาจริง (จาก %d ใบ):" % len(orders))
for f in ("create_time", "pay_time", "pickup_done_time", "ship_by_date", "update_time"):
    got = sum(1 for o in orders if o.get(f))
    print("  %-18s มีค่า %d/%d ใบ" % (f, got, len(orders)))

cancelled = [o for o in orders if o.get("order_status") in ("CANCELLED", "IN_CANCEL")]
if cancelled:
    print("\nตัวอย่างใบที่ยกเลิก:")
    o = cancelled[0]
    print("  " + json.dumps({k: o.get(k) for k in
          ("order_sn", "order_status", "cancel_by", "cancel_reason", "buyer_cancel_reason",
           "create_time", "pay_time", "pickup_done_time", "update_time")}, ensure_ascii=False))
    print("\n  package_list:", json.dumps(o.get("package_list"), ensure_ascii=False)[:300])
