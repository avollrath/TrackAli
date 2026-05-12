# Wolt Ratings

A local-first web application to sync your Wolt order history, then enrich each order with personal star ratings and text notes.

```
┌─────────────────┐     POST /sync      ┌──────────────────┐     GET /orders     ┌─────────────────┐
│ Chrome Extension│ ──────────────────► │  Python / Flask  │ ──────────────────► │  Vanilla JS UI  │
│  (captures JWT) │                     │  + orders_db.json│ ◄────────────────── │  localhost:5000 │
└─────────────────┘                     └──────────────────┘     POST /update     └─────────────────┘
```

---

## Features

- **Session capture** — the extension passively intercepts the Wolt `Authorization` bearer token and `wolt-session-id` from any request you make on wolt.com (no login scraping).
- **One-click sync** — popup "Sync Now" fetches the last 50 orders from the Wolt API and POSTs them to your local backend.
- **Non-destructive merge** — existing orders (with your saved ratings/notes) are never overwritten. Only new orders are appended.
- **Interactive UI** — star ratings (1–5) and free-text notes per order. Both auto-save on interaction.
- **Filtering** — search by venue or item name, hide failed orders, show only rated orders, sort by date / rating / venue.
- **Sync feedback** — the popup and the dashboard both show "X new orders added, Y already existed".

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| pip | any |
| Google Chrome | 88+ (Manifest V3) |

No Node.js or build step required.

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/avollrath/wolt-ratings.git
cd wolt-ratings
```

### 2. Install Python dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Start the backend

```bash
python backend/app.py
```

The server starts at `http://localhost:5000`. The frontend is served from the same process — just open that URL.

### 4. Install the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo

The Wolt Ratings icon appears in your toolbar.

> **First-time icon generation** — if the extension icon shows as broken, run:
> ```bash
> python extension/generate_icons.py
> ```
> Then reload the extension in `chrome://extensions`.

---

## Usage

### Syncing orders

1. Open **[wolt.com](https://wolt.com)** in Chrome and browse any page (the orders page works best). This lets the extension capture your session token.
2. Click the **Wolt Ratings** extension icon.
3. The popup should show a green dot: *"Credentials captured Xs ago"*.
4. Click **Sync Now**.
5. The popup reports: *"3 new orders added, 47 already in database"*.
6. Open `http://localhost:5000` — your orders appear immediately.

> If the dot is yellow (*"No credentials yet"*), navigate to `https://wolt.com/en/discovery` or your order history page and try again.

### Rating and noting orders

- **Stars** — click any star in the Rating column. Saves instantly.
- **Notes** — click the Notes cell, type, then click away (blur). Saves on focus loss.

All data is stored in `backend/orders_db.json` — a human-readable file you can back up, edit, or migrate at any time.

---

## Project Structure

```
wolt-ratings/
├── extension/
│   ├── manifest.json       # Manifest V3 config
│   ├── background.js       # Service worker: header capture + sync logic
│   ├── popup.html          # Extension popup UI
│   ├── popup.js            # Popup logic
│   ├── generate_icons.py   # One-time icon generator
│   └── icons/              # PNG icons (16, 48, 128px)
│
├── backend/
│   ├── app.py              # Flask server (sync / update / orders endpoints)
│   ├── requirements.txt
│   └── orders_db.json      # Created automatically on first sync
│
├── frontend/
│   ├── index.html          # Dashboard (served by Flask at localhost:5000)
│   └── app.js              # Vanilla JS: render, filter, auto-save
│
└── README.md
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/`      | Serves the frontend dashboard |
| `GET`  | `/orders` | Returns full DB as JSON |
| `POST` | `/sync`  | Accepts raw Wolt API payload; merges new orders |
| `POST` | `/update` | Updates `rating` and/or `notes` for one order |
| `GET`  | `/health` | Returns server status and order count |

### `POST /sync` — request body

Raw JSON from the Wolt order history API (`{ "orders": [...] }`).

### `POST /sync` — response

```json
{
  "new_orders": 3,
  "existing_orders": 47,
  "total_orders": 50,
  "last_synced": "2026-05-12T10:30:00+00:00"
}
```

### `POST /update` — request body

```json
{
  "purchase_id": "abc123",
  "rating": 4,
  "notes": "A bit too spicy this time."
}
```

Both `rating` and `notes` are optional — send only what changed.

---

## Data Schema

`backend/orders_db.json`:

```json
{
  "last_synced": "2026-05-12T10:30:00+00:00",
  "orders": [
    {
      "purchase_id": "unique_id_string",
      "venue_name": "Elias Döner Kebab",
      "received_at": "09/05/2026, 20:04",
      "items": "Pita Falafel, Pita Kebab Döner",
      "total_amount": "€26.19",
      "status": "delivered",
      "user_custom_data": {
        "rating": 5,
        "notes": "The garlic sauce is elite here.",
        "last_edited": "2026-05-10T12:00:00+00:00"
      }
    }
  ]
}
```

---

## Notes & known limitations

- **Token expiry** — Wolt bearer tokens expire (~30 min). If the sync fails with a 401, refresh wolt.com and sync again.
- **50-order limit** — the Wolt API endpoint is capped at 50 per request. Run sync regularly to keep your history complete.
- **Local only** — the backend binds to `127.0.0.1`. Your data never leaves your machine.
- **Manifest V3 + `extraHeaders`** — reading `Authorization` from outgoing request headers requires the `extraHeaders` flag in the `webRequest` listener. This is implemented correctly in `background.js` but may require Chrome 96+.

---

## Upgrading to SQLite (optional)

For large histories (500+ orders), swap `orders_db.json` for SQLite:

```python
# backend/app.py — replace load_db/save_db with sqlite3
import sqlite3
conn = sqlite3.connect("orders.db")
```

The schema maps 1:1. Everything else (Flask routes, frontend) stays the same.

---

## License

MIT
