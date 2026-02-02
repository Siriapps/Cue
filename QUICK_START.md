# Quick Start Guide - Hey Cue Feature

## Prerequisites

1. **macOS System Permissions** (REQUIRED):
   - Open **System Settings** → **Privacy & Security** → **Microphone**
   - Ensure **Google Chrome** is listed and **enabled** (toggle ON)
   - If Chrome is not listed, try using the microphone in another Chrome tab first, then check again

2. **Chrome Browser**: Make sure you're using Google Chrome (not Chromium or Edge)

## Step-by-Step Setup

### Step 1: Build the Extension

Open a terminal and run:

```bash
cd extension
npm run build
```

You should see:
```
✓ built in XXXms
✓ Ensured content.js is UTF-8 encoded
```

### Step 2: Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Navigate to and select the `extension/dist` folder
5. The extension should appear as **"cue - AI Workspace"**

### Step 3: Start the Python API Server

Open a **new terminal window** and run:

```bash
cd server
source venv/bin/activate
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Keep this terminal open. You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 4: Start the React Dashboard (Optional - for viewing sessions)

Open **another new terminal window** and run:

```bash
cd cue
npm start
```

This will open `http://localhost:3001` automatically. Keep this terminal open.

### Step 5: Test "Hey Cue" Feature

1. **Navigate to any webpage** (e.g., `https://google.com` or `https://example.com`)
2. You should see the **floating Cue strip** at the top center of the page
3. **Say "Hey Cue"** clearly into your microphone
4. **What should happen:**
   - The chat panel opens automatically
   - The "Ask AI" button turns **green** and starts pulsing
   - The button text changes to "Listening..."
   - The input placeholder shows "Cue is listening..."
5. **Speak your question** (e.g., "What is the weather today?")
   - You'll see your words appear in the input field in real-time
6. **Stop speaking** for 1.5 seconds
   - The query automatically sends to AI
   - The button returns to purple
   - You'll see the AI response appear

## Troubleshooting

### If "Hey Cue" doesn't work:

1. **Check macOS System Permissions**:
   - System Settings → Privacy & Security → Microphone → Chrome must be enabled

2. **Reload the Extension**:
   - Go to `chrome://extensions/`
   - Find "cue - AI Workspace"
   - Click the **reload icon** (circular arrow)

3. **Quit and Restart Chrome**:
   - Press `Cmd+Q` to quit Chrome completely
   - Reopen Chrome
   - Reload the extension

4. **Check Browser Console** (for debugging):
   - Press `F12` or `Cmd+Option+I` to open DevTools
   - Go to the "Console" tab
   - Look for messages like:
     - `[voice] Wake word detection started`
     - `[cue] Wake word 'Hey Cue' detected!`
     - Any error messages in red

5. **Test Microphone**:
   - Try using the microphone in another app (like Google Meet)
   - Make sure your microphone is working

### If transcription doesn't start:

1. **Check microphone permission in Chrome**:
   - Click the lock icon in the address bar
   - Ensure microphone is allowed

2. **Check console for errors**:
   - Look for permission errors or "device not found" errors

3. **Try saying "Hey Cue" again**:
   - Sometimes the first attempt needs a moment to initialize

### If ports are already in use:

**Port 8000 (API):**
```bash
lsof -ti:8000 | xargs kill -9
```

**Port 3001 (Dashboard):**
```bash
lsof -ti:3001 | xargs kill -9
```

## Quick Commands Reference

From the root directory (`/Users/snehalal/Documents/VS code /Cue/Cue`):

```bash
# Build extension
cd extension && npm run build

# Start API server (Terminal 1)
cd server && source venv/bin/activate && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Start dashboard (Terminal 2)
cd cue && npm start
```

## What Each Component Does

- **Extension** (`extension/`): The floating Halo strip that appears on webpages
- **API Server** (`server/`): Handles AI requests and backend processing (port 8000)
- **Dashboard** (`cue/`): React app for viewing saved sessions (port 3001, optional)

## Notes

- The "Hey Cue" feature works on **any webpage** - the extension injects the floating strip
- Wake word detection runs continuously in the background (when not recording/live)
- Transcription automatically starts after wake word detection
- Auto-send triggers after 1.5 seconds of silence
- Wake word detection resumes automatically after transcription completes

