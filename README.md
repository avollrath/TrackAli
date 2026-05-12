# Wolt Ratings

> *Because "I think I liked that place?" isn't good enough.*

I order on Wolt a lot. After a while I noticed I kept reordering from restaurants I'd forgotten I didn't enjoy, and skipping ones I'd loved but couldn't remember. Wolt shows you your order history — but it gives you no way to annotate it. No stars, no notes, no memory.

So I built one.

**Wolt Ratings** is a local-first tool that pulls your order history into a personal dashboard where you can rate every order 1–5 stars and leave notes for your future self. *"The garlic sauce is elite here."* *"Ask for extra spicy next time."* *"Never again."* It lives entirely on your machine — your data never touches a third-party server.

![Dashboard screenshot placeholder](https://placehold.co/1200x600/0f0f0f/009de0?text=Wolt+Ratings+Dashboard)

---

## How it works

Three components, each doing one job:

```
┌─────────────────────┐     POST /sync      ┌──────────────────────┐     GET /orders     ┌──────────────────┐
│  Chrome Extension   │ ──────────────────► │   Python / Flask     │ ──────────────────► │  Vanilla JS UI   │
│  Captures JWT from  │                     │   orders_db.json     │ ◄────────────────── │  localhost:5000  │
│  wolt.com localStorage                    │   Non-destructive    │     POST /update    │  Stars + Notes   │
└─────────────────────┘                     │   merge engine       │                     └──────────────────┘
                                            └──────────────────────┘
```

**The extension** injects a content script into wolt.com that reads your session token directly from the page's localStorage — no login scraping, no password required. One click of "Sync Now" fetches your last 50 orders from Wolt's API and sends them to your local backend.

**The backend** (Flask + a plain JSON file) merges incoming orders intelligently: new orders are added, existing ones are never touched. Your ratings and notes are safe no matter how many times you sync.

**The dashboard** is a clean, searchable table. Click stars to rate, click the notes field to annotate. Everything saves instantly on interaction.

---

## Features

- **One-click sync** — browser extension captures your session token automatically and fetches orders with a single button press
- **Non-destructive merge** — re-syncing never overwrites your saved ratings or notes
- **Star ratings** — rate any order 1–5; saved the moment you click
- **Free-text notes** — annotate dishes, flag bad experiences, remind yourself what to reorder
- **Search & filter** — find orders by restaurant or dish name; hide failed orders; show only rated orders
- **Sort** — newest first, oldest first, highest rated, venue A–Z
- **Sync summary** — popup tells you exactly how many new orders were added vs. already existed
- **Local-first** — everything runs on `localhost`; your order history never leaves your machine

---

## Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Extension | Chrome MV3, content script | Reads JWT from page localStorage — more reliable than header interception |
| Backend | Python 3, Flask, Flask-CORS | Zero-dependency local server; JSON file is human-readable and portable |
| Frontend | Vanilla JS, Tailwind CDN | No build step — `index.html` is served directly by Flask |

No Node.js. No npm. No bundler. Just `python backend/app.py` and you're running.

---

## Getting started

### Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| Chrome or Edge | 88+ (Manifest V3) |

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

The server starts at `http://localhost:5000`. The dashboard is served from the same process.

### 4. Install the browser extension

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the `extension/` folder

The Wolt Ratings icon appears in your toolbar. Pin it for easy access.

> If the extension icon appears broken, run `python extension/generate_icons.py` once, then reload the extension.

---

## Usage

### Syncing your orders

1. Open **[wolt.com](https://wolt.com)** — any page, but the order history page works best
2. Wait a moment for the page to fully load
3. Click the **Wolt Ratings** toolbar icon — you should see a green dot: *"Credentials captured"*
4. Click **Sync Now**
5. The popup reports: *"12 new orders added, 38 already in database"*
6. Open `http://localhost:5000` — your orders are there

> **Yellow dot?** Navigate to your [Wolt order history](https://wolt.com/en/me/order-history) and reload the page. The content script will pick up your session on the next page load.

> **Token expired?** Wolt JWTs last ~30 minutes. If you get a sync error after a while, just reload wolt.com and sync again.

### Rating and annotating

- **Stars** — click any star on a row. Saves immediately.
- **Notes** — click the notes field, type, then click away. Saves on blur.

All data lives in `backend/orders_db.json` — a plain JSON file you can read, back up, or import into anything.

---

## Project structure

```
wolt-ratings/
├── extension/
│   ├── manifest.json       # MV3 config — permissions, content script registration
│   ├── background.js       # Service worker: stores credentials, runs sync fetch
│   ├── content.js          # Injected into wolt.com: reads JWT from localStorage
│   ├── popup.html          # Extension popup UI
│   ├── popup.js            # Popup logic: status check, sync trigger, result display
│   ├── generate_icons.py   # One-time icon generator (pure stdlib, no Pillow)
│   └── icons/              # PNG icons at 16, 48, 128px
│
├── backend/
│   ├── app.py              # Flask server: /sync, /update, /orders, /health
│   ├── requirements.txt    # flask, flask-cors
│   └── orders_db.json      # Auto-created on first sync; gitignored
│
├── frontend/
│   ├── index.html          # Dashboard markup + Tailwind CDN
│   └── app.js              # Fetch, render, filter, sort, auto-save
│
└── README.md
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the frontend dashboard |
| `GET` | `/orders` | Returns the full database as JSON |
| `POST` | `/sync` | Merges incoming Wolt orders; returns diff summary |
| `POST` | `/update` | Patches `rating` and/or `notes` for one order |
| `GET` | `/health` | Server status and total order count |

**`POST /sync` response:**
```json
{
  "new_orders": 3,
  "existing_orders": 47,
  "total_orders": 50,
  "last_synced": "2026-05-12T10:30:00+00:00"
}
```

**`POST /update` request:**
```json
{
  "purchase_id": "abc123",
  "rating": 4,
  "notes": "A bit too spicy this time — ask for medium next visit."
}
```

---

## Data schema

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

## Possible extensions

A few things I'd add if this grew:

- **SQLite backend** — drop-in replacement for the JSON file; better for querying once you have hundreds of orders
- **Export to CSV** — for when you want to analyse your spending in a spreadsheet
- **Venue summary view** — aggregate ratings per restaurant across all visits
- **Pagination / infinite scroll** — for long histories
- **Dark/light theme toggle** — currently dark only

---

## License

MIT — do whatever you want with it.
