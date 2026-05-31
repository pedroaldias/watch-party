# 🎬 WatchParty

A real-time collaborative watch party app — watch movies and series in sync with anyone, anywhere.

Similar to Rave / Teleparty. Supports Google Drive video links, external subtitles (.srt/.vtt/.ass), 2h+ content, buffering detection, host control, and live chat.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔄 Sync | ±500ms tolerance, auto-resync every 2s |
| 👑 Host control | Only host can play/pause/seek; guests follow |
| 🎮 Control transfer | Guests can request, host can grant |
| 📝 Subtitles | .srt, .vtt, .ass — size control, toggle |
| ⏸ Buffering | Auto-pauses everyone while someone buffers |
| 💬 Chat | Real-time sidebar chat |
| 🔁 Reconnect | Instant resync on reconnect |
| 🎬 Video | Google Drive (iframe) + direct MP4/WebM |

---

## 🚀 Deployment (100% Free)

### Step 1 — Deploy the Backend (Render)

1. Create a free account at [render.com](https://render.com)
2. Click **New → Web Service**
3. Connect your GitHub repo (or paste the repo URL)
4. Set:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Click **Deploy**
6. Copy your server URL, e.g.: `https://watchparty-server.onrender.com`

> ⚠️ Render free tier may sleep after 15 min inactivity. First connection after sleep takes ~30s. Upgrade to a paid plan or use [Railway](https://railway.app) for always-on free tier.

### Step 2 — Configure Frontend

Open `client/index.html` and find this line near the top of the `<script>` tag:

```js
const SERVER_URL = window.WATCHPARTY_SERVER || 'https://watchparty-server.onrender.com';
```

Replace `https://watchparty-server.onrender.com` with your actual Render server URL.

### Step 3 — Deploy the Frontend (Vercel)

1. Create a free account at [vercel.com](https://vercel.com)
2. Click **New Project → Import Git Repository**
3. Set **Root Directory** to the project root
4. Vercel will auto-detect static site
5. Click **Deploy**
6. Your app URL: `https://your-app.vercel.app`

Alternatively, deploy just the `client/` folder using:
```bash
npx vercel client/
```

---

## 📖 How to Use

### Creating a Room
1. Go to your app URL
2. Enter your name → **Create Room**
3. A 6-character room code appears — share the link with your friend
4. Click **Enter Room**
5. Paste a Google Drive or direct MP4 video URL
6. Optionally upload a subtitle file (.srt/.vtt/.ass)
7. Click **▶ Start Session**

### Joining a Room
1. Open the shared link (room code is pre-filled)
2. Enter your name → **Join Room**
3. Wait for the host to start the video

---

## 🎬 Video Sources

### ✅ Direct MP4 (Best sync, fully supported)
Paste any publicly accessible `.mp4`, `.webm`, or `.ogg` URL directly.

Examples:
- A media server URL: `http://192.168.1.x:8080/movie.mp4`
- A CDN-hosted video
- A Cloudflare R2 / S3 public file

### ✅ Google Drive (Iframe mode)
1. Upload your video to Google Drive
2. Right-click → **Share → Anyone with the link**
3. Copy the share link and paste it in WatchParty

> **Note:** Google Drive videos use iframe embedding. Sync works via play/pause/seek commands sent through the chat, but the actual video control within the iframe is limited by browser sandboxing. For perfect frame-level sync, use a direct MP4 URL.

### ❌ Netflix / Disney+ / HBO Max
Direct integration is **not possible** — these platforms use DRM (Widevine/PlayReady) that prevents external JS control. Use the [Teleparty](https://teleparty.com) browser extension for those platforms instead.

---

## 📝 Subtitles

- Upload `.srt`, `.vtt`, or `.ass`/`.ssa` files
- Files are parsed locally in the browser (nothing uploaded to any server)
- Subtitle timing is driven by the host's `currentTime`
- Toggle on/off and resize via the sidebar
- Subtitles survive seeks and resync events

---

## 🏗️ Architecture

```
Browser A (Host)          Server (Node.js + Socket.io)       Browser B (Guest)
    │                               │                               │
    │──── join-room ───────────────►│◄──── join-room ──────────────│
    │◄─── state/users ─────────────│──── state/users ────────────►│
    │                               │                               │
    │──── play ────────────────────►│──── play + lag comp ────────►│
    │──── pause ───────────────────►│──── pause ──────────────────►│
    │──── seek ────────────────────►│──── seek ───────────────────►│
    │                               │                               │
    │──── heartbeat (2s) ──────────►│──── host-heartbeat ─────────►│
    │◄─── heartbeat-ack ───────────│       (guests check drift)     │
    │                               │                               │
    │──── buffer-start ────────────►│──── buffer-pause ───────────►│
    │──── buffer-end ──────────────►│──── buffer-ready ───────────►│
```

### Key sync mechanisms:
- **Latency compensation**: `play` events advance `currentTime` by `RTT/2`
- **Drift detection**: every heartbeat, server checks guest drift; if >1.5s, sends `resync`
- **Host heartbeat**: every 2s, host position broadcast so guests can self-correct
- **Buffering**: any client buffers → server broadcasts pause; all clear → host resumes
- **Host failover**: if host disconnects for >10s, next connected user promoted

---

## 🔧 Local Development

```bash
# Backend
cd server
npm install
npm run dev  # uses nodemon

# Frontend — just open in browser:
open client/index.html

# Or serve with a local HTTP server:
npx serve client/
```

For local testing, set:
```js
const SERVER_URL = 'http://localhost:3001';
```

---

## 📁 Project Structure

```
watchparty/
├── server/
│   ├── server.js          # Node.js + Socket.io backend
│   ├── package.json
│   └── render.yaml        # Render deployment config
├── client/
│   ├── index.html         # Complete frontend (single file)
│   ├── subtitle-parser.js # Subtitle parsing utilities
│   └── drive-utils.js     # Google Drive URL helpers
├── vercel.json            # Vercel deployment config
└── README.md
```

---

## ⚠️ Edge Cases Handled

| Case | Handling |
|---|---|
| Guest disconnects mid-watch | On reconnect, instantly resynced to host's current time |
| Host disconnects | 10s grace period, then next user promoted to host |
| Buffering mid-movie | Auto-pause for all; auto-resume when clear |
| Subtitle seek | `currentTime` drives subtitle lookup on every frame |
| Large subtitle files | Binary search O(log n) for performance |
| Long content (2h+) | No streaming limits; heartbeat interval optimized |
| RTT varies | Rolling RTT measured via heartbeat-ack; compensated on play |
| Last user leaves | Room cleaned up after 30 minutes |

---

## 🎨 Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS, HTML5 `<video>`, CSS custom properties |
| Real-time | Socket.io 4.x (WebSocket + polling fallback) |
| Backend | Node.js + Express |
| Hosting (free) | Vercel (frontend) + Render (backend) |
| Fonts | Syne + DM Mono (Google Fonts) |

---

## 📜 License

MIT — use freely, modify, self-host.
