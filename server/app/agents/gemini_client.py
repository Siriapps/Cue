import json
import os
import sys
from typing import Any, Dict, List, Optional

import requests

# API call counter for tracking
_api_call_count = 0


def _get_model() -> str:
    configured = os.getenv("GEMINI_MODEL", "").strip()
    allowed = {"gemini-2.5-flash", "gemini-2.5-pro"}
    # Force valid model - if not in allowed set, use default
    if configured and configured in allowed:
        return configured
    # Always default to gemini-2.5-flash (never use 1.5)
    return "gemini-2.5-flash"


def _get_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return api_key


def call_gemini(
    parts: List[Dict[str, Any]],
    system_prompt: Optional[str] = None,
    response_mime_type: str = "application/json",
) -> Dict[str, Any]:
    global _api_call_count
    _api_call_count += 1
    
    # Warn if exceeding 20 API calls
    if _api_call_count > 20:
        print(
            f"⚠️  WARNING: API call count exceeded 20 (current: {_api_call_count})",
            file=sys.stderr
        )
    
    api_key = _get_api_key()
    model = _get_model()
    # Ensure we're using gemini-2.5-flash, never 1.5
    if "1.5" in model or model not in {"gemini-2.5-flash", "gemini-2.5-pro"}:
        model = "gemini-2.5-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    )

    payload: Dict[str, Any] = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": response_mime_type},
    }
    if system_prompt:
        payload["systemInstruction"] = {
            "role": "system",
            "parts": [{"text": system_prompt}],
        }

    response = requests.post(url, params={"key": api_key}, json=payload, timeout=90)
    response.raise_for_status()
    data = response.json()

    candidates = data.get("candidates", [])
    if not candidates:
        return {"error": "No candidates returned from Gemini"}
    content_parts = candidates[0].get("content", {}).get("parts", [])
    if not content_parts:
        return {"error": "No content parts returned from Gemini"}

    text = content_parts[0].get("text", "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw_text": text}
