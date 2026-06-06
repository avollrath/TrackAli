import os
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
