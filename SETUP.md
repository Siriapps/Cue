# cue – Setup guide

This guide gets the API, dashboard, and Chrome extension set up and verifies that everything works.

---

## What you need on your end (keys & setup)

| What | Where to get it | Where to put it |
|------|-----------------|-----------------|
| **Gemini API key** | [Google AI Studio](https://aistudio.google.com/apikey) → Create API key | `server/.env` as `GEMINI_API_KEY=...` |
| **MongoDB connection string** | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) → Create cluster → Connect → “Drivers” → copy URI | `server/.env` as `MONGODB_URI=...` |

**Required for the app to run:** create a file **`server/.env`** with at least:

```
GEMINI_API_KEY=your-gemini-api-key
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

- **Optional:** `GEMINI_MODEL=gemini-2.5-flash` (default if omitted).
- **Optional (auth/Google login):** Supabase URL and anon key in `server/.env` and `cue/.env.local`; see Phase 1 auth in the roadmap if you add Landing/Login.

Nothing else is required to run recording, transcription, summary, and the library. After that, run the API and dashboard (see RUN.md).

---

## Prerequisites

- **Node.js 18+**
- **Python 3.10+**
- **Chrome** (for the extension)
- **Gemini API key** – [Google AI Studio](https://aistudio.google.com/apikey) (same key for text and Veo)
- **MongoDB** – e.g. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) free tier; you need a connection string

---

## 1. Clone and install

From the project root:

```bash
# Cue dashboard (React)
cd cue && npm install && cd ..

# Extension (for build)
cd extension && npm install && cd ..

# API (Python) – optional: use a venv
cd server && pip install -r requirements.txt && cd ..
```

---

## 2. API server (port 8000)

1. **Create `server/.env`** with:

   ```
   GEMINI_API_KEY=your-gemini-api-key
   MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
   ```

   Optional: `GEMINI_MODEL=gemini-2.5-flash`

2. **Check it runs** (from project root):

   ```bash
   npm run start:api
   ```

   You should see: `Uvicorn running on http://0.0.0.0:8000` and `Application startup complete.`

3. **Verify APIs:**
   - Open **http://localhost:8000/docs** – Swagger UI should load.
   - Open **http://localhost:8000/** – health-style response.

   If you see “MONGODB_URI is not set” or “GEMINI_API_KEY is not set”, fix `server/.env` and restart.

---

## 3. Cue dashboard (port 3001)

1. From project root:

   ```bash
   npm run start:dashboard
   ```

2. **Verify:** Browser should open or you can go to **http://localhost:3001**. You should see the cue library UI (sessions, reels, etc.). It talks to the API at `http://localhost:8000`; keep the API running.

   If “Something is already running on port 3001”, either stop that process or run the app on another port (e.g. `PORT=3002 npm start` in `cue/`).

---

## 4. Chrome extension

1. **Build** (from project root):

   ```bash
   npm run build
   ```

   or:

   ```bash
   npm run build:extension
   ```

   This produces **extension/dist/** (e.g. `background.js`, `content.js`, `manifest.json`).

2. **Load in Chrome:**
   - Open **chrome://extensions/**
   - Turn on **Developer mode**
   - Click **Load unpacked**
   - Choose the **`extension/dist`** folder (the one that contains `manifest.json`, `background.js`, `content.js`)

3. **Verify:** On any webpage you should see the Halo Strip. “Library” should open http://localhost:3001. Recording and saving a session should hit the API (check server logs and dashboard).

   If the extension fails (e.g. “Could not connect”), ensure:
   - The API is running on **http://localhost:8000**
   - You loaded **extension/dist**, not the project root or `extension/` without `dist`

---

## 5. Quick checklist

- [ ] `server/.env` has `GEMINI_API_KEY` and `MONGODB_URI`
- [ ] `npm run start:api` runs and http://localhost:8000/docs works
- [ ] `npm run start:dashboard` runs and http://localhost:3001 loads
- [ ] `npm run build` (or `npm run build:extension`) completes
- [ ] Extension loaded from **extension/dist** in Chrome
- [ ] Halo Strip appears on a page; Library opens the dashboard; one test recording reaches the API and shows in the dashboard

For the exact commands to start the app after setup, see **RUN.md**.
