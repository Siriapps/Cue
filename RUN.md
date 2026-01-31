# cue – Run

From the **project root**, start the API and dashboard. Build the extension when you change extension code.

## Start the application

**Terminal 1 – API (port 8000):**

```bash
npm run start:api
```

**Terminal 2 – Dashboard (port 3001):**

```bash
npm run start:dashboard
```

Keep both running. Open http://localhost:8000/docs and http://localhost:3001 in the browser. Load the extension from **extension/dist** in Chrome (see SETUP.md if needed).

## Rebuild extension (after code changes)

```bash
npm run build
```

Then reload the extension in **chrome://extensions**.
