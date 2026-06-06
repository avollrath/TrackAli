# TrackAli

Local AliExpress order tracker with a Chrome extension, Flask backend, and responsive dashboard.

## Features

- Imports every order from AliExpress My Orders.
- Clicks **View orders** until no older orders remain.
- Captures structured order-list API responses and falls back to rendered page data.
- Stores order status, seller, products, variants, quantities, prices, images, and links.
- Preserves private ratings and notes when order data is refreshed.
- Archives product images under `backend/product_images` so listings remain visible if remote images disappear.
- Supports search, status filters, sorting, demo data, JSON import, and JSON export.

## Run

1. Install Python dependencies:

   ```powershell
   pip install -r backend/requirements.txt
   ```

2. Start TrackAli:

   ```powershell
   .\start.bat
   ```

3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension` folder.
4. Sign in to AliExpress and open [My Orders](https://www.aliexpress.com/p/order/index.html).
5. Open the TrackAli extension and select **Import all orders**.
6. View the dashboard at [http://localhost:5000](http://localhost:5000).

AliExpress request signatures are short-lived and session-bound. TrackAli captures requests made by the signed-in page instead of storing or recreating credentials.

## Data

Personal order data is stored in `backend/orders_db.json` and excluded from Git. Export the database from the dashboard for backups.
Archived product images are stored in `backend/product_images` and are also excluded from Git.

## Test

```powershell
python -m unittest discover -s backend -p "test_*.py"
```

Private-use project. Not affiliated with AliExpress.
