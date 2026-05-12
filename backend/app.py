import json
import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

DB_PATH = os.path.join(os.path.dirname(__file__), "orders_db.json")
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def load_db():
    if not os.path.exists(DB_PATH):
        return {"last_synced": None, "orders": []}
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(db):
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def parse_order(raw: dict) -> dict:
    """Normalise a raw Wolt API order into our storage schema."""
    items_list = raw.get("items") or []
    if isinstance(items_list, list):
        items_str = ", ".join(
            i.get("name", "") for i in items_list if isinstance(i, dict)
        )
    else:
        items_str = str(items_list)

    total = raw.get("total_price") or raw.get("total_amount") or {}
    if isinstance(total, dict):
        amount = total.get("amount", 0)
        currency = total.get("currency", "EUR")
        symbol = "€" if currency == "EUR" else currency
        total_str = f"{symbol}{amount / 100:.2f}"
    else:
        total_str = str(total)

    received = raw.get("received_at") or raw.get("created_at") or ""
    if received and "T" in received:
        try:
            dt = datetime.fromisoformat(received.replace("Z", "+00:00"))
            received = dt.strftime("%d/%m/%Y, %H:%M")
        except ValueError:
            pass

    return {
        "purchase_id": raw.get("purchase_id") or raw.get("id") or "",
        "venue_name": raw.get("venue_name") or raw.get("venue", {}).get("name", "Unknown"),
        "received_at": received,
        "items": items_str,
        "total_amount": total_str,
        "status": raw.get("status", "unknown"),
        "user_custom_data": {
            "rating": 0,
            "notes": "",
            "last_edited": None,
        },
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/sync", methods=["POST"])
def sync():
    payload = request.get_json(force=True)
    if not payload:
        return jsonify({"error": "Empty payload"}), 400

    raw_orders = payload.get("orders", [])
    if not isinstance(raw_orders, list):
        return jsonify({"error": "Expected 'orders' array"}), 400

    db = load_db()
    existing_ids = {o["purchase_id"] for o in db["orders"]}

    added = 0
    for raw in raw_orders:
        order = parse_order(raw)
        pid = order["purchase_id"]
        if not pid:
            continue
        if pid not in existing_ids:
            db["orders"].append(order)
            existing_ids.add(pid)
            added += 1

    db["last_synced"] = datetime.now(timezone.utc).isoformat()
    save_db(db)

    existing = len(db["orders"]) - added
    return jsonify({
        "new_orders": added,
        "existing_orders": existing,
        "total_orders": len(db["orders"]),
        "last_synced": db["last_synced"],
    })


@app.route("/orders", methods=["GET"])
def orders():
    db = load_db()
    return jsonify(db)


@app.route("/update", methods=["POST"])
def update():
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Empty body"}), 400

    purchase_id = body.get("purchase_id")
    if not purchase_id:
        return jsonify({"error": "purchase_id required"}), 400

    db = load_db()
    for order in db["orders"]:
        if order["purchase_id"] == purchase_id:
            ucd = order.setdefault("user_custom_data", {})
            if "rating" in body:
                ucd["rating"] = int(body["rating"])
            if "notes" in body:
                ucd["notes"] = str(body["notes"])
            ucd["last_edited"] = datetime.now(timezone.utc).isoformat()
            save_db(db)
            return jsonify({"success": True, "purchase_id": purchase_id})

    return jsonify({"error": "Order not found"}), 404


@app.route("/health", methods=["GET"])
def health():
    db = load_db()
    return jsonify({
        "status": "ok",
        "total_orders": len(db["orders"]),
        "last_synced": db.get("last_synced"),
    })


if __name__ == "__main__":
    print("Wolt Ratings backend running at http://localhost:5000")
    app.run(debug=True, port=5000)
