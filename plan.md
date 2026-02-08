# GetContext Merge + Feature Integration Plan

## Merge Strategy
Main already has context_store.ts, chat_capture.ts, and context-aware task generation.
Merge GetContext into main (keeping main for conflicts), then add the requested features.

## Step 1: Git Merge
- `git merge origin/GetContext` keeping main's code for all conflicts
- This formally brings the branches together

## Step 2: Halo Context Settings Panel
**File**: `extension/src/content/halo.tsx` + `halo.css`
- Add settings section at bottom of existing Context panel:
  - Suggestion frequency dropdown (30s / 1min / 2min / 5min)
  - Wake phrase input (default "hey cue")
  - Voice activation toggle (on/off)
- Store in `chrome.storage.local`
- Background reads frequency setting to control auto-suggest cooldown

## Step 3: Voice Wake Phrase
**File**: `extension/src/content/halo.tsx`
- Use Web Speech API (`webkitSpeechRecognition`) for continuous listening
- When wake phrase detected → expand halo, open Ask AI panel
- Toggle via Context settings

## Step 4: Wire Background to Settings
**File**: `extension/src/background/index.ts`
- Read `cue_suggest_frequency` from chrome.storage.local
- Use it for `GLOBAL_SUGGEST_COOLDOWN_MS` instead of hardcoded 30s
- Listen for storage changes to update in real-time

## Step 5: Mosaic - Top 3 Most-Used Websites
**File**: `cue/src/pages/MosaicField.js`
- Replace GitHub/Join static icons with dynamic top-3 most-visited domains
- Source: context_store recent_searches → extract unique domains → sort by frequency
- Show favicons via Google's favicon API
- Clicking opens the site

## Step 6: Fix Login Redirect on Reload
**File**: `cue/src/auth/googleAuth.js`
- Don't clear auth on token expiry check (keep user logged in)

## Step 7: Fix Excessive Backend Requests on Dismiss
**File**: `cue/src/pages/GoogleActivity.js`
- Make dismiss optimistic-only (remove from state, PATCH in background)
- Don't refetch all tasks when WebSocket sends TASKS_UPDATED for a dismiss

## Step 8: Build Extension + React App
- `npm run build` in root (extension)
- `npm run build` in cue/ (React app)
