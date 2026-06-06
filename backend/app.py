import json
import os
import threading
import hashlib
import mimetypes
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS


app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "orders_db.json")
DEMO_DB_PATH = os.path.join(BASE_DIR, "example_orders.json")
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
IMAGE_DIR = os.path.join(BASE_DIR, "product_images")
DB_LOCK = threading.Lock()
IMAGE_LOCK = threading.Lock()
IMAGE_ARCHIVE_RUNNING = False
IMAGE_HOSTS = ("alicdn.com", "aliexpress-media.com")
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def empty_db():
    return {"last_synced": None, "orders": []}


def load_db(demo=False):
    path = DEMO_DB_PATH if demo else DB_PATH
    if not os.path.exists(path):
        return empty_db()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            db = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return empty_db()
    if not isinstance(db, dict) or not isinstance(db.get("orders"), list):
        return empty_db()
    orders_by_id = {}
    for order in db["orders"]:
        if not isinstance(order, dict):
            continue
        order_id = str(order.get("order_id") or "").strip()
        if not order_id:
            continue
        orders_by_id[order_id] = merge_order(order, orders_by_id.get(order_id))
    orders = list(orders_by_id.values())
    return {"last_synced": db.get("last_synced") if orders else None, "orders": orders}


def save_db(db):
    temp_path = f"{DB_PATH}.tmp"
    with DB_LOCK:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(db, handle, ensure_ascii=False, indent=2)
        os.replace(temp_path, DB_PATH)


def error_response(message, status=400):
    return jsonify({"success": False, "error": message}), status


def json_body():
    if not request.is_json:
        return None, error_response("Expected JSON request")
    try:
        return request.get_json(), None
    except Exception:
        return None, error_response("Invalid JSON")


def clean_url(value):
    value = str(value or "").strip()
    if value.startswith("//"):
        return f"https:{value}"
    return value


def image_filename(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not any(
        parsed.hostname == host or parsed.hostname.endswith(f".{host}")
        for host in IMAGE_HOSTS
    ):
        return None
    extension = os.path.splitext(parsed.path)[1].lower()
    if extension not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        extension = ".jpg"
    return f"{hashlib.sha256(url.encode('utf-8')).hexdigest()}{extension}"


def local_image_url(url):
    filename = image_filename(url)
    if not filename or not os.path.exists(os.path.join(IMAGE_DIR, filename)):
        return ""
    return f"/product-images/{filename}"


def normalize_product(raw):
    try:
        quantity = max(1, int(raw.get("quantity") or 1))
    except (TypeError, ValueError):
        quantity = 1
    return {
        "name": str(raw.get("name") or "AliExpress item").strip(),
        "variant": str(raw.get("variant") or "").strip(),
        "quantity": quantity,
        "price": str(raw.get("price") or "").strip(),
        "image_url": clean_url(raw.get("image_url")),
        "local_image_url": str(raw.get("local_image_url") or "").strip(),
        "product_url": clean_url(raw.get("product_url")),
    }


def normalize_order(raw, existing=None):
    order_id = str(raw.get("order_id") or "").strip()
    products = raw.get("products") if isinstance(raw.get("products"), list) else []
    custom = (existing or raw).get("user_custom_data") or {}
    checkout_id = str(
        raw.get("checkout_id") or (existing or {}).get("checkout_id") or order_id
    ).strip()
    try:
        rating = min(5, max(0, int(custom.get("rating") or 0)))
    except (TypeError, ValueError):
        rating = 0
    return {
        "order_id": order_id,
        "checkout_id": checkout_id,
        "order_date": str(raw.get("order_date") or "").strip(),
        "status": str(raw.get("status") or "Unknown").strip(),
        "seller_name": str(raw.get("seller_name") or "Unknown seller").strip(),
        "seller_url": clean_url(raw.get("seller_url")),
        "order_url": clean_url(raw.get("order_url")),
        "message_url": clean_url(raw.get("message_url")),
        "total": str(raw.get("total") or "").strip(),
        "products": [normalize_product(item) for item in products if isinstance(item, dict)],
        "user_custom_data": {
            "rating": rating,
            "notes": str(custom.get("notes") or ""),
            "last_edited": custom.get("last_edited"),
        },
    }


def merge_order(raw, existing=None):
    normalized = normalize_order(raw, existing)
    if not existing:
        return normalized

    products = {}
    for product in [*(existing.get("products") or []), *normalized["products"]]:
        normalized_product = normalize_product(product)
        key = (
            normalized_product["product_url"],
            normalized_product["name"],
            normalized_product["variant"],
            normalized_product["price"],
        )
        if key in products:
            products[key]["quantity"] = max(
                products[key]["quantity"],
                normalized_product["quantity"],
            )
        else:
            products[key] = normalized_product

    for field in (
        "order_date",
        "status",
        "seller_name",
        "seller_url",
        "order_url",
        "message_url",
        "total",
        "checkout_id",
    ):
        if not normalized[field]:
            normalized[field] = existing.get(field) or ""
    normalized["products"] = list(products.values())
    return normalized


def download_image(url):
    filename = image_filename(url)
    if not filename:
        return False
    os.makedirs(IMAGE_DIR, exist_ok=True)
    target = os.path.join(IMAGE_DIR, filename)
    if os.path.exists(target):
        return True

    temp_path = f"{target}.tmp"
    try:
        request = Request(url, headers={"User-Agent": "Mozilla/5.0 TrackAli/1.0"})
        with urlopen(request, timeout=20) as response:
            content_type = response.headers.get_content_type()
            if not content_type.startswith("image/"):
                return False
            data = response.read(MAX_IMAGE_BYTES + 1)
        if not data or len(data) > MAX_IMAGE_BYTES:
            return False
        with open(temp_path, "wb") as handle:
            handle.write(data)
        os.replace(temp_path, target)
        return True
    except (OSError, ValueError):
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return False


def archive_images():
    global IMAGE_ARCHIVE_RUNNING
    try:
        db = load_db()
        urls = {
            product.get("image_url")
            for order in db["orders"]
            for product in order.get("products", [])
            if image_filename(product.get("image_url") or "")
        }
        with ThreadPoolExecutor(max_workers=6) as executor:
            list(executor.map(download_image, urls))
    finally:
        with IMAGE_LOCK:
            IMAGE_ARCHIVE_RUNNING = False


def start_image_archive():
    global IMAGE_ARCHIVE_RUNNING
    with IMAGE_LOCK:
        if IMAGE_ARCHIVE_RUNNING:
            return
        IMAGE_ARCHIVE_RUNNING = True
    threading.Thread(target=archive_images, daemon=True).start()


def attach_local_images(db):
    for order in db["orders"]:
        for product in order.get("products", []):
            product["local_image_url"] = local_image_url(product.get("image_url") or "")
    return db


@app.route("/")
def index():
    start_image_archive()
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/product-images/<path:filename>")
def product_image(filename):
    return send_from_directory(IMAGE_DIR, filename)


@app.route("/sync", methods=["POST"])
def sync():
    payload, error = json_body()
    if error:
        return error
    raw_orders = payload.get("orders") if isinstance(payload, dict) else None
    if not isinstance(raw_orders, list):
        return error_response("Expected 'orders' array")

    db = load_db()
    existing = {order["order_id"]: order for order in db["orders"] if order.get("order_id")}
    added = 0
    updated = 0

    for raw in raw_orders:
        if not isinstance(raw, dict):
            continue
        order_id = str(raw.get("order_id") or "").strip()
        if not order_id:
            continue
        if order_id in existing:
            existing[order_id] = merge_order(raw, existing[order_id])
            updated += 1
        else:
            existing[order_id] = merge_order(raw)
            added += 1

    db["orders"] = sorted(
        existing.values(),
        key=lambda order: order.get("order_date") or "",
        reverse=True,
    )
    db["last_synced"] = utc_now_iso()
    save_db(db)
    start_image_archive()
    return jsonify({
        "success": True,
        "new_orders": added,
        "updated_orders": updated,
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
    })


@app.route("/orders")
def orders():
    demo = request.args.get("demo") == "1"
    db = load_db(demo)
    if not demo:
        start_image_archive()
    return jsonify({"success": True, "demo": demo, **attach_local_images(db)})


@app.route("/orders/update", methods=["POST"])
def update_order():
    body, error = json_body()
    if error:
        return error
    order_id = str((body or {}).get("order_id") or "").strip()
    if not order_id:
        return error_response("order_id required")

    db = load_db()
    for order in db["orders"]:
        if order["order_id"] != order_id:
            continue
        custom = order.setdefault("user_custom_data", {})
        if "rating" in body:
            try:
                rating = int(body["rating"])
            except (TypeError, ValueError):
                return error_response("rating must be an integer")
            if rating < 0 or rating > 5:
                return error_response("rating must be between 0 and 5")
            custom["rating"] = rating
        if "notes" in body:
            custom["notes"] = str(body["notes"])
        custom["last_edited"] = utc_now_iso()
        save_db(db)
        return jsonify({"success": True, "order_id": order_id})
    return error_response("Order not found", 404)


@app.route("/import", methods=["POST"])
def import_db():
    payload, error = json_body()
    if error:
        return error
    incoming = payload.get("orders") if isinstance(payload, dict) else None
    if not isinstance(incoming, list):
        return error_response("Expected 'orders' array")

    db = load_db()
    existing = {order["order_id"]: order for order in db["orders"] if order.get("order_id")}
    added = 0
    for raw in incoming:
        if not isinstance(raw, dict):
            continue
        order_id = str(raw.get("order_id") or "").strip()
        if not order_id:
            continue
        if order_id not in existing:
            added += 1
        existing[order_id] = merge_order(raw, existing.get(order_id))

    db["orders"] = sorted(
        existing.values(),
        key=lambda order: order.get("order_date") or "",
        reverse=True,
    )
    db["last_synced"] = utc_now_iso()
    save_db(db)
    start_image_archive()
    return jsonify({
        "success": True,
        "new_orders": added,
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
    })


@app.route("/export")
def export_db():
    if not os.path.exists(DB_PATH):
        return error_response("No database yet", 404)
    return send_file(
        DB_PATH,
        mimetype="application/json",
        as_attachment=True,
        download_name="trackali-orders.json",
    )


@app.route("/health")
def health():
    db = load_db()
    archived_images = 0
    if os.path.isdir(IMAGE_DIR):
        archived_images = sum(
            1 for name in os.listdir(IMAGE_DIR) if not name.endswith(".tmp")
        )
    return jsonify({
        "success": True,
        "status": "ok",
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
        "archived_images": archived_images,
        "image_archive_running": IMAGE_ARCHIVE_RUNNING,
    })


if __name__ == "__main__":
    print("TrackAli backend running at http://localhost:5000")
    app.run(debug=True, port=5000)
