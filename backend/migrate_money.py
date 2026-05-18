import json
import os

from app import DB_PATH, normalize_order_money, save_db

MONEY_FIELDS = (
    "total_amount_value",
    "total_amount_currency",
    "total_amount_eur",
    "exchange_rate_to_eur",
    "exchange_rate_date",
)


def main():
    if not os.path.exists(DB_PATH):
        db = {"last_synced": None, "orders": []}
    else:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
    changed = 0
    for order in db.get("orders", []):
        before = {field: order.get(field) for field in MONEY_FIELDS}
        normalize_order_money(order)
        after = {field: order.get(field) for field in MONEY_FIELDS}
        if before != after:
            changed += 1

    save_db(db)
    print(f"normalized money fields for {changed} orders")


if __name__ == "__main__":
    main()
