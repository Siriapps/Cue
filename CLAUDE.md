# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
# API Usage Restrictions

You must strictly adhere to the following API usage limitations:

## General API Restrictions
- Only use APIs that are available in free tiers
- Do not make API calls that require paid subscriptions or API keys
- Verify that any API you use has a free tier available before making calls

## Gemini API Specific Restrictions
- **Maximum calls per session: 20 calls**
- Track all Gemini API calls made during the conversation
- Before each Gemini API call, count how many have been made so far
- If 20 calls have been reached, inform the user and suggest alternatives
- Do not exceed this limit under any circumstances

## Free Tier APIs Only
Acceptable APIs to use (free tier):
- Gemini API (with 20 call limit)
- Other APIs explicitly confirmed to have free tiers

Unacceptable:
- Any API requiring payment
- Any API without a confirmed free tier
- Premium endpoints even on free-tier services

## Enforcement
Before making ANY API call:
1. Verify it's from a free tier service
2. If it's Gemini, check if under 20 calls
3. Inform user if limit reached or API is unavailable

If asked to exceed limits or use paid APIs, politely decline and explain the restriction.


## Project Overview

**Cue** is a Chrome extension that records meetings, transcribes them using Gemini, generates AI summaries, and creates video explanations using Veo 3. It consists of three main components that communicate via HTTP/WebSocket.

## Architecture

```
extension/ (Chrome ext, Vite+TypeScript) → backend/ (Express API, port 3000) → MongoDB Atlas
                                        → server/ (FastAPI, port 8000)
cue/ (React app, port 3001) ← fetches sessions from backend
```

**Data flow**: Audio Recording → Gemini Transcription → Gemini Summary → Veo 3 Video → MongoDB → React Library

## Build & Development Commands

### Root (Chrome Extension)
```bash
npm install        # Install dependencies
npm run build      # Build extension to dist/
npm run dev        # Development with watch mode
npm run clean      # Clean dist folder
```

### Backend API (`/backend`)
```bash
cd backend
npm install
npm start          # Start on port 3000
npm run dev        # Start with nodemon
```

### React Library App (`/cue`)
```bash
cd cue
npm install
npm start          # Start on port 3001
npm run build      # Production build
```

### Python Server (`/server`)
```bash
cd server
python -m venv venv
venv\Scripts\activate  # Windows (or source venv/bin/activate on Unix)
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Key Files

- `extension/src/background/index.ts` - Main orchestrator for recording pipeline
- `extension/src/content/halo.tsx` - User-facing toolbar UI injected on webpages
- `extension/utils/constants.js` - API keys and endpoint configuration
- `backend/server.js` - Express API with MongoDB CRUD operations
- `cue/src/App.js` - React dashboard for viewing sessions
- `server/app/agents/` - Python agents for transcription, summarization, etc.

## Configuration

**Extension** (`extension/utils/constants.js`):
- `GEMINI_API_KEY`, `VEO_API_KEY` - API credentials
- `MONGODB_API_URL` - Backend URL (default: `http://localhost:3000`)
- `LIBRARY_URL` - React app URL (default: `http://localhost:3001`)

**Backend** (`backend/.env`):
- `DB_PASSWORD` - MongoDB Atlas password
- `PORT` - Server port (default: 3000)

**Python** (`server/.env`):
- `API_KEY` - Gemini API key

## Loading the Extension

1. Run `npm run build` in root
2. Open `chrome://extensions/`
3. Enable Developer Mode
4. Load unpacked → select `dist/` folder

## Backend API Endpoints

- `GET /health` - Database connection status
- `POST /sessions` - Save session
- `GET /sessions` - List sessions (supports `?filter=today&search=query`)
- `GET /sessions/:id` - Get single session
- `DELETE /sessions/:id` - Delete session

## Tech Stack

- **Extension**: TypeScript, React, Vite, Chrome Extension Manifest V3
- **Backend**: Express.js, MongoDB driver
- **React App**: React 18, Create React App
- **Python Server**: FastAPI, PyMongo
- **External APIs**: Gemini (transcription/summary), Veo 3 (video generation)
