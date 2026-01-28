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
