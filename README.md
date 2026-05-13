# Wolt Ratings

## What It Is

Wolt Ratings is a local-first Flask app plus Chrome extension that syncs your Wolt order history to `backend/orders_db.json`, then lets you search, sort, rate, annotate, import, and export orders from a browser dashboard served at `http://localhost:5000`.

## Project Structure

```text
wolt-ratings/
├── .gitignore
├── README.md
├── backend/
│   ├── app.py
│   ├── example_orders.json
│   └── requirements.txt
├── extension/
│   ├── background.js
│   ├── content.js
│   ├── generate_icons.py
│   ├── manifest.json
│   ├── popup.css
│   ├── popup.html
│   ├── popup.js
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       ├── icon128.png
│       └── logo.svg
├── frontend/
│   ├── app.js
│   ├── favicon.ico
│   ├── favicon.png
│   ├── fonts.css
│   ├── index.html
│   ├── styles.css
│   ├── assets/
│   │   └── logo.svg
│   └── fonts/
│       └── Voltymore.ttf
└── screenshots/
    ├── dashboard.jpg
    ├── extension.jpg
    └── venue_modal.jpg
```

`backend/orders_db.json` is created locally by sync/import and is gitignored.

## Installation

```bash
pip install -r backend/requirements.txt
python backend/app.py
```

The backend listens on `http://localhost:5000` and serves the dashboard from `frontend/`.

## Loading The Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `extension/` folder.

## First Sync Workflow

1. Start the backend with `python backend/app.py`.
2. Visit `https://wolt.com` and wait for the extension to capture a session token through Wolt API request headers or the page session state.
3. Open the extension popup and confirm the token indicator is green.
4. Click Sync Now.
5. Open `http://localhost:5000` to use the dashboard.

## Troubleshooting Token Capture

If the token indicator stays yellow, reload `wolt.com`, open your Wolt order history, and wait for the page to finish loading. If it still stays yellow, sign out and back in to Wolt, then reload the page so the extension can observe a fresh API request header. Tokens are stored in `chrome.storage.session`, so reopening the browser requires a fresh capture.

## DB Schema

`backend/orders_db.json`:

```json
{
  "last_synced": "2026-05-13T10:00:00+00:00",
  "orders": [
    {
      "purchase_id": "unique order id",
      "venue_name": "Restaurant name",
      "received_at": "13/05/2026, 19:30",
      "items": "Item one and Item two",
      "total_amount": "24,50€",
      "status": "delivered",
      "user_custom_data": {
        "rating": 4,
        "notes": "Ask for extra sauce.",
        "last_edited": "2026-05-13T20:00:00+00:00"
      }
    }
  ]
}
```

Fields:

- `last_synced`: ISO 8601 UTC timestamp written by the backend.
- `purchase_id`: stable Wolt order id.
- `venue_name`: restaurant name from Wolt.
- `received_at`: display timestamp normalized to `DD/MM/YYYY, HH:MM`.
- `items`: order item summary.
- `total_amount`: Wolt total amount display string.
- `status`: Wolt order status; dashboard shows delivered orders.
- `user_custom_data.rating`: local rating from 0 to 5.
- `user_custom_data.notes`: local free-text note.
- `user_custom_data.last_edited`: ISO 8601 UTC timestamp from the last local edit.

## API Reference

All JSON errors use:

```json
{ "success": false, "error": "message" }
```

### `GET /orders`

Returns the full local database.

Success:

```json
{ "success": true, "last_synced": null, "orders": [] }
```

### `POST /sync`

Request:

```json
{ "orders": [{ "purchase_id": "id", "venue_name": "Venue" }] }
```

Success:

```json
{
  "success": true,
  "new_orders": 1,
  "existing_orders": 10,
  "total_orders": 11,
  "last_synced": "2026-05-13T10:00:00+00:00"
}
```

### `POST /import`

Request:

```json
{ "orders": [{ "purchase_id": "id" }] }
```

Success:

```json
{
  "success": true,
  "new_orders": 1,
  "skipped_orders": 0,
  "total_orders": 11,
  "last_synced": "2026-05-13T10:00:00+00:00"
}
```

### `POST /orders/update`

Request:

```json
{ "purchase_id": "id", "rating": 5, "notes": "Good" }
```

Success:

```json
{ "success": true, "purchase_id": "id" }
```

### `GET /export`

Downloads `orders_db.json` as a JSON file attachment.

Success: `application/json` file response.

### `GET /health`

Success:

```json
{
  "success": true,
  "status": "ok",
  "total_orders": 11,
  "last_synced": "2026-05-13T10:00:00+00:00"
}
```

## Pagination

The extension fetches Wolt order history with `limit=100`. After each page, it checks for cursor fields such as `next_cursor`, `nextCursor`, `cursor_next`, or `next`; when a cursor exists, it requests the next page with `cursor=<value>&limit=100`. If the API response has no cursor field, sync stops after the first page.
