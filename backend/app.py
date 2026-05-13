import json
import os
import threading
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

DB_PATH = os.path.join(os.path.dirname(__file__), "orders_db.json")
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "font")
DB_LOCK = threading.Lock()


def load_db():
    if not os.path.exists(DB_PATH):
        return {"last_synced": None, "orders": []}
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(db):
    tmp_path = f"{DB_PATH}.tmp"
    with DB_LOCK:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, DB_PATH)


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def error_response(message, status=400):
    return jsonify({"success": False, "error": message}), status


def get_json_body():
    if not request.is_json:
        return None, error_response("Invalid JSON")
    try:
        return request.get_json(), None
    except Exception:
        return None, error_response("Invalid JSON")


def normalize_received_at(value):
    if not value:
        return ""
    text = str(value)
    try:
        if "T" in text:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y, %H:%M")
        dt = datetime.strptime(text, "%d/%m/%Y, %H:%M")
        return dt.strftime("%d/%m/%Y, %H:%M")
    except ValueError:
        return text


def parse_order(raw: dict) -> dict:
    """Normalise a flat Wolt API order into our storage schema."""
    items = raw.get("items") or ""
    if isinstance(items, list):
        items_str = ", ".join(
            item.get("name", "") if isinstance(item, dict) else str(item)
            for item in items
        )
    else:
        items_str = str(items)

    return {
        "purchase_id": str(raw.get("purchase_id") or ""),
        "venue_name": str(raw.get("venue_name") or "Unknown"),
        "received_at": normalize_received_at(raw.get("received_at")),
        "items": items_str,
        "total_amount": str(raw.get("total_amount") or ""),
        "status": str(raw.get("status") or "unknown"),
        "user_custom_data": {
            "rating": 0,
            "notes": "",
            "last_edited": None,
        },
    }


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/font/<path:filename>")
def serve_font(filename):
    return send_from_directory(FONT_DIR, filename)


@app.route("/sync", methods=["POST"])
def sync():
    payload, error = get_json_body()
    if error:
        return error
    if not payload:
        return error_response("Empty payload")

    raw_orders = payload.get("orders", [])
    if not isinstance(raw_orders, list):
        return error_response("Expected 'orders' array")

    db = load_db()
    existing_ids = {o["purchase_id"] for o in db["orders"]}

    added = 0
    for raw in raw_orders:
        if not isinstance(raw, dict):
            continue
        order = parse_order(raw)
        purchase_id = order["purchase_id"]
        if not purchase_id:
            continue
        if purchase_id not in existing_ids:
            db["orders"].append(order)
            existing_ids.add(purchase_id)
            added += 1

    db["last_synced"] = utc_now_iso()
    save_db(db)

    existing = len(db["orders"]) - added
    return jsonify({
        "success": True,
        "new_orders": added,
        "existing_orders": existing,
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
    })


@app.route("/orders", methods=["GET"])
def orders():
    db = load_db()
    return jsonify({"success": True, **db})


@app.route("/update", methods=["POST"])
def update():
    body, error = get_json_body()
    if error:
        return error
    if not body:
        return error_response("Empty body")

    purchase_id = body.get("purchase_id")
    if not purchase_id:
        return error_response("purchase_id required")

    db = load_db()
    for order in db["orders"]:
        if order["purchase_id"] == purchase_id:
            user_custom_data = order.setdefault("user_custom_data", {})
            if "rating" in body:
                try:
                    rating = int(body["rating"])
                except (TypeError, ValueError):
                    return error_response("rating must be an integer")
                if rating < 0 or rating > 5:
                    return error_response("rating must be between 0 and 5")
                user_custom_data["rating"] = rating
            if "notes" in body:
                user_custom_data["notes"] = str(body["notes"])
            user_custom_data["last_edited"] = utc_now_iso()
            save_db(db)
            return jsonify({"success": True, "purchase_id": purchase_id})

    return error_response("Order not found", 404)


@app.route("/import", methods=["POST"])
def import_db():
    payload, error = get_json_body()
    if error:
        return error
    if not payload or "orders" not in payload:
        return error_response("Expected JSON with 'orders' array")

    incoming = payload.get("orders", [])
    if not isinstance(incoming, list):
        return error_response("Expected 'orders' array")

    db = load_db()
    existing = {o["purchase_id"]: o for o in db["orders"]}

    added = 0
    skipped = 0
    for order in incoming:
        purchase_id = order.get("purchase_id") if isinstance(order, dict) else None
        if not isinstance(purchase_id, str) or not purchase_id.strip():
            skipped += 1
            continue
        if purchase_id not in existing:
            if "user_custom_data" not in order:
                order["user_custom_data"] = {"rating": 0, "notes": "", "last_edited": None}
            existing[purchase_id] = order
            added += 1
        else:
            user_custom_data = existing[purchase_id].get("user_custom_data") or {}
            existing[purchase_id] = order
            if user_custom_data.get("rating") or user_custom_data.get("notes"):
                existing[purchase_id]["user_custom_data"] = user_custom_data

    db["orders"] = list(existing.values())
    db["last_synced"] = utc_now_iso()
    save_db(db)

    return jsonify({
        "success": True,
        "new_orders": added,
        "skipped_orders": skipped,
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
    })


@app.route("/export", methods=["GET"])
def export():
    if not os.path.exists(DB_PATH):
        return error_response("No database yet", 404)
    return send_file(
        DB_PATH,
        mimetype="application/json",
        as_attachment=True,
        download_name="orders_db.json",
    )


@app.route("/health", methods=["GET"])
def health():
    db = load_db()
    return jsonify({
        "success": True,
        "status": "ok",
        "total_orders": len(db["orders"]),
        "last_synced": db.get("last_synced"),
    })


if __name__ == "__main__":
    print("Wolt Ratings backend running at http://localhost:5000")
    app.run(debug=True, port=5000)
