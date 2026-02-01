# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repo overview (big picture)
Cue is a 3-part system:
- `extension/`: Chrome extension (Manifest V3) that injects the “Halo Strip” UI into pages and records audio.
- `server/`: Python FastAPI backend on `http://localhost:8000` that runs transcription/summarization/video generation and stores data in MongoDB.
- `cue/`: React dashboard (“library”) on `http://localhost:3001` that lists sessions, shows transcripts/summaries, and plays reels.

Data flow:
- Session recording: `extension` captures mic audio → `server` `/sessions/save` (transcribe → summarize → optional video) → `server` broadcasts progress/results over WebSocket → `cue` dashboard updates in real time and later refreshes from MongoDB.
- Go Live: `extension` uses `chrome.tabCapture` to stream tab audio → `server` `/ws/puppeteer` for real-time diagram/motion/pose updates → `extension` forwards results to the injected UI.

## Common commands
All commands below are run from the repo root unless noted.

### Install deps
- Dashboard:
  - `cd cue && npm install`
- Extension:
  - `cd extension && npm install`
- API:
  - `cd server && pip install -r requirements.txt`

### Run (dev)
Start these in two terminals:
- API (FastAPI, port 8000):
  - `npm run start:api`
- Dashboard (React, port 3001):
  - `npm run start:dashboard`

Helpful URLs:
- API docs (Swagger): `http://localhost:8000/docs`
- Dashboard: `http://localhost:3001`

### Build the Chrome extension
- `npm run build` (same as `npm run build:extension`)

After building, load/reload the unpacked extension from `extension/dist` in `chrome://extensions`.

### Tests
Only the dashboard currently has a configured test runner.
- Run dashboard tests (watch mode):
  - `cd cue && npm test`
- Run a single test file / subset (Jest path pattern):
  - `cd cue && npm test -- SessionDetail`

### Linting
There is no dedicated lint script at the repo root. For the dashboard, Create React App’s ESLint checks run during `cd cue && npm start` / `cd cue && npm run build`.

## Configuration (runtime)
- The API loads environment variables from `server/.env` (via `python-dotenv`). Required values are documented in `SETUP.md` (notably `GEMINI_API_KEY` and `MONGODB_URI`).
- The extension and dashboard currently assume the API is at `http://localhost:8000` / `ws://localhost:8000`:
  - Extension: `extension/src/background/index.ts` (`API_BASE`, `WS_BASE`)
  - Dashboard: `cue/src/App.js` (`ADK_API_URL`, `WS_URL`)

## Code architecture notes (where to look first)

### Chrome extension (`extension/`)
- Background/service-worker orchestration and backend integration:
  - `extension/src/background/index.ts`
  - Handles messages from the content script, posts session payloads to `/sessions/save`, and forwards WebSocket events back into the page.
- Injected UI (“Halo Strip”) and user interactions:
  - `extension/src/content/halo.tsx` (+ `halo.css`)
  - Starts/stops mic recording (`session_recorder.ts`), triggers “Go Live” (`go_live.ts`), and sends requests to the background script.

### API server (`server/`)
- FastAPI app + HTTP/WebSocket endpoints:
  - `server/app/main.py`
  - REST endpoints used by the extension/dashboard (e.g. `/sessions`, `/sessions/save`, `/reels`) and WebSockets (notably `/ws/dashboard` for progress and `/ws/puppeteer` for real-time audio → motion/diagram events).
- AI/agent logic:
  - `server/app/agents/` (Gemini client, transcription, summarization, motion extraction, etc.)
- Persistence:
  - `server/app/db/mongo.py` creates the MongoDB client from `MONGODB_URI`.
  - `server/app/db/repository.py` contains collection helpers and session CRUD.

### Dashboard (`cue/`)
- App state + API/WS integration:
  - `cue/src/App.js`
  - Connects to `/ws/dashboard`, merges “live” sessions from WebSocket with sessions loaded from MongoDB (`/sessions`), and loads reels from `/reels`.

## AI/API usage restrictions (from `CLAUDE.md`)
- Only use external APIs that have a free tier.
- If interacting with Gemini, keep a hard cap of 20 Gemini calls per session and track the count.