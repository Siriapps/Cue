from datetime import datetime
from typing import Any, Dict, List, Optional
from bson import ObjectId

from app.db.mongo import get_db


def _collection(name: str):
    db = get_db()
    return db[name]


def save_user(user_data: Dict[str, Any]) -> str:
    """
    Save or update user (e.g. from Google OAuth).
    Upserts by email; returns user id.
    """
    email = user_data.get("email")
    if not email:
        raise ValueError("user_data must contain email")
    coll = _collection("users")
    existing = coll.find_one({"email": email})
    doc = {
        "email": email,
        "name": user_data.get("name", ""),
        "picture": user_data.get("picture"),
        "updated_at": datetime.utcnow(),
    }
    if existing:
        coll.update_one({"_id": existing["_id"]}, {"$set": doc})
        return str(existing["_id"])
    doc["created_at"] = datetime.utcnow()
    result = coll.insert_one(doc)
    return str(result.inserted_id)


def log_google_activity(activity: Dict[str, Any]) -> str:
    """Log an MCP/Google API activity for the Google Activity dashboard."""
    result = _collection("google_activity").insert_one(activity)
    return str(result.inserted_id)


def list_google_activity(user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """List recent Google activities for a user."""
    activities = list(
        _collection("google_activity")
        .find({"user_id": user_id})
        .sort("_id", -1)
        .limit(limit)
    )
    for activity in activities:
        activity["_id"] = str(activity["_id"])
    return activities


def list_google_activity_recent(limit: int = 100) -> List[Dict[str, Any]]:
    """List recent Google activities (all users). For dashboard."""
    activities = list(
        _collection("google_activity").find().sort("_id", -1).limit(limit)
    )
    for activity in activities:
        activity["_id"] = str(activity["_id"])
    return activities


def save_context_event(context: Dict[str, Any], result: Dict[str, Any]) -> None:
    _collection("context_events").insert_one(
        {"context": context, "result": result}
    )


def save_prism_summary(payload: Dict[str, Any], result: Dict[str, Any]) -> None:
    _collection("summaries").insert_one(
        {"payload": payload, "result": result}
    )


def save_diagram_event(payload: Dict[str, Any], result: Dict[str, Any]) -> None:
    _collection("diagrams").insert_one(
        {"payload": payload, "result": result}
    )


def list_recent(collection: str, limit: int = 20) -> List[Dict[str, Any]]:
    """List recent documents from a collection, with ObjectId converted to string."""
    docs = list(_collection(collection).find().sort("_id", -1).limit(limit))
    
    # Convert ObjectId to string for JSON serialization
    for doc in docs:
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
    
    return docs


# ================== SESSION FUNCTIONS ==================

def save_session(session_data: Dict[str, Any]) -> str:
    """
    Save a recorded session to MongoDB.

    Args:
        session_data: Dictionary containing session information
            - title: str
            - source_url: str
            - duration_seconds: int
            - transcript: str
            - summary: dict
            - video_url: str (optional) - URL to Veo-generated video
            - has_video: bool (optional) - Whether video was generated
            - created_at: datetime

    Returns:
        The session ID as a string
    """
    result = _collection("sessions").insert_one(session_data)
    return str(result.inserted_id)


def list_sessions(limit: int = 50) -> List[Dict[str, Any]]:
    """
    List recent sessions, sorted by creation time (newest first).
    
    Args:
        limit: Maximum number of sessions to return
    
    Returns:
        List of session documents
    """
    sessions = list(_collection("sessions").find().sort("_id", -1).limit(limit))
    
    # Convert ObjectId to string for JSON serialization
    for session in sessions:
        if "_id" in session:
            session["sessionId"] = str(session["_id"])
            session["_id"] = str(session["_id"])
    
    return sessions


def get_session_by_id(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a single session by its ID.
    
    Args:
        session_id: The session's ObjectId as a string
    
    Returns:
        Session document or None if not found
    """
    try:
        session = _collection("sessions").find_one({"_id": ObjectId(session_id)})
        if session:
            session["sessionId"] = str(session["_id"])
        return session
    except Exception as e:
        print(f"Error fetching session: {e}")
        return None


def update_session(session_id: str, updates: Dict[str, Any]) -> bool:
    """
    Update a session document.
    
    Args:
        session_id: The session's ObjectId as a string
        updates: Dictionary of fields to update
    
    Returns:
        True if update was successful, False otherwise
    """
    try:
        result = _collection("sessions").update_one(
            {"_id": ObjectId(session_id)},
            {"$set": updates}
        )
        return result.modified_count > 0
    except Exception as e:
        print(f"Error updating session: {e}")
        return False


def delete_session(session_id: str) -> bool:
    """
    Delete a session by ID.

    Args:
        session_id: The session's ObjectId as a string

    Returns:
        True if deletion was successful, False otherwise
    """
    try:
        result = _collection("sessions").delete_one({"_id": ObjectId(session_id)})
        return result.deleted_count > 0
    except Exception as e:
        print(f"Error deleting session: {e}")
        return False


def list_sessions_without_video(limit: int = 100) -> List[Dict[str, Any]]:
    """
    List sessions that don't have video generated yet.

    Args:
        limit: Maximum number of sessions to return

    Returns:
        List of session documents without videos
    """
    query = {
        "$or": [
            {"video_url": None},
            {"video_url": {"$exists": False}},
            {"has_video": False},
            {"has_video": {"$exists": False}}
        ]
    }
    sessions = list(_collection("sessions").find(query).sort("_id", -1).limit(limit))

    for session in sessions:
        if "_id" in session:
            session["sessionId"] = str(session["_id"])
            session["_id"] = str(session["_id"])

    return sessions


def search_sessions_by_embedding(query_vector: List[float], limit: int = 5) -> List[Dict[str, Any]]:
    """Vector search over sessions by summary_embedding. Requires Atlas vector index 'summary_embedding_index' on path 'summary_embedding'."""
    try:
        db = get_db()
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "summary_embedding_index",
                    "path": "summary_embedding",
                    "queryVector": query_vector,
                    "numCandidates": min(50, limit * 10),
                    "limit": limit,
                }
            },
            {"$project": {"title": 1, "summary": 1, "source_url": 1, "created_at": 1, "score": {"$meta": "vectorSearchScore"}}},
        ]
        cursor = db.sessions.aggregate(pipeline)
        sessions = list(cursor)
        for s in sessions:
            s["_id"] = str(s.get("_id", ""))
            s["sessionId"] = s["_id"]
        return sessions
    except Exception:
        return []


def list_sessions_with_video(limit: int = 50) -> List[Dict[str, Any]]:
    """
    List sessions that have video generated (for reels).

    Args:
        limit: Maximum number of sessions to return

    Returns:
        List of session documents with videos
    """
    query = {
        "has_video": True,
        "video_url": {"$ne": None}
    }
    sessions = list(_collection("sessions").find(query).sort("_id", -1).limit(limit))

    for session in sessions:
        if "_id" in session:
            session["sessionId"] = str(session["_id"])
            session["_id"] = str(session["_id"])

    return sessions
