import os
import uuid
import asyncio
from typing import Any, Dict, List, Optional, Set
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agents.intent import analyze_intent
from app.agents.prism import summarize_context
from app.agents.scribe import process_audio_chunk
from app.agents.ask_ai import ask_ai
from app.agents.motion import extract_motions, parse_motion_to_animation_hint
from app.agents.puppeteer import generate_pose_for_motion, generate_pose_sequence, get_preset_pose
from app.agents.transcriber import transcribe_audio, generate_session_summary
from app.db.repository import (
    save_context_event,
    save_diagram_event,
    save_prism_summary,
    save_session,
    list_recent,
    list_sessions,
)

load_dotenv()

app = FastAPI(title="cue ADK API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    
    async def broadcast(self, message: Dict[str, Any]):
        """Broadcast message to all connected dashboards."""
        if not self.active_connections:
            print(f"[cue] No active dashboard connections to broadcast: {message.get('type', 'unknown')}")
            return
        
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


# ================== REQUEST MODELS ==================

class AnalyzeContextRequest(BaseModel):
    current_url: str
    page_title: Optional[str] = None
    time_on_page: Optional[float] = None
    tab_switch_rate: Optional[float] = None
    scroll_depth: Optional[float] = None


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


# ================== BASE ENDPOINTS ==================

@app.get("/")
async def root() -> Dict[str, Any]:
    return {"status": "ok", "service": "cue ADK API"}


@app.post("/analyze_context")
async def analyze_context(payload: AnalyzeContextRequest) -> Dict[str, Any]:
    result = analyze_intent(payload.model_dump())
    save_context_event(payload.model_dump(), result)
    return result


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
    }
    result = ask_ai(payload.query, context)
    return result


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
        transcript = transcribe_audio(
            audio_base64=payload.audio_base64,
            mime_type=payload.mime_type,
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
        summary = generate_session_summary(
            transcript=transcript,
            title=payload.title,
            source_url=payload.source_url,
        )
        
        print(f"[cue] Summary generated: {summary.get('tldr', 'No TLDR')[:100]}...")
        
        await dashboard_manager.broadcast({
            "type": "SESSION_PROGRESS",
            "sessionId": session_id,
            "progress": 100,
            "step": "complete",
        })
        
        # Prepare session data
        session_data = {
            "title": payload.title,
            "source_url": payload.source_url,
            "duration_seconds": payload.duration_seconds,
            "transcript": transcript,
            "summary": summary,
            "created_at": datetime.utcnow(),
        }

        # Broadcast the full session result to dashboard FIRST (immediate display)
        broadcast_data = {
            "type": "SESSION_RESULT",
            "sessionId": session_id,  # Use temp UUID for immediate display
            "title": payload.title,
            "source_url": payload.source_url,
            "duration_seconds": payload.duration_seconds,
            "transcript": transcript,
            "summary": summary,
            "created_at": datetime.utcnow().isoformat(),
        }
        
        print(f"[cue] Broadcasting SESSION_RESULT: sessionId={session_id}, title={payload.title}, has_summary={bool(summary)}, has_transcript={bool(transcript)}")
        print(f"[cue] Active WebSocket connections: {len(dashboard_manager.active_connections)}")
        
        await dashboard_manager.broadcast(broadcast_data)

        print(f"[cue] Session result broadcasted: {session_id}")

        # Save to MongoDB AFTER display (durable storage)
        db_session_id = session_id
        try:
            print(f"[cue] Saving session to MongoDB: {payload.title}")
            db_session_id = save_session(session_data)
            print(f"[cue] Session saved to MongoDB with ID: {db_session_id}")
        except Exception as db_error:
            print(f"[cue] MongoDB save failed (session already displayed): {db_error}")

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
        
        return {
            "success": False,
            "error": str(e),
        }


@app.get("/sessions")
async def get_sessions(limit: int = 50) -> Dict[str, Any]:
    """Get list of recorded sessions with their summaries."""
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
    """Get reels combining sessions, summaries, and diagrams."""
    summaries = list_recent("summaries", limit=limit)
    diagrams = list_recent("diagrams", limit=limit)
    sessions = list_sessions(limit=limit)
    
    reels = []
    
    # Add sessions as reels
    for session in sessions:
        obj_id = session.get("_id")
        timestamp = obj_id.generation_time.timestamp() * 1000 if obj_id and hasattr(obj_id, 'generation_time') else None
        summary = session.get("summary", {})
        reels.append({
            "id": str(obj_id) if obj_id else session.get("sessionId", ""),
            "type": "session",
            "title": session.get("title", "Recorded Session"),
            "summary": summary.get("tldr", ""),
            "key_points": summary.get("key_points", []),
            "tasks": summary.get("action_items", []),
            "transcript_preview": session.get("transcript", "")[:200] + "..." if session.get("transcript") else "",
            "duration_seconds": session.get("duration_seconds", 0),
            "source_url": session.get("source_url", ""),
            "timestamp": timestamp or (session.get("created_at").timestamp() * 1000 if session.get("created_at") else None),
        })
    
    # Add summaries as reels
    for summary in summaries:
        result = summary.get("result", {})
        payload = summary.get("payload", {})
        obj_id = summary.get("_id")
        timestamp = obj_id.generation_time.timestamp() * 1000 if obj_id and hasattr(obj_id, 'generation_time') else None
        reels.append({
            "id": str(obj_id) if obj_id else "",
            "type": "summary",
            "title": payload.get("title", "Prism Summary"),
            "summary": result.get("summary_tldr", ""),
            "tasks": result.get("tasks", []),
            "sentiment": result.get("sentiment", "Neutral"),
            "source_url": payload.get("source_url", ""),
            "timestamp": timestamp,
        })
    
    # Add diagrams as reels
    for diagram in diagrams:
        result = diagram.get("result", {})
        payload = diagram.get("payload", {})
        if result.get("type") == "diagram":
            obj_id = diagram.get("_id")
            timestamp = obj_id.generation_time.timestamp() * 1000 if obj_id and hasattr(obj_id, 'generation_time') else None
            reels.append({
                "id": str(obj_id) if obj_id else "",
                "type": "diagram",
                "title": "Live Diagram",
                "summary": "Visual diagram from audio analysis",
                "mermaid_code": result.get("mermaid_code", ""),
                "videoUrl": None,
                "timestamp": timestamp,
            })
    
    # Sort by timestamp (newest first)
    reels.sort(key=lambda x: x.get("timestamp") or 0, reverse=True)
    
    return {"reels": reels[:limit]}


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
