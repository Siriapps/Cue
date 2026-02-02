import os
import uuid
import asyncio
from typing import Any, Dict, List, Optional, Set
from datetime import datetime

from pathlib import Path
from dotenv import load_dotenv  # type: ignore[import-untyped]
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request  # type: ignore[import-untyped]
from fastapi.middleware.cors import CORSMiddleware  # type: ignore[import-untyped]
from fastapi.responses import JSONResponse  # type: ignore[import-untyped]
from fastapi.exceptions import RequestValidationError  # type: ignore[import-untyped]
from pydantic import BaseModel  # type: ignore[import-untyped]

# #region agent log
try:
    from app.agents.embeddings import generate_embedding
    from app.agents.prism import summarize_context
    from app.agents.scribe import process_audio_chunk
    from app.agents.ask_ai import ask_ai
    from app.agents.motion import extract_motions, parse_motion_to_animation_hint
    from app.agents.puppeteer import generate_pose_for_motion, generate_pose_sequence, get_preset_pose
    from app.agents.transcriber import transcribe_audio, generate_session_summary
    from app.agents.gemini_client import generate_session_image
except ImportError as e:
    import traceback
    import json as _json
    import time as _time
    _log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".cursor", "debug.log")
    try:
        _entry = {"location": "main.py:imports", "message": "ImportError on agent imports", "data": {"error": str(e), "traceback": traceback.format_exc()}, "timestamp": int(_time.time() * 1000), "sessionId": "debug-session", "hypothesisId": "H1"}
        with open(_log_path, "a", encoding="utf-8") as _f:
            _f.write(_json.dumps(_entry, ensure_ascii=False) + "\n")
    except Exception:
        pass
    raise
# #endregion
from app.db.repository import (
    save_diagram_event,
    save_prism_summary,
    save_session,
    save_user,
    list_recent,
    list_sessions,
    update_session,
    get_session_by_id,
    list_google_activity,
    list_google_activity_recent,
    save_suggested_task,
    list_suggested_tasks,
    get_suggested_task_by_id,
    update_suggested_task,
    delete_suggested_task,
)

# Load environment variables from root .env
root_env_path = Path(__file__).resolve().parent.parent.parent / '.env'
load_dotenv(root_env_path)

# Helper to serialize MongoDB documents (convert ObjectId to string)
def serialize_doc(doc: Any) -> Any:
    """Recursively convert ObjectId and other non-serializable types to strings."""
    from bson import ObjectId
    if isinstance(doc, dict):
        return {k: serialize_doc(v) for k, v in doc.items()}
    elif isinstance(doc, list):
        return [serialize_doc(item) for item in doc]
    elif isinstance(doc, ObjectId):
        return str(doc)
    elif isinstance(doc, datetime):
        s = doc.isoformat()
        if s and "Z" not in s and "+" not in s:
            s += "Z"
        return s
    return doc

app = FastAPI(title="cue ADK API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler to ensure all errors return JSON
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Ensure all exceptions return JSON responses."""
    import traceback
    error_trace = traceback.format_exc()
    print(f"[cue] Unhandled exception: {exc}")
    print(f"[cue] Traceback: {error_trace}")
    
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": str(exc),
            "detail": "An internal server error occurred"
        }
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors."""
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": "Validation error",
            "detail": str(exc)
        }
    )


# ================== DASHBOARD CONNECTION MANAGER ==================

class DashboardConnectionManager:
    """Manages WebSocket connections for dashboard progress updates."""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"Dashboard client connected. Total: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"Dashboard client disconnected. Total: {len(self.active_connections)}")
    
    @staticmethod
    def _serialize_for_json(obj: Any) -> Any:
        """Convert datetime (and similar) in dicts/lists to JSON-serializable form."""
        if isinstance(obj, datetime):
            return obj.isoformat() + "Z"
        if hasattr(obj, "isoformat") and callable(getattr(obj, "isoformat", None)):
            return obj.isoformat()
        if isinstance(obj, dict):
            return {k: DashboardConnectionManager._serialize_for_json(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [DashboardConnectionManager._serialize_for_json(v) for v in obj]
        return obj

    async def broadcast(self, message: Dict[str, Any]):
        """Broadcast message to all connected dashboards."""
        if not self.active_connections:
            print(f"[cue] No active dashboard connections to broadcast: {message.get('type', 'unknown')}")
            return
        message = self._serialize_for_json(message)
        print(f"[cue] Broadcasting {message.get('type', 'unknown')} to {len(self.active_connections)} dashboard(s)")
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
                print(f"[cue] Successfully sent {message.get('type', 'unknown')} to dashboard")
            except Exception as e:
                print(f"Failed to send to dashboard: {e}")
                disconnected.add(connection)
        
        # Clean up disconnected clients
        for conn in disconnected:
            self.active_connections.discard(conn)

# Global connection manager
dashboard_manager = DashboardConnectionManager()


@app.on_event("startup")
async def startup_change_stream():
    """Start MongoDB change stream watcher for sessions (requires replica set)."""
    try:
        from app.db.mongo import watch_sessions_collection
        import asyncio
        loop = asyncio.get_running_loop()
        def broadcast(msg):
            asyncio.run_coroutine_threadsafe(dashboard_manager.broadcast(msg), loop)
        watch_sessions_collection(broadcast)
        print("[cue] Change stream watcher started (sessions)")
    except Exception as e:
        print(f"[cue] Change stream not started: {e}")


# ================== REQUEST MODELS ==================

class SummarizeContextRequest(BaseModel):
    text: str
    source_url: Optional[str] = None
    title: Optional[str] = None


class ProcessAudioChunkRequest(BaseModel):
    audio_base64: str
    mime_type: str
    chunk_start_seconds: Optional[int] = None
    source_url: Optional[str] = None


class AskAIRequest(BaseModel):
    query: str
    page_title: Optional[str] = None
    current_url: Optional[str] = None
    selected_text: Optional[str] = None
    user_display_name: Optional[str] = None
    user_email: Optional[str] = None
    context_blob: Optional[str] = None


class SuggestRequest(BaseModel):
    context_blob: Optional[str] = None


class PoseRequest(BaseModel):
    pose_name: Optional[str] = None
    motions: Optional[List[Dict[str, Any]]] = None


class SessionSaveRequest(BaseModel):
    title: str
    source_url: str
    duration_seconds: int
    audio_base64: str
    mime_type: str


class SessionStartNotify(BaseModel):
    title: str
    source_url: str
    duration_seconds: int


class AuthGoogleRequest(BaseModel):
    access_token: str


class SuggestTasksRequest(BaseModel):
    context_blob: Optional[str] = None
    page_title: Optional[str] = None
    current_url: Optional[str] = None


class UpdateTaskRequest(BaseModel):
    status: Optional[str] = None  # pending, completed, dismissed


class ExecuteSuggestedTaskRequest(BaseModel):
    service: str
    action: str
    params: Dict[str, Any] = {}
    user_token: str = ""
    page_title: Optional[str] = None
    current_url: Optional[str] = None


# ================== BASE ENDPOINTS ==================

@app.get("/")
async def root() -> Dict[str, Any]:
    return {"status": "ok", "service": "cue ADK API"}


@app.post("/auth/google")
async def auth_google(payload: AuthGoogleRequest) -> Dict[str, Any]:
    """Verify Google access token and create/update user. Expects token from Chrome identity."""
    import httpx  # type: ignore[import-untyped]
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {payload.access_token}"},
                timeout=10.0,
            )
        if r.status_code != 200:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Invalid or expired token"},
            )
        data = r.json()
        user_data = {
            "email": data.get("email", ""),
            "name": data.get("name", ""),
            "picture": data.get("picture"),
        }
        user_id = save_user(user_data)
        return {"success": True, "user_id": user_id, "email": user_data["email"], "name": user_data["name"], "picture": user_data.get("picture")}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.post("/summarize_context")
async def summarize_context_endpoint(
    payload: SummarizeContextRequest,
) -> Dict[str, Any]:
    result = summarize_context(payload.text, payload.source_url, payload.title)
    save_prism_summary(payload.model_dump(), result)
    return result


@app.post("/process_audio_chunk")
async def process_audio_chunk_endpoint(
    payload: ProcessAudioChunkRequest,
) -> Dict[str, Any]:
    result = process_audio_chunk(
        audio_base64=payload.audio_base64,
        mime_type=payload.mime_type,
        chunk_start_seconds=payload.chunk_start_seconds,
        source_url=payload.source_url,
    )
    if result:
        save_diagram_event(payload.model_dump(), result)
    return result or {"type": "none"}


@app.get("/summaries")
async def list_summaries(limit: int = 20) -> Dict[str, Any]:
    return {"items": list_recent("summaries", limit=limit)}


@app.get("/diagrams")
async def list_diagrams(limit: int = 20) -> Dict[str, Any]:
    return {"items": list_recent("diagrams", limit=limit)}


@app.post("/ask_ai")
async def ask_ai_endpoint(payload: AskAIRequest) -> Dict[str, Any]:
    context = {
        "page_title": payload.page_title or "",
        "current_url": payload.current_url or "",
        "selected_text": payload.selected_text or "",
        "user_display_name": payload.user_display_name or "",
        "user_email": payload.user_email or "",
        "context_blob": payload.context_blob or "",
    }
    # Optional: include recent Google activity so the model is aware of recent actions
    try:
        activities = list_google_activity_recent(limit=10)
        if activities:
            lines = []
            for a in activities[:10]:
                s = a.get("service", "")
                act = a.get("action", "")
                det = a.get("details", {}) or {}
                if s == "gmail" and act == "send_email":
                    lines.append(f"sent email: {det.get('subject', 'email')}")
                elif s == "docs" and act == "create_document":
                    lines.append(f"created doc: {det.get('title', 'doc')}")
                elif s == "calendar" and act == "create_event":
                    lines.append(f"created event: {det.get('summary', 'event')}")
                elif s == "tasks" and act == "create_task":
                    lines.append(f"created task: {det.get('title', 'task')}")
                else:
                    lines.append(f"{s} {act}")
            context["recent_activity"] = "; ".join(lines)
        else:
            context["recent_activity"] = ""
    except Exception:
        context["recent_activity"] = ""
    result = ask_ai(payload.query, context)
    return result


@app.post("/suggest")
async def suggest_endpoint(payload: SuggestRequest) -> Dict[str, Any]:
    """Suggest next steps from context (recent searches + AI chat snippets)."""
    context_blob = (payload.context_blob or "").strip()
    if not context_blob:
        return {"success": False, "error": "No context provided"}
    query = (
        "Based on the following context (recent searches and AI chat snippets), "
        "suggest 1-3 concrete next steps I could take. Be brief and actionable."
    )
    context = {
        "page_title": "",
        "current_url": "",
        "selected_text": "",
        "user_display_name": "",
        "user_email": "",
        "context_blob": context_blob,
        "recent_activity": "",
    }
    result = ask_ai(query, context)
    return result


@app.post("/suggest_tasks")
async def suggest_tasks_endpoint(payload: SuggestTasksRequest) -> Dict[str, Any]:
    """
    Generate actionable task suggestions based on rich context.
    Fetches sessions and Google activity to enrich the context.
    Returns structured tasks that can be executed via MCP.
    """
    from app.agents.gemini_client import call_gemini
    import json
    import re

    context_blob = (payload.context_blob or "").strip()
    page_title = payload.page_title or ""
    current_url = payload.current_url or ""

    # Build rich context from multiple sources
    context_sections = []

    # Section 1: Recent searches and AI chats (from extension)
    if context_blob:
        context_sections.append(f"## Recent Searches and AI Chats\n{context_blob}")

    # Section 2: Recorded Cue sessions
    try:
        sessions = list_sessions(limit=10)
        if sessions:
            session_lines = []
            for s in sessions:
                title = s.get("title", "Untitled")
                url = s.get("source_url", "")
                summary = s.get("summary", {})
                tldr = summary.get("tldr", "") if isinstance(summary, dict) else ""
                key_points = summary.get("key_points", []) if isinstance(summary, dict) else []
                summary_text = tldr
                if key_points:
                    summary_text += " " + "; ".join(key_points[:3])
                session_lines.append(f"- {title} ({url}): {summary_text[:200]}")
            context_sections.append("## Recorded Cue Sessions\n" + "\n".join(session_lines))
    except Exception as e:
        print(f"[cue] Error fetching sessions for suggest_tasks: {e}")

    # Section 3: Recent Google activity
    try:
        activities = list_google_activity_recent(limit=10)
        if activities:
            activity_lines = []
            for a in activities[:10]:
                svc = a.get("service", "")
                act = a.get("action", "")
                det = a.get("details", {}) or {}
                if svc == "gmail" and act == "send_email":
                    activity_lines.append(f"- sent email: {det.get('subject', 'email')}")
                elif svc == "docs" and act == "create_document":
                    activity_lines.append(f"- created doc: {det.get('title', 'doc')}")
                elif svc == "calendar" and act == "create_event":
                    activity_lines.append(f"- created event: {det.get('summary', 'event')}")
                elif svc == "tasks" and act == "create_task":
                    activity_lines.append(f"- created task: {det.get('title', 'task')}")
                else:
                    activity_lines.append(f"- {svc} {act}")
            context_sections.append("## Recent Google Activity\n" + "\n".join(activity_lines))
    except Exception as e:
        print(f"[cue] Error fetching Google activity for suggest_tasks: {e}")

    # Section 4: Current page
    if page_title or current_url:
        context_sections.append(f"## Current Page\nTitle: {page_title}\nURL: {current_url}")

    full_context = "\n\n".join(context_sections)

    if not full_context.strip():
        return {"success": False, "error": "No context available to generate suggestions", "tasks": []}

    # Build the prompt for Gemini
    prompt = f"""You have the following context about the user's recent activity:

{full_context}

Based on this context, generate 1-5 concrete, actionable tasks that would be useful for the user.

For each task that can be done via Google services (Gmail, Calendar, Tasks, Docs, Drive, Sheets) or Antigravity (IDE prompt pasting), include the service, action, and params so the system can execute them when the user accepts.

Services and actions:
- gmail: draft (to, subject, body), send (to, subject, body)
- calendar: create (title/summary, description, date, time)
- tasks: add (title, notes, due)
- docs: create (title, content)
- sheets: create (title)
- gemini_chat: open (prompt - the full question/prompt to ask Gemini, context - any helpful context)
- antigravity: search (prompt - the search/research prompt with full context)
- openai_studio: open (prompt - the full question/prompt to ask ChatGPT)

Be specific and use context (e.g., hackathon name, project ideas, email subjects) so created docs/emails/events are relevant.

Return ONLY a JSON array of objects with these fields:
- title: short task label (string)
- description: one or two sentences (string)
- service: one of gmail, calendar, tasks, docs, sheets, gemini_chat, antigravity, openai_studio, or null if informational only
- action: the action name or null
- params: object with fields needed for the action, or null

Example:
[
  {{"title": "Draft hackathon submission email", "description": "Prepare email to submit your hackathon project", "service": "gmail", "action": "draft", "params": {{"to": "hackathon@example.com", "subject": "Hackathon Submission", "body": "Hi,\\n\\nPlease find attached our hackathon submission..."}}}},
  {{"title": "Create project plan document", "description": "Document outlining the project roadmap", "service": "docs", "action": "create", "params": {{"title": "Project Plan", "content": "# Project Plan\\n\\n## Goals\\n..."}}}},
  {{"title": "Ask Gemini about API integration", "description": "Get help with integrating the Gemini API", "service": "gemini_chat", "action": "open", "params": {{"prompt": "How do I integrate the Gemini API with my React application? I need to handle streaming responses and error handling.", "context": "Working on a hackathon project"}}}},
  {{"title": "Research latest AI trends", "description": "Use Antigravity to research AI developments", "service": "antigravity", "action": "search", "params": {{"prompt": "What are the latest developments in multimodal AI models for 2024? Focus on practical applications."}}}}
]

Return ONLY the JSON array, no markdown or explanation."""

    try:
        gemini_result = call_gemini(
            parts=[{"text": prompt}],
            response_mime_type="application/json",
        )

        # Parse the response
        tasks = []
        if isinstance(gemini_result, dict) and "error" in gemini_result:
            print(f"[cue] Gemini error in suggest_tasks: {gemini_result['error']}")
            return {"success": False, "error": gemini_result["error"], "tasks": []}

        raw_text = ""
        if isinstance(gemini_result, dict):
            tasks = gemini_result if isinstance(gemini_result, list) else [gemini_result]
        elif isinstance(gemini_result, list):
            tasks = gemini_result
        else:
            raw_text = getattr(gemini_result, "raw_text", None) or str(gemini_result)
            # Try to extract JSON array
            json_match = re.search(r'\[[\s\S]*\]', raw_text)
            if json_match:
                json_str = json_match.group()
                try:
                    tasks = json.loads(json_str)
                except json.JSONDecodeError:
                    # Try fixing common issues: single quotes -> double quotes
                    # Replace single quotes that are used as JSON delimiters
                    fixed_json = json_str.replace("'", '"')
                    # Remove trailing commas before ] or }
                    fixed_json = re.sub(r',\s*([}\]])', r'\1', fixed_json)
                    try:
                        tasks = json.loads(fixed_json)
                    except json.JSONDecodeError:
                        # Last resort: use ast.literal_eval for Python-style dicts
                        import ast
                        try:
                            tasks = ast.literal_eval(json_str)
                        except (ValueError, SyntaxError):
                            # Give up, create fallback task
                            tasks = [{"title": "Suggestion", "description": raw_text[:500], "service": None, "action": None, "params": None}]
            else:
                # Fallback: create single informational task
                tasks = [{"title": "Suggestion", "description": raw_text[:500], "service": None, "action": None, "params": None}]

        # Validate and save tasks to MongoDB
        saved_tasks = []
        for task in tasks:
            if not isinstance(task, dict):
                continue
            task_data = {
                "title": task.get("title", "Task"),
                "description": task.get("description", ""),
                "service": task.get("service"),
                "action": task.get("action"),
                "params": task.get("params"),
                "status": "pending",
                "source_context": {
                    "page_title": page_title,
                    "current_url": current_url,
                },
            }
            task_id = save_suggested_task(task_data)
            task_data["id"] = task_id
            saved_tasks.append(task_data)

        if saved_tasks:
            await dashboard_manager.broadcast({"type": "SUGGESTED_TASKS_UPDATE"})
            # Also broadcast to connected extensions
            await extension_manager.send_tasks(serialize_doc(saved_tasks[:5]))
        return {"success": True, "tasks": serialize_doc(saved_tasks)}

    except Exception as e:
        print(f"[cue] Error in suggest_tasks: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e), "tasks": []}


@app.get("/suggested_tasks")
async def get_suggested_tasks(limit: int = 50, status: Optional[str] = None) -> Dict[str, Any]:
    """Get list of suggested tasks. Optional status filter: pending, in_progress, completed, dismissed."""
    tasks = list_suggested_tasks(limit=limit, status=status)
    return {"success": True, "tasks": tasks}


@app.patch("/suggested_tasks/{task_id}")
async def update_task_endpoint(task_id: str, payload: UpdateTaskRequest) -> Dict[str, Any]:
    """Update a suggested task (e.g., mark as completed or dismissed)."""
    updates = {}
    if payload.status:
        if payload.status not in ["pending", "in_progress", "completed", "dismissed"]:
            return {"success": False, "error": "Invalid status. Must be: pending, in_progress, completed, or dismissed"}
        updates["status"] = payload.status

    if not updates:
        return {"success": False, "error": "No updates provided"}

    success = update_suggested_task(task_id, updates)
    if success:
        # Broadcast updated task list to dashboard for real-time sync
        updated_tasks = list_suggested_tasks(limit=50)
        await dashboard_manager.broadcast({
            "type": "TASKS_UPDATED",
            "tasks": updated_tasks
        })
        return {"success": True, "message": f"Task {task_id} updated"}
    return {"success": False, "error": "Task not found or update failed"}


@app.delete("/suggested_tasks/{task_id}")
async def delete_task_endpoint(task_id: str) -> Dict[str, Any]:
    """Delete a suggested task."""
    success = delete_suggested_task(task_id)
    if success:
        return {"success": True, "message": f"Task {task_id} deleted"}
    return {"success": False, "error": "Task not found or delete failed"}


@app.post("/pose")
async def get_pose(payload: PoseRequest) -> Dict[str, Any]:
    """Get a pose from a preset name or generate from motions."""
    if payload.pose_name:
        pose = get_preset_pose(payload.pose_name)
        if pose:
            return pose
        return {"error": f"Unknown pose: {payload.pose_name}"}
    
    if payload.motions:
        hints = [parse_motion_to_animation_hint(m) for m in payload.motions]
        return generate_pose_sequence(hints)
    
    return {"error": "Provide either pose_name or motions"}


# ================== SESSION ENDPOINTS ==================

@app.post("/sessions/notify_start")
async def notify_session_start(payload: SessionStartNotify) -> Dict[str, Any]:
    """Notify dashboard that a session recording has started processing."""
    session_id = str(uuid.uuid4())
    
    # Broadcast to all connected dashboards
    await dashboard_manager.broadcast({
        "type": "SESSION_PROCESSING_START",
        "sessionId": session_id,
        "title": payload.title,
        "source_url": payload.source_url,
        "duration_seconds": payload.duration_seconds,
    })
    
    return {"sessionId": session_id}


@app.post("/sessions/save")
async def save_session_endpoint(payload: SessionSaveRequest) -> Dict[str, Any]:
    """
    Process a recorded session with transcription and summary.
    Broadcasts progress and final result to connected dashboards.
    NOTE: Does NOT save to MongoDB - displays directly in dashboard.
    """
    import traceback as tb
    session_id = str(uuid.uuid4())
    
    try:
        # Notify start
        await dashboard_manager.broadcast({
            "type": "SESSION_PROCESSING_START",
            "sessionId": session_id,
            "title": payload.title,
            "source_url": payload.source_url,
            "duration_seconds": payload.duration_seconds,
        })
        
        # Small delay to ensure dashboard receives start notification
        await asyncio.sleep(0.1)
        
        # Step 1: Transcribe audio (0-50%)
        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 10,
            "step": "transcribing",
        })
        
        print(f"[cue] Transcribing audio for session: {payload.title}")
        try:
            transcript = transcribe_audio(
                audio_base64=payload.audio_base64,
                mime_type=payload.mime_type,
            )
        except Exception as transcribe_err:
            trace = tb.format_exc()
            print(f"[cue] Transcription failed: {transcribe_err}")
            print(f"[cue] Traceback: {trace}")
            await dashboard_manager.broadcast({
                "type": "SESSION_ERROR",
                "sessionId": session_id,
                "error": str(transcribe_err),
            })
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "error": f"Transcription failed: {transcribe_err}",
                }
            )
        
        if not transcript:
            transcript = "[No speech detected in recording]"
        
        print(f"[cue] Transcript length: {len(transcript)} chars")
        
        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 50,
            "step": "transcribing",
        })
        
        # Step 2: Generate summary (50-100%)
        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 55,
            "step": "summarizing",
        })
        
        print(f"[cue] Generating summary for session: {payload.title}")
        try:
            summary = generate_session_summary(
                transcript=transcript,
                title=payload.title,
                source_url=payload.source_url,
            )
        except Exception as summary_err:
            trace = tb.format_exc()
            print(f"[cue] Summary generation failed: {summary_err}")
            print(f"[cue] Traceback: {trace}")
            await dashboard_manager.broadcast({
                "type": "SESSION_ERROR",
                "sessionId": session_id,
                "error": str(summary_err),
            })
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "error": f"Summary failed: {summary_err}",
                }
            )
        
        print(f"[cue] Summary generated: {summary.get('tldr', 'No TLDR')[:100]}...")
        
        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 70,
            "step": "summarizing",
        })

        # No Veo video generation; only thumbnail image
        video_url = None

        # Step 3b: Generate session thumbnail image (alongside summary; once per session)
        thumbnail_base64 = None
        thumbnail_mime_type = "image/png"
        try:
            await dashboard_manager.broadcast({
                "type": "SESSION_PROGRESS",
                "sessionId": session_id,
                "progress": 75,
                "step": "generating_thumbnail",
            })
            title = (payload.title or "Session").strip().replace("\n", " ")[:200]
            tldr = (summary.get("tldr") or "AI-inferred summary").strip().replace("\n", " ")[:400]
            prompt = f"A calm, professional illustration representing a session: {title}. {tldr}."
            thumb_result = generate_session_image(prompt)
            if "error" not in thumb_result:
                thumbnail_base64 = thumb_result.get("image_base64")
                thumbnail_mime_type = thumb_result.get("mime_type", "image/png")
                print(f"[cue] Session thumbnail generated for: {payload.title}")
            else:
                print(f"[cue] Session thumbnail skipped (non-fatal): {thumb_result.get('error', '')[:80]}")
        except Exception as thumb_err:
            print(f"[cue] Session thumbnail failed (non-fatal): {thumb_err}")

        # Step 4: Saving to MongoDB (98%)
        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 98,
            "step": "saving_to_db",
        })

        # Prepare session data (include embedding and thumbnail for vector search / cards)
        summary_text = (summary.get("tldr") or "") + " " + " ".join(summary.get("key_points") or [])
        session_data = {
            "title": payload.title,
            "source_url": payload.source_url,
            "duration_seconds": payload.duration_seconds,
            "transcript": transcript,
            "summary": summary,
            "video_url": video_url,
            "has_video": video_url is not None,
            "created_at": datetime.utcnow(),
            "summary_embedding": generate_embedding(summary_text),
        }
        if thumbnail_base64:
            session_data["thumbnail_base64"] = thumbnail_base64
            session_data["thumbnail_mime_type"] = thumbnail_mime_type

        # Broadcast the full session result to dashboard FIRST (immediate display)
        # Use temp UUID for immediate display, will be updated after MongoDB save
        broadcast_data = {
            "type": "SESSION_RESULT",
            "sessionId": session_id,  # Temp UUID for immediate display
            "title": payload.title,
            "source_url": payload.source_url,
            "duration_seconds": payload.duration_seconds,
            "transcript": transcript,
            "summary": summary,
            "video_url": video_url,
            "has_video": video_url is not None,
            "created_at": datetime.utcnow().isoformat(),
        }
        if thumbnail_base64:
            broadcast_data["thumbnail_base64"] = thumbnail_base64
            broadcast_data["thumbnail_mime_type"] = thumbnail_mime_type
        
        print(f"[cue] Broadcasting SESSION_RESULT: sessionId={session_id}, title={payload.title}, has_summary={bool(summary)}, has_transcript={bool(transcript)}, has_video={video_url is not None}")
        print(f"[cue] Active WebSocket connections: {len(dashboard_manager.active_connections)}")
        
        await dashboard_manager.broadcast(broadcast_data)

        print(f"[cue] Session result broadcasted: {session_id}")

        # Save to MongoDB AFTER display (durable storage)
        db_session_id = session_id
        try:
            print(f"[cue] Saving session to MongoDB: {payload.title}")
            db_session_id = save_session(session_data)
            print(f"[cue] Session saved to MongoDB with ID: {db_session_id}")
            
            # If MongoDB ID is different from temp UUID, broadcast update
            if db_session_id != session_id:
                print(f"[cue] MongoDB ID differs from temp UUID, broadcasting update: {session_id} -> {db_session_id}")
                await dashboard_manager.broadcast({
                    "type": "SESSION_ID_UPDATE",
                    "tempSessionId": session_id,
                    "dbSessionId": db_session_id,
                })
        except Exception as db_error:
            print(f"[cue] MongoDB save failed (session already displayed): {db_error}")
            tb.print_exc()

        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 100,
            "step": "complete",
        })

        return {
            "success": True,
            "sessionId": db_session_id,
            "transcript": transcript[:500] + "..." if len(transcript) > 500 else transcript,
            "summary": summary,
        }
        
    except Exception as e:
        print(f"[cue] Error processing session: {e}")
        import traceback
        traceback.print_exc()
        
        # Notify error
        await dashboard_manager.broadcast({
            "type": "SESSION_ERROR",
            "sessionId": session_id,
            "error": str(e),
        })
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
            }
        )


@app.get("/sessions")
async def get_sessions(limit: int = 200) -> Dict[str, Any]:
    """Get list of recorded sessions with their summaries. Default limit 200."""
    limit = min(limit, 500)  # Cap at 500
    sessions = list_sessions(limit=limit)
    return {"sessions": sessions}


@app.get("/sessions/{session_id}")
async def get_session(session_id: str) -> Dict[str, Any]:
    """Get a single session by ID."""
    from app.db.repository import get_session_by_id
    session = get_session_by_id(session_id)
    if session:
        return {"session": session}
    return {"error": "Session not found"}


@app.get("/sessions/{session_id}/image")
async def get_session_image(session_id: str):
    """Return session thumbnail only if it was generated at save time (no on-demand generation)."""
    session = get_session_by_id(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    if not session.get("thumbnail_base64"):
        return JSONResponse(status_code=404, content={"error": "No thumbnail for this session"})
    return {
        "image_base64": session["thumbnail_base64"],
        "mime_type": session.get("thumbnail_mime_type", "image/png"),
    }


@app.delete("/sessions/{session_id}")
async def delete_session_endpoint(session_id: str) -> Dict[str, Any]:
    """Delete a session by ID."""
    from app.db.repository import delete_session
    success = delete_session(session_id)
    if success:
        return {"success": True, "message": f"Session {session_id} deleted"}
    return {"success": False, "error": "Session not found or could not be deleted"}


@app.get("/reels")
async def list_reels(limit: int = 50) -> Dict[str, Any]:
    """Get reels - only sessions with generated videos."""
    from app.db.mongo import get_db

    db = get_db()

    # Query only sessions with videos
    sessions_with_video = list(db.sessions.find(
        {"has_video": True, "video_url": {"$ne": None}},
        {
            "_id": 1,
            "title": 1,
            "summary": 1,
            "video_url": 1,
            "source_url": 1,
            "duration_seconds": 1,
            "created_at": 1,
            "transcript": 1,
        }
    ).sort("created_at", -1).limit(limit))

    reels = []
    for session in sessions_with_video:
        obj_id = session.get("_id")
        summary = session.get("summary", {})

        # Calculate timestamp
        timestamp = None
        if obj_id and hasattr(obj_id, 'generation_time'):
            timestamp = obj_id.generation_time.timestamp() * 1000
        elif session.get("created_at"):
            created_at = session.get("created_at")
            if hasattr(created_at, 'timestamp'):
                timestamp = created_at.timestamp() * 1000

        reels.append({
            "id": str(obj_id) if obj_id else "",
            "type": "video_summary",
            "title": session.get("title", "Video Summary"),
            "summary": summary.get("tldr", ""),
            "sentiment": summary.get("sentiment", "Neutral"),
            "tasks": summary.get("action_items", []),
            "key_points": summary.get("key_points", []),
            "videoUrl": session.get("video_url"),
            "source_url": session.get("source_url", ""),
            "duration_seconds": session.get("duration_seconds", 0),
            "transcript_preview": session.get("transcript", "")[:200] + "..." if session.get("transcript") else "",
            "timestamp": timestamp,
        })

    return {"reels": reels}


@app.get("/google_activity")
async def get_google_activity(user_id: str = "", limit: int = 100) -> Dict[str, Any]:
    """Get recent Google/MCP activity. user_id optional; if empty returns recent (all)."""
    limit = min(limit, 200)
    if user_id:
        activities = list_google_activity(user_id, limit=limit)
    else:
        activities = list_google_activity_recent(limit=limit)
    return {"activities": activities}


# ================== MOSAIC COMMS (Gmail unread, Gemini summary, Calendar upcoming) ==================

_mosaic_comms_cache: Dict[str, tuple] = {}  # cache_key -> (gmail_summary, expiry_timestamp)
MOSAIC_CACHE_TTL_SECONDS = 600  # 10 minutes


class MosaicCommsRequest(BaseModel):
    """Request for Mosaic comms hub: Gmail + Calendar data."""
    user_token: str = ""


def _mosaic_cache_key(token: str) -> str:
    """Stable key for caching (do not store full token)."""
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()[:24]


@app.post("/mosaic/comms")
async def mosaic_comms(payload: MosaicCommsRequest) -> Dict[str, Any]:
    """
    Return data for the Mosaic comms hub: Gmail unread count, Gemini summary of today's emails,
    and upcoming calendar events. Requires user_token (Google OAuth from dashboard).
    """
    from app.mcp import gmail_server, calendar_server
    from app.agents.gemini_client import call_gemini

    user_token = (payload.user_token or "").strip()
    if not user_token:
        return {
            "gmail_unread_count": 0,
            "gmail_summary": None,
            "calendar_upcoming": [],
            "error": "user_token required",
        }

    gmail_unread_count = 0
    gmail_summary: Optional[str] = None
    calendar_upcoming: List[Dict[str, Any]] = []

    try:
        gmail_unread_count = gmail_server.get_unread_count(user_token)
    except Exception:
        pass

    try:
        calendar_upcoming = calendar_server.list_upcoming_events(user_token, max_results=10)
    except Exception:
        pass

    cache_key = _mosaic_cache_key(user_token)
    now_ts = datetime.utcnow().timestamp()
    if cache_key in _mosaic_comms_cache:
        cached_summary, expiry = _mosaic_comms_cache[cache_key]
        if now_ts < expiry:
            gmail_summary = cached_summary

    if gmail_summary is None:
        try:
            snippets = gmail_server.get_recent_email_snippets(user_token, max_results=15)
            if snippets:
                blob = "\n\n".join(
                    f"Subject: {s.get('subject', '')}\nSnippet: {s.get('snippet', '')}"
                    for s in snippets
                )
                prompt = (
                    "Given these recent email subjects and snippets from the last day, "
                    "list the important things the user should note (bullets, concise, 3-6 points). "
                    "If nothing stands out, say 'Nothing urgent.'\n\n" + blob[:8000]
                )
                result = call_gemini(
                    parts=[{"text": prompt}],
                    response_mime_type="text/plain",
                )
                text = result.get("raw_text") or result.get("error") or ""
                if text and "error" not in text.lower():
                    gmail_summary = text.strip()
                    _mosaic_comms_cache[cache_key] = (gmail_summary, now_ts + MOSAIC_CACHE_TTL_SECONDS)
            else:
                gmail_summary = "No recent emails to summarize."
        except Exception as e:
            gmail_summary = None
            print(f"[cue] mosaic/comms Gemini summary error: {e}")

    return {
        "gmail_unread_count": gmail_unread_count,
        "gmail_summary": gmail_summary,
        "calendar_upcoming": calendar_upcoming,
    }


# ================== COMMAND EXECUTION (@mention) ==================

class CommandRequest(BaseModel):
    """Request model for @mention commands from Ask AI."""
    service: str  # gmail, calendar, tasks, docs, drive, sheets
    command: str  # Natural language command
    user_token: str = ""  # Google OAuth token
    confirm: bool = False  # True = execute, False = preview only
    page_title: Optional[str] = None
    current_url: Optional[str] = None
    selected_text: Optional[str] = None
    user_display_name: Optional[str] = None
    user_email: Optional[str] = None


@app.post("/execute_command")
async def execute_command(payload: CommandRequest) -> Dict[str, Any]:
    """
    Execute an @mention command (e.g., @gmail draft email...).

    If confirm=False, returns a preview of what would happen.
    If confirm=True, executes the action using MCP tools.
    """
    from app.agents.gemini_client import call_gemini
    from app.db.repository import log_google_activity

    service = payload.service.lower()
    command = payload.command
    user_token = payload.user_token
    confirm = payload.confirm

    # Supported services
    supported_services = ["gmail", "calendar", "tasks", "docs", "drive", "sheets"]
    if service not in supported_services:
        return {
            "success": False,
            "error": f"Unknown service: @{service}. Supported: {', '.join(['@' + s for s in supported_services])}"
        }

    # Build context and recent activity for single agent-style prompt
    page_title = payload.page_title or ""
    current_url = payload.current_url or ""
    selected_text = (payload.selected_text or "")[:500]
    user_display_name = payload.user_display_name or ""
    user_email = payload.user_email or ""
    recent_activity_lines: List[str] = []
    try:
        activities = list_google_activity_recent(limit=10)
        for a in activities[:10]:
            s = a.get("service", "")
            act = a.get("action", "")
            det = a.get("details", {}) or {}
            if s == "gmail" and act == "send_email":
                recent_activity_lines.append(f"sent email: {det.get('subject', 'email')}")
            elif s == "docs" and act == "create_document":
                recent_activity_lines.append(f"created doc: {det.get('title', 'doc')}")
            elif s == "calendar" and act == "create_event":
                recent_activity_lines.append(f"created event: {det.get('summary', 'event')}")
            elif s == "tasks" and act == "create_task":
                recent_activity_lines.append(f"created task: {det.get('title', 'task')}")
            else:
                recent_activity_lines.append(f"{s} {act}")
    except Exception:
        pass
    recent_activity_str = "; ".join(recent_activity_lines) if recent_activity_lines else "none"

    agent_prompt = f"""You are a smart, productive AI agent. The user is invoking a Google {service} command. Use the context below to decide exactly what to do and produce a complete, ready-to-use result.

Context:
- Page: {page_title or 'unknown'}
- URL: {current_url or 'unknown'}
- Selected text: {selected_text or '(none)'}
- User name: {user_display_name or '(not provided)'}
- User email: {user_email or '(not provided)'}
- Recent Google activity: {recent_activity_str}

User command: {command}

Return a single JSON object with:
- action: One of (Gmail: "draft", "send", "list", "read"; Calendar: "create", "list", "delete"; Tasks: "add", "list", "complete"; Docs: "create", "read"; Drive: "list", "find"; Sheets: "create", "read").
- params: An object with ALL fields needed to run the action. Do not use [YOUR NAME] or placeholders for the sender; use the User name above in sign-offs.

For Gmail "draft" or "send": params must include "to", "subject", "body". The body must be a full email: greeting, 1-2 short paragraphs, and a sign-off using the User name (e.g. "Best regards, {{User name}}"). Plain text only.
For Docs "create": params must include "title", "content" (plain text with \\n for new lines).
For Tasks "add": params must include "title", optionally "notes", "due".
For Calendar "create": params must include "title" (or "summary"), "description", and if the user specified time: "date", "time", "start", "end" as appropriate.

Return ONLY the JSON object, no markdown or explanation."""

    try:
        import json
        import re

        agent_result = call_gemini(
            parts=[{"text": agent_prompt}],
            response_mime_type="application/json",
        )
        if isinstance(agent_result, dict) and "error" in agent_result:
            raise ValueError(agent_result["error"])
        if isinstance(agent_result, dict):
            parsed = agent_result
        else:
            raw = getattr(agent_result, "raw_text", None) or str(agent_result)
            json_match = re.search(r'\{[\s\S]*\}', raw)
            parsed = json.loads(json_match.group()) if json_match else {}
        action = parsed.get("action", "unknown")
        params = parsed.get("params", {})
        if not isinstance(params, dict):
            params = {}
    except Exception as parse_err:
        print(f"[cue] Command agent error: {parse_err}")
        return {
            "success": False,
            "error": f"Could not interpret command: {parse_err}",
            "hint": "Try being more specific, e.g., '@gmail draft email to user@example.com subject Hello'"
        }

    # Normalize action aliases - map common variations to expected actions
    ACTION_ALIASES = {
        "gmail": {"generate": "draft", "create": "draft", "compose": "draft", "write": "draft", "make": "draft"},
        "calendar": {"schedule": "create", "add": "create", "book": "create", "make": "create"},
        "tasks": {"create": "add", "new": "add", "make": "add"},
        "docs": {"generate": "create", "new": "create", "write": "create", "make": "create"},
        "sheets": {"generate": "create", "new": "create", "make": "create"},
        "drive": {"generate": "create", "new": "create", "make": "create"},
    }
    if service in ACTION_ALIASES and action in ACTION_ALIASES[service]:
        original_action = action
        action = ACTION_ALIASES[service][action]
        print(f"[cue] Normalized action: {original_action} -> {action} for {service}")

    # Ensure required fields have fallbacks for preview/execute
    if service == "gmail" and action == "draft":
        params.setdefault("to", "")
        params.setdefault("subject", "")
        if not (params.get("body") or "").strip():
            params["body"] = "Please add your message here."
    if service == "docs" and action == "create":
        params["title"] = (params.get("title") or params.get("topic") or "Untitled Document").strip()
        params["content"] = (params.get("content") or "").strip()
    if service == "tasks" and action == "add":
        params["title"] = (params.get("title") or params.get("topic") or "New Task").strip()
        params.setdefault("notes", "")
    if service == "calendar" and action == "create":
        params["title"] = (params.get("title") or params.get("summary") or params.get("topic") or "Event").strip()
        params["summary"] = params.get("summary") or params["title"]
        params.setdefault("description", "")
        params.setdefault("date", "")
        params.setdefault("time", "09:00")
        params.setdefault("start", "")
        params.setdefault("end", "")

    # If preview mode, return what would happen
    if not confirm:
        preview = {
            "success": True,
            "preview": True,
            "service": service,
            "action": action,
            "params": params,
            "message": f"Ready to {action} via {service.title()}",
        }

        # Add service-specific preview details
        if service == "gmail" and action == "draft":
            preview["draft"] = {
                "to": params.get("to", ""),
                "subject": params.get("subject", ""),
                "body": params.get("body", ""),
            }
        elif service == "calendar" and action == "create":
            preview["event"] = {
                "title": params.get("title", params.get("summary", "")),
                "date": params.get("date", ""),
                "time": params.get("time", params.get("start", "")),
                "description": params.get("description", ""),
            }
        elif service == "tasks" and action == "add":
            preview["task"] = {
                "title": params.get("title", ""),
                "notes": params.get("notes", ""),
                "due": params.get("due", ""),
            }

        return preview

    # Execute mode - call MCP tools
    if not user_token:
        print(f"[cue] execute_command: No token provided for {service}/{action}")
        return {
            "success": False,
            "error": "Authentication required. Please sign in with Google first.",
            "requires_auth": True,
        }

    print(f"[cue] execute_command: Executing {service}/{action} with token (length={len(user_token)})")
    result = {"success": False, "error": "Action not implemented"}

    # Helper to check if MCP result is an error and extract open_url if available
    def wrap_mcp_result(mcp_result: str, success_message: str, result_key: str = "result") -> Dict[str, Any]:
        import ast
        result_str = str(mcp_result) if mcp_result else ""
        print(f"[cue] MCP result: {result_str[:500]}")  # Log MCP result

        # Check for various error patterns
        error_patterns = ["Error:", "error:", "failed", "Failed", "Invalid", "invalid"]
        for pattern in error_patterns:
            if result_str.startswith(pattern):
                error_msg = result_str.replace(pattern, "", 1).strip()
                print(f"[cue] MCP error detected: {error_msg}")
                return {"success": False, "error": error_msg or result_str}

        # Check for HTTP error codes in the result
        if "401" in result_str or "403" in result_str or "404" in result_str or "500" in result_str:
            print(f"[cue] MCP HTTP error: {result_str}")
            return {"success": False, "error": result_str}

        # Try to parse dict-like strings to extract open_url
        open_url = None
        parsed_result = mcp_result
        if isinstance(mcp_result, str) and mcp_result.startswith("{"):
            try:
                parsed_result = ast.literal_eval(mcp_result)
                # Extract open_url from various keys used by MCP servers
                open_url = parsed_result.get("webViewLink") or parsed_result.get("htmlLink") or parsed_result.get("spreadsheetUrl")
            except Exception:
                pass

        response = {"success": True, "message": success_message, result_key: parsed_result}
        if open_url:
            response["open_url"] = open_url
        print(f"[cue] MCP success: {success_message}")
        return response

    try:
        if service == "gmail":
            from app.mcp import gmail_server
            if action == "draft":
                # New draft: To/Subject as headers, body as email content only
                mcp_result = gmail_server.create_draft(
                    user_token=user_token,
                    to=params.get("to", "").strip(),
                    subject=params.get("subject", "").strip(),
                    body=(params.get("body", "") or "").strip(),
                )
                result = wrap_mcp_result(mcp_result, "Draft created", "draft_id")
            elif action == "send":
                mcp_result = gmail_server.send_email(
                    user_token=user_token,
                    to=params.get("to", ""),
                    subject=params.get("subject", ""),
                    body=params.get("body", ""),
                )
                result = wrap_mcp_result(mcp_result, "Email sent", "message_id")
            elif action == "list":
                mcp_result = gmail_server.list_emails(
                    user_token=user_token,
                    query=params.get("query", ""),
                    max_results=params.get("max_results", 10),
                )
                if isinstance(mcp_result, str) and mcp_result.startswith("Error:"):
                    result = {"success": False, "error": mcp_result[6:].strip()}
                else:
                    result = {"success": True, "emails": mcp_result}

        elif service == "calendar":
            from app.mcp import calendar_server
            if action == "create":
                mcp_result = calendar_server.create_event(
                    user_token=user_token,
                    summary=params.get("title", params.get("summary", "")),
                    start=params.get("start", params.get("date", "") + "T" + params.get("time", "09:00:00")),
                    end=params.get("end", ""),
                    description=params.get("description", ""),
                    attendees=params.get("attendees", []),
                )
                result = wrap_mcp_result(mcp_result, "Event created", "event_id")
            elif action == "list":
                mcp_result = calendar_server.list_events(
                    user_token=user_token,
                    time_min=params.get("time_min", ""),
                    time_max=params.get("time_max", ""),
                    max_results=params.get("max_results", 10),
                )
                if isinstance(mcp_result, str) and mcp_result.startswith("Error:"):
                    result = {"success": False, "error": mcp_result[6:].strip()}
                else:
                    result = {"success": True, "events": mcp_result}

        elif service == "tasks":
            from app.mcp import tasks_server
            if action == "add":
                mcp_result = tasks_server.create_task(
                    user_token=user_token,
                    title=params.get("title", ""),
                    notes=params.get("notes", ""),
                    due=params.get("due", ""),
                )
                result = wrap_mcp_result(mcp_result, "Task created", "task_id")
            elif action == "list":
                mcp_result = tasks_server.list_tasks(
                    user_token=user_token,
                    task_list=params.get("task_list", "@default"),
                )
                if isinstance(mcp_result, str) and mcp_result.startswith("Error:"):
                    result = {"success": False, "error": mcp_result[6:].strip()}
                else:
                    result = {"success": True, "tasks": mcp_result}
            elif action == "complete":
                mcp_result = tasks_server.complete_task(
                    user_token=user_token,
                    task_id=params.get("task_id", ""),
                )
                result = wrap_mcp_result(mcp_result, "Task completed", "result")

        elif service == "docs":
            from app.mcp import docs_server
            if action == "create":
                mcp_result = docs_server.create_document(
                    user_token=user_token,
                    title=params.get("title", "Untitled Document"),
                    content=params.get("content", ""),
                )
                result = wrap_mcp_result(mcp_result, "Document created", "doc_id")
            elif action == "read":
                mcp_result = docs_server.read_document(
                    user_token=user_token,
                    doc_id=params.get("doc_id", ""),
                )
                if isinstance(mcp_result, str) and mcp_result.startswith("Error:"):
                    result = {"success": False, "error": mcp_result[6:].strip()}
                else:
                    result = {"success": True, "document": mcp_result}

        elif service == "drive":
            from app.mcp import drive_server
            if action == "list" or action == "find":
                mcp_result = drive_server.list_files(
                    user_token=user_token,
                    query=params.get("query", ""),
                    max_results=params.get("max_results", 10),
                )
                if isinstance(mcp_result, str) and mcp_result.startswith("Error:"):
                    result = {"success": False, "error": mcp_result[6:].strip()}
                else:
                    result = {"success": True, "files": mcp_result}

        elif service == "sheets":
            from app.mcp import sheets_server
            if action == "create":
                mcp_result = sheets_server.create_sheet(
                    user_token=user_token,
                    title=params.get("title", "Untitled Spreadsheet"),
                )
                result = wrap_mcp_result(mcp_result, "Spreadsheet created", "sheet_id")
            elif action == "read":
                mcp_result = sheets_server.read_sheet(
                    user_token=user_token,
                    sheet_id=params.get("sheet_id", ""),
                    range_name=params.get("range", "A1:Z100"),
                )
                if isinstance(mcp_result, str) and mcp_result.startswith("Error:"):
                    result = {"success": False, "error": mcp_result[6:].strip()}
                else:
                    result = {"success": True, "data": mcp_result}

        # Log the activity
        log_google_activity({
            "user_id": "",  # Would come from auth in production
            "service": service,
            "action": action,
            "details": {"params": params, "result": "executed" if result.get("success") else "failed"},
        })
        await dashboard_manager.broadcast({"type": "ACTIVITY_UPDATE"})

    except Exception as exec_err:
        print(f"[cue] Command execution error: {exec_err}")
        import traceback
        traceback.print_exc()
        result = {"success": False, "error": str(exec_err)}

    return result


# ================== WEBSOCKET ENDPOINTS ==================

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for dashboard real-time updates.
    
    Broadcasts:
    - SESSION_PROCESSING_START: New session is being processed
    - SESSION_PROGRESS: Progress update (0-100%)
    - SESSION_COMPLETE: Session processing finished
    - SESSION_ERROR: Processing failed
    """
    await dashboard_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, handle any incoming messages
            message = await websocket.receive_json()
            
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": message.get("timestamp")})
    
    except WebSocketDisconnect:
        dashboard_manager.disconnect(websocket)


@app.websocket("/ws/audio")
async def websocket_audio(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_json()
            audio_base64 = message.get("audio_base64")
            mime_type = message.get("mime_type")
            if not audio_base64 or not mime_type:
                await websocket.send_json({"error": "Missing audio_base64 or mime_type"})
                continue
            result = process_audio_chunk(
                audio_base64=audio_base64,
                mime_type=mime_type,
                chunk_start_seconds=message.get("chunk_start_seconds"),
                source_url=message.get("source_url"),
            )
            if result:
                save_diagram_event(message, result)
                await websocket.send_json(result)
            else:
                await websocket.send_json({"type": "none"})
    except WebSocketDisconnect:
        return


@app.websocket("/ws/puppeteer")
async def websocket_puppeteer(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time audio-to-motion processing."""
    await websocket.accept()
    chunk_count = 0
    
    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type", "audio_chunk")
            
            if msg_type == "audio_chunk":
                audio_base64 = message.get("audio_base64")
                mime_type = message.get("mime_type")
                
                if not audio_base64 or not mime_type:
                    await websocket.send_json({"error": "Missing audio_base64 or mime_type"})
                    continue
                
                chunk_start = chunk_count * 5
                chunk_count += 1
                
                motion_result = extract_motions(
                    audio_base64=audio_base64,
                    mime_type=mime_type,
                    chunk_start_seconds=chunk_start,
                )
                
                if motion_result.get("has_instructions") and motion_result.get("motions"):
                    motions = motion_result["motions"]
                    hints = [parse_motion_to_animation_hint(m) for m in motions]
                    
                    if hints:
                        pose = generate_pose_for_motion(hints[0])
                        await websocket.send_json({
                            "type": "pose",
                            **pose,
                            "context": motion_result.get("context", "general"),
                        })
                    
                    await websocket.send_json({
                        "type": "motion",
                        "motions": motions,
                        "context": motion_result.get("context", "general"),
                        "chunk_index": chunk_count - 1,
                    })
                else:
                    diagram_result = process_audio_chunk(
                        audio_base64=audio_base64,
                        mime_type=mime_type,
                        chunk_start_seconds=chunk_start,
                    )
                    
                    if diagram_result and diagram_result.get("type") == "diagram":
                        save_diagram_event(message, diagram_result)
                        await websocket.send_json(diagram_result)
                    else:
                        await websocket.send_json({
                            "type": "ack",
                            "chunk_index": chunk_count - 1,
                            "has_motion": False,
                        })
            
            elif msg_type == "get_preset":
                pose_name = message.get("pose_name", "t_pose")
                pose = get_preset_pose(pose_name)
                if pose:
                    await websocket.send_json(pose)
                else:
                    await websocket.send_json({"error": f"Unknown preset: {pose_name}"})
            
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": message.get("timestamp")})
    
    except WebSocketDisconnect:
        print(f"Puppeteer WebSocket disconnected after {chunk_count} chunks")
        return


# ================== EXTENSION CONNECTION MANAGER ==================

class ExtensionConnectionManager:
    """Manages WebSocket connections for Chrome extension task syncing."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"[cue] Extension client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"[cue] Extension client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict) -> None:
        """Broadcast a message to all connected extensions."""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.active_connections.discard(conn)

    async def send_tasks(self, tasks: list) -> None:
        """Send synced tasks to all connected extensions."""
        await self.broadcast({
            "type": "SYNCED_TASKS",
            "tasks": tasks,
            "timestamp": asyncio.get_event_loop().time(),
        })

extension_manager = ExtensionConnectionManager()


@app.websocket("/ws/extension")
async def websocket_extension(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for Chrome extension task synchronization.

    Broadcasts:
    - SYNCED_TASKS: Tasks from dashboard to sync with extension
    - SUGGESTED_TASKS_UPDATE: New suggested tasks available
    - ACTIVITY_UPDATE: Activity changes notification
    """
    await extension_manager.connect(websocket)

    try:
        # Send current suggested tasks on connect
        try:
            tasks = list_suggested_tasks(limit=50)
            pending_tasks = [t for t in tasks if t.get("status") != "completed"][:5]
            if pending_tasks:
                await websocket.send_json({
                    "type": "SYNCED_TASKS",
                    "tasks": pending_tasks,
                })
        except Exception as e:
            print(f"[cue] Failed to send initial tasks: {e}")

        # Keep connection alive and handle messages
        while True:
            message = await websocket.receive_json()

            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": message.get("timestamp")})

            elif message.get("type") == "REQUEST_TASKS":
                # Extension requests current tasks
                try:
                    tasks = list_suggested_tasks(limit=50)
                    pending_tasks = [t for t in tasks if t.get("status") != "completed"][:5]
                    await websocket.send_json({
                        "type": "SYNCED_TASKS",
                        "tasks": pending_tasks,
                    })
                except Exception as e:
                    await websocket.send_json({"type": "error", "error": str(e)})

    except WebSocketDisconnect:
        extension_manager.disconnect(websocket)
