# cue - AI Meeting Summarizer

A Chrome extension that records meetings, transcribes them, and generates both text summaries and AI-powered video explanations using Gemini and Veo 3. Includes a React web app for viewing all recorded sessions.

![cue](https://img.shields.io/badge/Chrome-Extension-blue?style=flat-square)
![Gemini](https://img.shields.io/badge/Powered%20by-Gemini-purple?style=flat-square)
![Veo 3](https://img.shields.io/badge/Video%20by-Veo%203-green?style=flat-square)

## Features

- 🎙️ **Audio Recording** - Capture meeting audio directly from any tab (including YouTube videos)
- 📝 **Transcription** - Convert speech to text using Gemini Native Audio
- 🧠 **AI Summary** - Generate structured summaries with Gemini (key points, decisions, action items)
- 🎬 **Video Explanations** - Create AI-generated explainer videos with Veo 3
- 🎨 **Smart Style Selection** - Gemini decides the best visualization style (diagrams, whiteboard, presenter, story)
- 📚 **Session Library** - React web app to view all recorded sessions and summaries
- 💾 **MongoDB Integration** - Persistent storage of all sessions with backend API
- 🌐 **Halo Strip UI** - Persistent toolbar injected into webpages for easy access

## Architecture

```
Audio Recording → Gemini Transcription → Gemini Summary → Veo 3 Video → MongoDB Storage → React Library
```

## Prerequisites

1. **Node.js 18+** installed
2. **Google Cloud account** with:
   - Gemini API access
   - Veo 3 API access
3. **MongoDB Atlas** account (free tier works)
4. **Chrome browser**

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/Siriapps/Cue.git
cd Cue
npm install
```

### 2. Configure API Keys

Edit `extension/utils/constants.js` and add your API keys:

```javascript
export const CONFIG = {
  GEMINI_API_KEY: 'your-gemini-api-key',
  VEO_API_KEY: 'your-veo-api-key',
  MONGODB_API_URL: 'http://localhost:3000',
  LIBRARY_URL: 'http://localhost:3001'
};
```

### 3. Backend API Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env` file:**
   Create a file named `.env` in the `backend/` directory:
   ```
   DB_PASSWORD=your_mongodb_password_here
   PORT=3000
   ```
   Replace `your_mongodb_password_here` with your actual MongoDB password.

4. **Start the backend server:**
   ```bash
   npm start
   ```
   
   You should see:
   ```
   ✅ Connected to MongoDB Atlas
   📁 Collection: sessions
   🚀 cue API running on http://localhost:3000
   ```

5. **Test the connection:**
   Open your browser and go to:
   ```
   http://localhost:3000/health
   ```
   
   You should see:
   ```json
   {
     "status": "ok",
     "database": "connected",
     "collection": "sessions"
   }
   ```

### 4. React Library App Setup

1. **Navigate to cue directory:**
   ```bash
   cd cue
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the React app:**
   ```bash
   npm start
   ```
   
   The app will run on `http://localhost:3001`

### 5. Build Chrome Extension

1. **Build the extension:**
   ```bash
   npm run build
   ```

2. **Load in Chrome:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## MongoDB Atlas Setup

### Quick Setup

1. **Create MongoDB Atlas Account**
   - Go to https://www.mongodb.com/cloud/atlas
   - Sign up for free account
   - Create a free cluster (M0)

2. **Get Connection String**
   - In Atlas dashboard, click "Connect"
   - Choose "Connect your application"
   - Copy the connection string
   - The connection string format is:
     ```
     mongodb+srv://siriapps3_db_user:<password>@cue.garehsg.mongodb.net/?appName=cue
     ```

3. **Database Schema**
   
   The database `cue` and collection `sessions` will be created automatically. The schema:
   ```javascript
   {
     sessionId: String (indexed, unique),
     title: String,
     createdAt: Date,
     duration: Number,
     transcript: String,
     summary: Object,
     videoUrl: String,
     videoScript: Object,
     hasVideo: Boolean,
     metadata: Object
   }
   ```

### Fallback Behavior

If MongoDB is not configured or fails, the extension automatically:
- Saves to Chrome local storage
- Library page loads from Chrome storage
- All features work offline

## Usage

### Recording a Session

1. **Navigate to any webpage** (works with YouTube videos, Google Meet, etc.)
2. **Look for the Halo Strip** at the top of the page
3. **Click "Start Session"** to begin tracking
4. **Click "Go Live"** to start recording audio
5. **Have your meeting** - cue will capture everything
6. **Click "Stop Recording"** when finished
7. **Wait for processing** - transcription → summary → video generation
8. **View your summary** - Text summary + AI-generated video explanation appears in overlay

### Using Ask AI

- Click "Ask AI" in the Halo Strip
- Type your question about the current webpage
- Get AI-powered suggestions and analysis

### Viewing Sessions

1. **Click "Library"** in the Halo Strip
2. Opens the React library app at `http://localhost:3001`
3. Browse all recorded sessions
4. Search and filter sessions
5. Click any session card to view details

## Development

### Extension Development

For development with hot reloading:
```bash
npm run dev
```

This will watch for file changes and rebuild automatically.

### Backend Development

For backend development with auto-reload:
```bash
cd backend
npm run dev
```

### React App Development

The React app runs with hot reload by default:
```bash
cd cue
npm start
```

## Project Structure

```
Cue/
├── extension/              # Chrome extension
│   ├── manifest.json       # Extension configuration
│   ├── background/        # Service worker & API integrations
│   │   ├── background.js  # Main orchestrator
│   │   ├── audio-capture.js
│   │   ├── transcription.js
│   │   ├── gemini-service.js
│   │   ├── veo-service.js
│   │   └── mongodb-service.js
│   ├── content/           # Content scripts
│   │   ├── content.js     # Halo Strip injection
│   │   └── halo-strip.css
│   ├── popup/             # Extension popup UI
│   ├── summary/           # Summary display page
│   ├── library/           # Library page (extension version)
│   └── utils/
│       └── constants.js   # Configuration
├── backend/               # Express.js API
│   ├── server.js          # Main API server
│   └── package.json
├── cue/                   # React library app
│   ├── src/
│   │   ├── App.js
│   │   ├── App.css
│   │   └── components/
│   └── package.json
└── dist/                  # Built extension (gitignored)
```

## API Endpoints

The backend API provides:

- `GET /` - Health check
- `GET /health` - Health check with database connection
- `POST /sessions` - Save a new session
- `GET /sessions` - Get all sessions (supports `?filter=today&search=query`)
- `GET /sessions/:id` - Get a single session by ID
- `DELETE /sessions/:id` - Delete a session
- `POST /videos/upload` - Upload video (stores URL)

### Testing the API

```bash
# Health check
curl http://localhost:3000/health

# Get all sessions
curl http://localhost:3000/sessions

# Save a test session
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Session","summary":{"title":"Test"}}'
```

## API Integration

### Gemini

- **Transcription**: Converts audio to text using Gemini Native Audio
- **Text Summary**: Extracts key points, decisions, action items, and meeting mood
- **Video Script**: Generates scene-by-scene video script with automatic style selection
- **Context Analysis**: Analyzes webpage content for AI suggestions

### Veo 3

- Generates 30-60 second explainer videos
- Styles: Animated diagrams, whiteboard, presenter, story narrative
- Automatic style selection based on content analysis

## Key Innovation

**Intelligent Style Selection**: Unlike typical AI tools that generate one-size-fits-all outputs, cue uses Gemini to analyze meeting content and choose the optimal visualization style:

| Meeting Type | Gemini's Choice | Video Style |
|--------------|-----------------|-------------|
| Technical discussion | "Complex concepts need diagrams" | Animated flowcharts |
| Brainstorming | "Creative ideas need energy" | Whiteboard sketches |
| Status update | "Facts need clarity" | Professional presenter |
| Problem-solving | "Journey needs narrative" | Story-driven animation |

## Deployment

### Backend Deployment

Deploy the backend API to:
- **Vercel**: `vercel`
- **Railway**: Connect GitHub repo
- **Render**: Create Web Service

Update `extension/utils/constants.js` with your deployed URL:
```javascript
MONGODB_API_URL: 'https://your-api.vercel.app'
```

### React App Deployment

Deploy the React app to:
- **Vercel**: `cd cue && vercel`
- **Netlify**: Connect GitHub repo
- **GitHub Pages**: Use `npm run build` and deploy `build/` folder

Update `extension/utils/constants.js`:
```javascript
LIBRARY_URL: 'https://your-react-app.vercel.app'
```

## Troubleshooting

### Backend Connection Error
- Make sure your MongoDB password is correct in `backend/.env`
- Check that your IP is whitelisted in MongoDB Atlas (Network Access)
- Verify the connection string format

### Port Already in Use
- Change `PORT=3001` in `backend/.env` and update extension constants
- Or change React app port: `PORT=3002 npm start` in `cue/` directory

### Extension Not Working
- Make sure backend is running on `http://localhost:3000`
- Check that API keys are correctly set in `extension/utils/constants.js`
- Rebuild extension: `npm run build` and reload in Chrome

### Database Not Found
- MongoDB will create the database automatically on first insert
- Or create it manually in Atlas dashboard

## License

MIT License

## Credits

- Built with ❤️ using Google Gemini and Veo 3
- Chrome Extension APIs
- React for UI components
- MongoDB Atlas for persistent storage
