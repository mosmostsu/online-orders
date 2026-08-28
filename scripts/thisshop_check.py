# เช็คว่าคุยกับ ThisShop ได้ไหม + สำรวจว่าสถานะไหนคืออะไร ข้อมูลมีฟิลด์อะไรบ้าง
# รัน: python scripts/thisshop_check.py
import hashlib, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
    if m:
        ENV[m.group(1)] = m.group(2)

APP_ID = ENV["THISSHOP_APP_ID"]
APP_SECRET = ENV["THISSHOP_APP_SECRET"]
SIGN_KEY = ENV["THISSHOP_SIGN_KEY"]
BASE = ENV.get("THISSHOP_BASE", "https://open.thisshop.com")


def post(url, payload, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                 method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def get_token():
    d = post(f"{BASE}/api/oauth/access/token",
             {"appId": APP_ID, "appSecret": APP_SECRET, "timestamp": str(int(time.time() * 1000))}, 20)
    if not d.get("transactionStatus", {}).get("success"):
        raise SystemExit("ขอโทเคนไม่สำเร็จ: %s" % json.dumps(d, ensure_ascii=False)[:300])
    return d["token"]


def sign(params):
    def to_str(v):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)
    f = {k: v for k, v in params.items() if v not in (None, "") and k != "sign"}
    base = "".join("%s=%s" % (k, urllib.parse.quote_plus(to_str(f[k]))) for k in sorted(f))
    return hashlib.md5((base + SIGN_KEY).encode()).hexdigest().upper()


def call(token, method, data, nonce_suffix="001"):
    ts = str(int(time.time() * 1000))
    p = {"appId": APP_ID, "token": token, "timestamp": ts, "nonce": ts + nonce_suffix, "method": method, "data": data}
    return post(f"{BASE}/api/shop/router/rest", {**p, "sign": sign(p)})


# SKU ถูกเข้ารหัสไว้ใน qrcode เพราะระบบเขาไม่รับจุดกับขีด
decode = lambda q: (q or "").replace("dott", ".").replace("sizee", "-")

token = get_token()
print("ขอโทเคนสำเร็จ\n")

# สำรวจว่าสถานะไหนมีออเดอร์เท่าไหร่ (Colab ใช้แค่ 8 = รอจัดส่ง)
print("จำนวนออเดอร์แต่ละสถานะ:")
found = {}
for st in range(1, 13):
    r = call(token, "thisshop.order.list.get", {"orderStatus": st, "pageNum": 1, "pageSize": 1}, str(st).zfill(4))
    s = r.get("transactionStatus", {})
    if not s.get("success"):
        print("  สถานะ %-3s ถามไม่ได้: %s" % (st, s.get("replyText")))
        continue
    n = (r.get("page") or {}).get("count")
    print("  สถานะ %-3s %s ใบ" % (st, n))
    if n:
        found[st] = r.get("result") or []

# ดูรายละเอียดสักใบเพื่อรู้ว่ามีฟิลด์อะไร โดยเฉพาะเรื่องเวลา
for st, rows in found.items():
    if not rows:
        continue
    oid = rows[0].get("orderId")
    d = call(token, "thisshop.order.detail.get", {"orderId": oid}, "999999")
    if not d.get("transactionStatus", {}).get("success"):
        continue
    res = d.get("result") or {}
    print("\nตัวอย่างออเดอร์สถานะ %s (id %s)" % (st, oid))
    print("  ฟิลด์ที่มี: " + ", ".join(sorted(res.keys())))
    times = {k: v for k, v in res.items() if any(w in k.lower() for w in ("time", "date", "at"))}
    print("  ฟิลด์เวลา: " + json.dumps(times, ensure_ascii=False)[:400])
    it = (res.get("itemList") or [{}])[0]
    print("  รายการสินค้า: " + json.dumps({k: it.get(k) for k in list(it)[:12]}, ensure_ascii=False)[:400])
    print("  SKU หลังถอดรหัส: " + decode(it.get("qrcode")))
    break
