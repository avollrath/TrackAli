import json
import os
import threading
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS


app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "orders_db.json")
DEMO_DB_PATH = os.path.join(BASE_DIR, "example_orders.json")
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
DB_LOCK = threading.Lock()


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
    orders = [
        order
        for order in db["orders"]
        if isinstance(order, dict) and str(order.get("order_id") or "").strip()
    ]
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
        "product_url": clean_url(raw.get("product_url")),
    }


def normalize_order(raw, existing=None):
    order_id = str(raw.get("order_id") or "").strip()
    products = raw.get("products") if isinstance(raw.get("products"), list) else []
    custom = (existing or raw).get("user_custom_data") or {}
    try:
        rating = min(5, max(0, int(custom.get("rating") or 0)))
    except (TypeError, ValueError):
        rating = 0
    return {
        "order_id": order_id,
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


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


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
            existing[order_id] = normalize_order(raw, existing[order_id])
            updated += 1
        else:
            existing[order_id] = normalize_order(raw)
            added += 1

    db["orders"] = sorted(
        existing.values(),
        key=lambda order: order.get("order_date") or "",
        reverse=True,
    )
    db["last_synced"] = utc_now_iso()
    save_db(db)
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
    return jsonify({"success": True, "demo": demo, **load_db(demo)})


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
        existing[order_id] = normalize_order(raw, existing.get(order_id))

    db["orders"] = sorted(
        existing.values(),
        key=lambda order: order.get("order_date") or "",
        reverse=True,
    )
    db["last_synced"] = utc_now_iso()
    save_db(db)
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
    return jsonify({
        "success": True,
        "status": "ok",
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
    })


if __name__ == "__main__":
    print("TrackAli backend running at http://localhost:5000")
    app.run(debug=True, port=5000)
