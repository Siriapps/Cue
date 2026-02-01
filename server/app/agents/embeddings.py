"""Generate text embeddings for vector search. Uses Gemini text-embedding when available."""
import os
from typing import List

import requests

EMBED_DIM = 768
GEMINI_EMBED_MODEL = "text-embedding-004"


def generate_embedding(text: str) -> List[float]:
    """Return embedding vector for text. Uses Gemini embed API if GEMINI_API_KEY set, else stub."""
    if not text or not text.strip():
        return [0.0] * EMBED_DIM
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return _stub_embedding(text)
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_EMBED_MODEL}:embedContent"
        payload = {
            "content": {"parts": [{"text": text[:8000]}]},
            "taskType": "RETRIEVAL_DOCUMENT",
        }
        r = requests.post(url, params={"key": api_key}, json=payload, timeout=15)
        r.raise_for_status()
        data = r.json()
        emb = data.get("embedding", {}).get("values")
        if emb:
            return emb
    except Exception:
        pass
    return _stub_embedding(text)


def _stub_embedding(text: str) -> List[float]:
    """Simple deterministic stub when API unavailable."""
    h = hash(text) % (2 ** 32)
    return [((h + i) % 1000) / 1000.0 - 0.5 for i in range(EMBED_DIM)]
