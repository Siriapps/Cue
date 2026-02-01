# Merge Resolution Summary: feature/test (main + feature/call_ai)

Resolved all merge conflicts with **main as base** and **feature/call_ai** (Call AI / voice) preserved.

---

## Files Resolved

### cue/
| File | Resolution |
|------|------------|
| **package.json** | **Combined** both: kept main deps (`@react-three/*`, `@supabase/supabase-js`) and added call_ai deps (`@picovoice/porcupine-web`, `@picovoice/web-voice-processor`). |
| **package-lock.json** | No conflict markers found. Run `npm install` in `cue/` to refresh lockfile after package.json changes. |
| **src/App.js** | **Main base**: kept Landing, Login, GoogleActivity, MosaicField, DashboardLayout, auth, config. **Added**: `DashboardHalo` import and `{isAuthenticated && <DashboardHalo user={user} />}` in the return. Kept `handleLogin`, `handleLogout`, `ProtectedRoute`, and full Routes layout. |
| **src/components/DashboardHalo.js** | **Merged**: main's `config` and `cueLogo`; call_ai's voice (useSpeechRecognition, voiceUtils, refs, autoSendQuery, handleTranscript, handleFinalTranscript, useEffects, handleMicClick). `ADK_API_URL = config.API_BASE_URL`. |

### extension/
| File | Resolution |
|------|------------|
| **public/manifest.json** | **Merged**: main's permissions (`history`, `identity`) and oauth2; call_ai's extra host_permissions (docs, sheets, drive, youtube, meet, calendar, mail, gmail, etc.). |
| **dist/manifest.json** | Same resolution as public/manifest.json. |
| **dist/content.js** | **Regenerated** by running `npm run build:extension` (no manual edit). |
| **dist/background.js** | **Regenerated** by running `npm run build:extension` (no manual edit). |
| **src/background/index.ts** | **Main base**: kept AUDIO_CHUNK, GOOGLE_LOGIN/LOGOUT, CHECK_LOGIN, USER_VIEWED_SUGGESTIONS, TASK_ACTION, GET_TRAJECTORY, GET_SUGGESTION_STATE, and full task sync WebSocket. **Added**: PERMISSION_GRANTED handler (call_ai) for wake word permission retry. Fixed try/catch structure in task sync onmessage. |
| **src/content/halo.tsx** | **Merged**: main's context store, command preview, predicted tasks, replaceServiceKeywords, toggleChatMic, handleConfirmCommand, handleCancelCommand, handleLogin, and chat UI with command hints. call_ai's useWakeWord, useSpeechRecognition, autoSendQuery, handleTranscript, handleFinalTranscript, refs, and useEffects. Chat input supports both chatMicListening and isTranscribing; placeholder/value/disabled use `(chatMicListening \|\| isTranscribing)`. |
| **src/content/index.tsx** | **Merged**: call_ai's skip for `chrome-extension://` and `chrome://`; main's init (DOMContentLoaded or immediate initializeUI). |
| **src/content/halo.css** | **Merged**: main's context button styles; call_ai's ask-ai.recording, recording-pulse, pulse-indicator, pulse-ring. Kept full PREDICTED TASKS section; added Wake Word indicator and .wake-word-mic-icon. |

### server/
| File | Resolution |
|------|------------|
| **app/db/mongo.py** | No conflict markers found; left unchanged. |
| **app/main.py** | No conflict markers found; left unchanged. |
| **requirements.txt** | No conflict markers found; left unchanged. |

---

## What to Keep / Combine (by file)

- **cue/package.json**: Keep **both** dependency sets (main + call_ai).
- **cue/src/App.js**: Keep **main** layout and routes; **add** DashboardHalo when authenticated.
- **cue/src/components/DashboardHalo.js**: Keep **main** config/logo; **add** call_ai voice pipeline (speech recognition, auto-send, mic click).
- **extension/public/manifest.json**: Keep **main** identity + oauth2; **add** call_ai host_permissions.
- **extension/src/background/index.ts**: Keep **main** handlers and task sync WebSocket; **add** PERMISSION_GRANTED.
- **extension/src/content/halo.tsx**: Keep **main** context, commands, tasks, chat mic; **add** call_ai wake word, speech recognition, autoSendQuery, and merged chat input.
- **extension/src/content/index.tsx**: Keep **main** init; **add** call_ai protocol skip.
- **extension/src/content/halo.css**: Keep **both** context button and call_ai recording/pulse/Wake Word styles.

---

## Next Steps for Local Testing

1. **Dashboard (cue)**  
   ```bash
   cd cue && npm install && npm start
   ```
   - Confirm DashboardHalo shows when logged in and Ask AI / Mic work.

2. **Extension**  
   - Extension is already built (`extension/dist/` updated).
   - In Chrome: Load unpacked from `extension/dist/`.
   - Test Halo Strip: context, Ask AI, command preview, voice (mic + wake word if enabled).

3. **API**  
   ```bash
   npm run start:api
   ```
   - Ensure server runs and extension/dashboard can reach it.

4. **Optional: refresh cue lockfile**  
   ```bash
   cd cue && npm install
   ```

---

## Notes

- **.pyc** files were ignored as requested.
- **extension/dist/content.js** and **extension/dist/background.js** were fixed by rebuilding from resolved source, not by editing the built files.
- If you still see conflicts in **cue/package-lock.json**, run `cd cue && npm install` to regenerate it from the resolved **package.json**.
