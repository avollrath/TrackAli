import os
import tempfile
import unittest
import json

import app as trackali


class TrackAliApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = trackali.DB_PATH
        trackali.DB_PATH = os.path.join(self.temp_dir.name, "orders.json")
        trackali.app.config["TESTING"] = True
        self.client = trackali.app.test_client()

    def tearDown(self):
        trackali.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_sync_preserves_rating_and_notes(self):
        order = {
            "order_id": "123",
            "order_date": "Jun 6, 2026",
            "status": "To ship",
            "seller_name": "Parts Store",
            "total": "€4.20",
            "products": [{"name": "PCB", "quantity": 1}],
        }
        self.assertEqual(self.client.post("/sync", json={"orders": [order]}).status_code, 200)
        self.assertEqual(
            self.client.post(
                "/orders/update",
                json={"order_id": "123", "rating": 5, "notes": "Useful"},
            ).status_code,
            200,
        )

        order["status"] = "Shipped"
        result = self.client.post("/sync", json={"orders": [order]}).get_json()
        saved = self.client.get("/orders").get_json()["orders"][0]

        self.assertEqual(result["updated_orders"], 1)
        self.assertEqual(saved["status"], "Shipped")
        self.assertEqual(saved["user_custom_data"]["rating"], 5)
        self.assertEqual(saved["user_custom_data"]["notes"], "Useful")

    def test_import_keeps_custom_data(self):
        payload = {
            "orders": [{
                "order_id": "456",
                "seller_name": "Tools Store",
                "products": [],
                "user_custom_data": {"rating": 4, "notes": "Keep", "last_edited": None},
            }]
        }
        self.assertEqual(self.client.post("/import", json=payload).status_code, 200)
        saved = self.client.get("/orders").get_json()["orders"][0]
        self.assertEqual(saved["user_custom_data"]["rating"], 4)
        self.assertEqual(saved["user_custom_data"]["notes"], "Keep")

    def test_legacy_orders_do_not_block_sync(self):
        with open(trackali.DB_PATH, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "last_synced": "2026-05-18T20:21:42+00:00",
                    "orders": [{"purchase_id": "legacy", "venue_name": "Old record"}],
                },
                handle,
            )

        response = self.client.post(
            "/sync",
            json={
                "orders": [{
                    "order_id": "789",
                    "seller_name": "Components Store",
                    "products": [{"name": "Switch"}],
                }]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["total_orders"], 1)
        self.assertEqual(self.client.get("/orders").get_json()["orders"][0]["order_id"], "789")

    def test_repeated_order_id_merges_products(self):
        response = self.client.post(
            "/sync",
            json={
                "orders": [
                    {
                        "order_id": "999",
                        "seller_name": "Parts Store",
                        "products": [{"name": "Switch", "product_url": "https://example.com/1"}],
                    },
                    {
                        "order_id": "999",
                        "seller_name": "Parts Store",
                        "products": [{"name": "LED", "product_url": "https://example.com/2"}],
                    },
                ]
            },
        )
        saved = self.client.get("/orders").get_json()["orders"]

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["total_orders"], 1)
        self.assertEqual([product["name"] for product in saved[0]["products"]], ["Switch", "LED"])

    def test_duplicate_ids_in_database_are_read_as_one_order(self):
        with open(trackali.DB_PATH, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "last_synced": None,
                    "orders": [
                        {"order_id": "111", "products": [{"name": "A"}]},
                        {"order_id": "111", "products": [{"name": "B"}]},
                    ],
                },
                handle,
            )

        response = self.client.get("/orders").get_json()

        self.assertEqual(len(response["orders"]), 1)
        self.assertEqual([item["name"] for item in response["orders"][0]["products"]], ["A", "B"])

    def test_checkout_id_is_preserved(self):
        response = self.client.post(
            "/sync",
            json={
                "orders": [{
                    "order_id": "222",
                    "checkout_id": "checkout-1",
                    "products": [{"name": "Relay"}],
                }]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.client.get("/orders").get_json()["orders"][0]["checkout_id"],
            "checkout-1",
        )


if __name__ == "__main__":
    unittest.main()
