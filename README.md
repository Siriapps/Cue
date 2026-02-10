# Cue - Intelligent Chrome Extension for Predictive Work Automation

<p align="center"> <em>Transform passive browsing into active collaboration. Turn conversations into action.</em> </p>

## 🎯 Overview

Modern professionals don't struggle with a lack of information—they struggle with what happens after information. Meetings end, videos finish, podcasts pause, and suddenly there's a familiar burden: What did we decide? What do I need to do? Where do I put this?

Cue flips that model. Instead of building another tool that records what happened, we asked a different question: What if the system did the follow-up thinking for you?

Cue is an intelligent Chrome extension that turns your browser from a passive viewing surface into an active collaborator. Whether you're in a Google Meet, watching a technical YouTube video, or listening to a podcast, Cue listens alongside you and then handles the work that normally comes after.

## ✨ What It Does

Cue doesn't just capture content—it understands it, reasons through it, and turns it into action.

### Core Capabilities

- 🎙️ Intelligent Audio Capture - Records audio from any tab (Google Meet, YouTube, podcasts, any web content)
- 📝 Advanced Transcription - Leverages Gemini's Native Audio API for human-level understanding of tone, urgency, and speaker emotion
- 🧠 Reasoning, Not Summaries - Uses chain-of-thought prompting to distinguish casual discussion from concrete decisions
- ✅ Automated Task Extraction - Generates structured action items, decisions, and key points without manual input
- 📊 Sentiment Analysis - Detects emotional context and urgency to prioritize appropriately
- 📧 Google Workspace Integration - Automatically drafts emails, creates documents, and adds calendar events
- 🎬 AI-Generated Explainer Videos - Creates short visual summaries using Veo 3 for quick context review
- 📚 Searchable Library - Web dashboard to browse, search, and replay all recorded sessions

## The Workflow

- Start a session - The Halo Strip toolbar appears on any web page
- Capture live - Tab audio is streamed and processed in real-time
- Stop and process - Backend transcribes, analyzes, and extracts actionable insights
- Take action - Results appear in your dashboard with direct integrations to Google apps
- Never repeat work - All sessions are stored and searchable in your personal library

## 🏗️ Architecture

Cue employs a three-tier architecture designed for high-concurrency and web-scale context processing:

```
┌─────────────────────────┐
│   Chrome Extension      │
│  (TypeScript/React)     │
│  - Halo Strip UI        │
│  - Audio Capture        │
│  - Service Worker       │
└───────────┬─────────────┘
            │
            │ HTTP/WebSocket
            │
┌───────────▼─────────────┐
│   FastAPI Backend       │
│   (Python - Port 8000)  │
│  - Audio Processing     │
│  - Gemini Integration   │
│  - Task Extraction      │
│  - Google Apps API      │
└───────────┬─────────────┘
            │
    ┌───────┴────────┐
    │                │
┌───▼────┐    ┌─────▼──────┐
│ Gemini │    │  MongoDB   │
│  API   │    │  Storage   │
└────────┘    └────────────┘

┌─────────────────────────┐
│   React Dashboard       │
│   (Port 3001)           │
│  - Session Library      │
│  - Reels Feed           │
│  - Search & Replay      │
└─────────────────────────┘
```

### Data Flow

- Extension Layer - Captures tab audio via Chrome's tabCapture API and streams to backend
- Processing Layer - FastAPI backend manages concurrent streams, handles Gemini API calls, and coordinates task extraction
- Storage Layer - MongoDB stores sessions, transcripts, summaries, tasks, and generated media
- Presentation Layer - React dashboard provides searchable interface with WebSocket progress updates

## 🚀 Technology Stack

### Frontend

- Chrome Extension: TypeScript, React, Vite
- Dashboard: React (port 3001)
- UI Components: Custom Halo Strip toolbar, session recorder

### Backend

- API Framework: FastAPI (Python, port 8000)
- AI Models:
  - Gemini Native Audio API for transcription
  - Chain-of-thought prompting for reasoning
  - Veo 3 for video generation
- Storage: MongoDB (Atlas compatible)
- Real-time: WebSocket for progress updates

## Key Features

### Native Multimodal Processing

By feeding raw audio directly into Gemini's Native Audio API, we achieve perception of tone, urgency, and speaker emotion—leading to "human-level" understanding of intent that normal summaries miss.

### Higher Audio Accuracy

Successfully leveraging Gemini's native audio capabilities provides significantly higher accuracy in technical jargon detection compared to standard Whisper-based implementations.

### Context Preservation for Correct Reasoning

The system preserves enough context for the model to reason accurately, distinguishing casual commentary from concrete decisions through structured context feeding.

### Actionable Across Google Applications

Cue doesn't stop at understanding conversations—it acts on them through integrations that:
- Draft emails in Gmail
- Create documents in Google Docs
- Add events to Google Calendar
- Turn insights directly into execution

## 🎓 What We Learned

### Chrome Extension & Permissions

Building a Chrome extension that respects the browser's permission model while reliably accessing audio and context from active tabs required careful handling to avoid interruptions, blocked access, or repeated permission prompts.

### Context is Critical for Reasoning

Feeding the model raw audio transcription alone wasn't enough. Supplying structured context from the session and surrounding discussion was essential to help Gemini differentiate casual commentary from actual decisions and action items.

### Fully Automated Workflow

We successfully built a system where users can finish a session and immediately have a structured task list without clicking a single button—the highest form of automation.

## 🔮 What's Next

### Visual Context Enhancement

Once Cue analyzes sessions and generates structured tasks, we plan to leverage Nano Banana and Veo 3 to create short clips or key images that capture the most important moments of a meeting or video. This will allow users to:
- See exactly what happened at critical moments
- Understand decisions at a glance
- Quickly grasp context without rereading anything

By combining task extraction with visual highlights, Cue will make follow-up actions faster, clearer, and more intuitive.

## 📦 Installation & Setup

### Prerequisites

- Node.js (v18+)
- Python (3.9+)
- MongoDB (local or Atlas)
- Chrome browser
- Gemini API key

### Quick Start

Clone the repository

```bash
git clone https://github.com/Siriapps/Cue.git
cd Cue
```

Install dependencies

```bash
npm install
cd server && pip install -r requirements.txt
```

Configure environment

```bash
cp .env.example .env
# Add your Gemini API key and MongoDB connection string
```

Build the extension

```bash
npm run build
```

Load extension in Chrome

1. Navigate to chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extension/build directory

Start the backend

```bash
cd server
python -m uvicorn main:app --reload --port 8000
```

Start the dashboard

```bash
cd cue
npm start
```

For detailed setup instructions, see SETUP.md.  
For running instructions, see RUN.md.

## 📚 Documentation

- SETUP.md - Detailed installation and configuration guide
- RUN.md - Instructions for running all components
- CLAUDE.md - Development notes and AI assistance context

## 🎯 Use Cases

### For Professionals

- Automatic meeting minutes with action items
- Task extraction from product demos
- Decision documentation from strategy sessions
- Email drafts from client calls

### For Learners

- Note generation from lecture videos
- Key concept extraction from tutorials
- Study guides from educational podcasts
- Visual summaries for quick review

### For Researchers

- Interview transcription and analysis
- Insight extraction from presentations
- Automated literature review notes
- Sentiment tracking across discussions

## 🏆 Accomplishments

We're proud of:
- ✅ Fully Automated Workflow - Users finish sessions with structured task lists without clicking a button
- ✅ Higher Audio Accuracy - Native Gemini audio processing beats standard Whisper implementations
- ✅ Actionable Integration - Direct execution inside Google apps turns insights into action
- ✅ Browser Permissions Mastery - Reliable audio access while respecting Chrome's security model
- ✅ Context-Aware Reasoning - Accurate task prioritization and decision detection through improved context handling

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines for more information.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

Built with:
- Gemini API for advanced AI capabilities
- Veo 3 for video generation
- FastAPI for high-performance backend
- React for modern UI
- MongoDB for flexible data storage

<p align="center"> Made with ❤️ by the Cue Team </p>
