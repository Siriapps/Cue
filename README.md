# cue - AI Meeting Summarizer

**cue** is a Chrome extension that records meeting audio from any tab, transcribes it with Gemini, generates structured summaries and action items, and can create short AI-generated explainer videos with Veo 3. A React dashboard (the “library”) lets you browse, search, and replay all recorded sessions.

## What it does

- **Record** – Capture audio from the current tab (e.g. YouTube, Google Meet, any page with sound).
- **Transcribe** – Speech-to-text via Gemini Native Audio.
- **Summarize** – Key points, decisions, action items, and sentiment via Gemini.
- **Video** – Optional short explainer videos from session summaries using Veo 3 (Gemini API).
- **Library** – Web app to view sessions, reels (sessions with video), and open the source page.

The extension injects a “Halo Strip” toolbar on pages. You start a session, optionally go live (tab audio capture), then stop; the backend transcribes, summarizes, and optionally generates a video. Results show in the dashboard and are stored in MongoDB.

## Tech stack

- **Extension** – TypeScript/React, built with Vite. Service worker talks to the API; content script provides the Halo Strip and session recorder.
- **API** – Python FastAPI on port 8000. Handles session save (transcribe → summarize → optional Veo video), storage, and WebSocket progress for the dashboard.
- **Dashboard** – React app on port 3001. Fetches sessions and reels from the API, shows library and reels feed.
- **Storage** – MongoDB (e.g. Atlas). API key and DB config live in the server only.

## Architecture

```
[Chrome Extension] → HTTP/WebSocket → [FastAPI server:8000] → Gemini API / Veo, MongoDB
                                        ↑
[Dashboard :3001] ←──────────────────────┘
```

For setup and run instructions, see **SETUP.md** and **RUN.md**.
