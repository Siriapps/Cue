from typing import Any, Dict, List, Optional
from bson import ObjectId

from app.db.mongo import get_db


def _collection(name: str):
    db = get_db()
    return db[name]


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
