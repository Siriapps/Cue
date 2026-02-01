# Startup Instructions for Cue

## Prerequisites
- macOS System Permissions: **System Settings** → **Privacy & Security** → **Microphone** → Enable **Google Chrome**
- Chrome Extension: Loaded from `extension/dist` folder

## Startup Order (IMPORTANT - Follow This Order)

### Step 1: Build the Extension (One-time, or when extension code changes)
```bash
cd extension
npm run build
```
This creates the `dist/` folder that Chrome loads.

### Step 2: Start the Python API Server (Port 8000)
Open a **new terminal window** and run:
```bash
cd server
source venv/bin/activate  # On macOS/Linux
# OR: venv\Scripts\activate  # On Windows
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Keep this terminal open. You should see: `Uvicorn running on http://0.0.0.0:8000`

### Step 3: Start the React Dashboard (Port 3001)
Open **another new terminal window** and run:
```bash
cd cue
npm start
```
Keep this terminal open. It will automatically open `http://localhost:3001` in your browser.

## Quick Start Commands (From Root Directory)

From the root directory (`/Users/snehalal/Documents/VS code /Cue/Cue`), you can use:

```bash
# Build extension
npm run build:extension

# Start API server (in one terminal)
npm run start:api

# Start dashboard (in another terminal)
npm run start:dashboard
```

## After Starting

1. **Load the Extension in Chrome**:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder

2. **Test the Microphone**:
   - Navigate to `http://localhost:3001`
   - Click "Ask AI" or the microphone button
   - If you see permission errors, check macOS System Settings → Privacy & Security → Microphone

## Troubleshooting

### If microphone still doesn't work:
1. **Quit Chrome completely** (Cmd+Q) and reopen
2. **Reload the extension** in `chrome://extensions/`
3. **Check macOS permissions**: System Settings → Privacy & Security → Microphone → Chrome must be enabled
4. **Clear browser cache**: Chrome → Settings → Privacy → Clear browsing data → Cached images and files

### If ports are already in use:
- Port 8000 (API): Kill process: `lsof -ti:8000 | xargs kill -9`
- Port 3001 (Dashboard): Kill process: `lsof -ti:3001 | xargs kill -9`

## Port Summary
- **8000**: Python FastAPI server (backend)
- **3001**: React dashboard (frontend)
- **Extension**: Loaded in Chrome from `extension/dist`

