# ดึงออเดอร์ TikTok จริง -> เก็บลง Supabase (ใช้แทนหน้าเว็บระหว่างที่เครื่องยังไม่มี Node)
# รัน: python scripts/sync_to_supabase.py [จำนวนวันย้อนหลัง]
import hashlib, hmac, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
    if m:
        ENV[m.group(1)] = m.group(2)

APP_KEY, APP_SECRET = ENV["TIKTOK_APP_KEY"], ENV["TIKTOK_APP_SECRET"]
TOKEN = ENV["TIKTOK_ACCESS_TOKEN"]
TT_BASE = ENV.get("TIKTOK_API_BASE", "https://open-api.tiktokglobalshop.com")
SB_URL, SB_KEY = ENV["NEXT_PUBLIC_SUPABASE_URL"], ENV["SUPABASE_SERVICE_KEY"]
SHOP = "SOLID"

# ต้องตรงกับ lib/status.js
TT_STATUS = {
    "UNPAID": "unpaid", "ON_HOLD": "unpaid",
    "AWAITING_SHIPMENT": "to_ship",
    "PARTIALLY_SHIPPING": "packed", "AWAITING_COLLECTION": "packed",
    "IN_TRANSIT": "shipped", "DELIVERED": "delivered",
    "COMPLETED": "done", "CANCELLED": "cancelled",
}


# ── TikTok ────────────────────────────────────────────────────────────
def sign(path, query, body_str):
    keys = sorted(k for k in query if k not in ("sign", "access_token"))
    s = path + "".join("%s%s" % (k, query[k]) for k in keys) + (body_str or "")
    return hmac.new(APP_SECRET.encode(), (APP_SECRET + s + APP_SECRET).encode(), hashlib.sha256).hexdigest()


def tt(path, query=None, body=None, method="GET"):
    q = dict(query or {})
    q["app_key"] = APP_KEY
    q["timestamp"] = str(int(time.time()))
    body_str = json.dumps(body, ensure_ascii=False, separators=(",", ":")) if body is not None else ""
    q["sign"] = sign(path, q, body_str)
    req = urllib.request.Request(
        TT_BASE + path + "?" + urllib.parse.urlencode(q),
        data=body_str.encode() if body_str else None,
        method=method,
        headers={"content-type": "application/json", "x-tts-access-token": TOKEN},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.loads(r.read())
    if res.get("code") != 0:
        raise SystemExit("%s ล้มเหลว: %s %s" % (path, res.get("code"), res.get("message")))
    return res.get("data") or {}


# ── Supabase (ยิงตรงผ่าน REST) ────────────────────────────────────────
def sb(method, path, rows=None, prefer=None):
    data = json.dumps(rows, ensure_ascii=False).encode() if rows is not None else None
    headers = {
        "apikey": SB_KEY, "authorization": "Bearer " + SB_KEY,
        "content-type": "application/json",
    }
    if prefer:
        headers["prefer"] = prefer
    req = urllib.request.Request(SB_URL + "/rest/v1/" + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            return json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        raise SystemExit("Supabase %s %s ล้มเหลว: %s %s" % (method, path, e.code, e.read()[:400].decode()))


def normalize(o):
    """แปลงก้อนดิบ TikTok -> แถวของเรา (ตรรกะเดียวกับ lib/tiktok.js)"""
    lines = {}
    for li in o.get("line_items") or []:
        sku = li.get("seller_sku") or ""
        key = "%s|%s" % (li.get("sku_id") or "", sku)
        if key not in lines:
            lines[key] = {
                "line_id": key, "sku": sku, "platform_sku_id": li.get("sku_id"),
                "product_name": li.get("product_name"), "qty": 0,
                "variant": li.get("sku_name"), "image_url": li.get("sku_image"),
                "price": float(li.get("sale_price") or 0), "raw": li,
            }
        lines[key]["qty"] += 1   # TikTok แตก line_items เป็นรายชิ้น ต้องยุบเอง
    items = list(lines.values())

    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(t)) if t else None
    status = TT_STATUS.get(o.get("status"), "unknown")
    return {
        "platform": "tiktok", "shop": SHOP, "order_id": str(o.get("id") or o.get("order_id")),
        "status": status, "raw_status": o.get("status"),
        "buyer": (o.get("recipient_address") or {}).get("name") or o.get("buyer_email"),
        "total": float((o.get("payment") or {}).get("total_amount") or 0),
        "currency": (o.get("payment") or {}).get("currency"),
        "item_count": sum(i["qty"] for i in items),
        "ordered_at": iso(o.get("create_time")),
        "platform_updated_at": iso(o.get("update_time")),
        "paid_at": iso(o.get("paid_time")),
        "rts_at": iso(o.get("rts_time")),                # ร้านกดจัดส่งเมื่อไหร่
        "collected_at": iso(o.get("collection_time")),   # ขนส่งมารับของจริง
        "cancelled_at": iso(o.get("cancel_time")),
        "cancel_reason": o.get("cancel_reason"),
        "cancel_by": o.get("cancellation_initiator"),
        "tracking_no": o.get("tracking_number") or None,
        "carrier": o.get("shipping_provider") or o.get("delivery_option_name"),
        "raw": o,
        "synced_at": iso(int(time.time())),
    }, items


def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 1
    since = int(time.time() - days * 86400)

    shops = tt("/authorization/202309/shops", {"version": "202309"}).get("shops", [])
    shop = shops[0]
    cipher = shop["cipher"]
    print("ร้าน:", shop.get("name"))

    ids, page_token = [], None
    while True:
        q = {"page_size": "50", "sort_field": "create_time", "sort_order": "DESC", "shop_cipher": cipher}
        if page_token:
            q["page_token"] = page_token
        d = tt("/order/202309/orders/search", q, {"update_time_ge": since}, "POST")
        ids += [str(o.get("id") or o.get("order_id")) for o in (d.get("orders") or []) if o.get("id") or o.get("order_id")]
        page_token = d.get("next_page_token")
        if not page_token:
            break
    print("เจอ %d ออเดอร์ (ย้อนหลัง %s วัน)" % (len(ids), days))

    saved = items_saved = 0
    for i in range(0, len(ids), 50):
        detail = tt("/order/202507/orders", {"ids": ",".join(ids[i:i + 50]), "shop_cipher": cipher})
        pairs = [normalize(o) for o in (detail.get("orders") or [])]
        if not pairs:
            continue

        rows = sb("POST", "os_orders?on_conflict=platform,shop,order_id",
                  [p[0] for p in pairs],
                  "resolution=merge-duplicates,return=representation")
        ref = {(r["platform"], r["shop"], r["order_id"]): r["id"] for r in rows}
        saved += len(rows)

        payload = []
        for order, items in pairs:
            oid = ref.get((order["platform"], order["shop"], order["order_id"]))
            if oid:
                payload += [dict(it, order_ref=oid) for it in items]
        if payload:
            sb("POST", "os_order_items?on_conflict=order_ref,line_id", payload,
               "resolution=merge-duplicates,return=minimal")
            items_saved += len(payload)

        print("  บันทึกแล้ว %d/%d ออเดอร์" % (saved, len(ids)))

    print("\nเสร็จ: %d ออเดอร์ · %d รายการสินค้า" % (saved, items_saved))


main()
