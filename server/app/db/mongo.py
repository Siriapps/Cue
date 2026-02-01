import os
from typing import Optional

from pymongo import MongoClient

_client: Optional[MongoClient] = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI")
        if not uri:
            raise RuntimeError("MONGODB_URI is not set")
        _client = MongoClient(uri)
    return _client


def get_db(db_name: str = "cue"):
    client = get_client()
    return client[db_name]


def watch_sessions_collection(broadcast_fn):
    """Watch sessions for inserts; call broadcast_fn with {type: NEW_SESSION_FROM_DB, session}. Runs in thread. Requires replica set."""
    import threading
    def run():
        try:
            db = get_db()
            pipeline = [{"$match": {"operationType": "insert"}}]
            with db.sessions.watch(pipeline) as stream:
                for change in stream:
                    doc = change.get("fullDocument")
                    if doc and doc.get("_id"):
                        doc["_id"] = str(doc["_id"])
                        doc["sessionId"] = doc["_id"]
                        broadcast_fn({"type": "NEW_SESSION_FROM_DB", "session": doc})
        except Exception as e:
            print(f"[cue] Change stream error (replica set required): {e}")
    t = threading.Thread(target=run, daemon=True)
    t.start()
