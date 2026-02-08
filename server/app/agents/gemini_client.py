import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests
from google import genai

logger = logging.getLogger(__name__)

# API call counter for tracking
_api_call_count = 0

# Video (Veo) configuration - same API key as text
VEO_MODEL = "veo-3.1-generate-preview"
MAX_POLL_ATTEMPTS = 60
POLL_INTERVAL_SECONDS = 5
MAX_RETRIES = 3
BASE_DELAY_SECONDS = 10
MIN_DELAY_BETWEEN_CALLS = 10


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
    chat_history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Call Gemini. chat_history: list of {role: 'user'|'assistant', text: str} for multi-turn context."""
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

    # Build contents: chat history (user/model turns) + current user message
    contents: List[Dict[str, Any]] = []
    if chat_history:
        for msg in chat_history:
            role = msg.get("role", "user")
            gemini_role = "model" if role == "assistant" else "user"
            text = msg.get("text", "")
            if text:
                contents.append({"role": gemini_role, "parts": [{"text": text}]})
    contents.append({"role": "user", "parts": parts})

    payload: Dict[str, Any] = {
        "contents": contents,
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


# ================== Video generation (Veo via Gemini API) ==================


def _get_genai_client() -> genai.Client:
    """Get GenAI client for video generation (same API key as text)."""
    return genai.Client(api_key=_get_api_key())


def build_video_prompt(summary: Dict[str, Any]) -> str:
    """
    Build a descriptive video prompt from session summary.
    Creates a concise, visual prompt suitable for Veo video generation.
    """
    tldr = summary.get("tldr", "")
    key_points = summary.get("key_points", [])
    topic = summary.get("topic", "Meeting Summary")
    sentiment = summary.get("sentiment", "Professional")

    points_text = ""
    if key_points:
        points_text = "Key highlights: " + "; ".join(key_points[:3])

    prompt = f"""Create a 30-second animated explainer video summary.

Topic: {topic}
Main message: {tldr}
{points_text}
Tone: {sentiment}

Visual style: Modern minimalist motion graphics with smooth transitions.
Use abstract shapes, icons, and flowing animations to represent concepts.
Include subtle text overlays for key points.
Color palette: Professional blues, purples, and white accents.
No human faces or characters."""

    return prompt.strip()


def _is_rate_limit_error(error: Exception) -> bool:
    """Check if an error is a rate limit (429) or quota exhausted error."""
    error_str = str(error).lower()
    error_type = type(error).__name__.lower()
    rate_limit_indicators = [
        "429", "rate limit", "quota", "too many requests",
        "resource exhausted", "exceeded", "throttle", "resource_exhausted"
    ]
    for indicator in rate_limit_indicators:
        if indicator in error_str:
            return True
    if "rate" in error_type or "quota" in error_type or "throttle" in error_type:
        return True
    if hasattr(error, "status_code") and error.status_code == 429:
        return True
    if hasattr(error, "code") and error.code == 429:
        return True
    if hasattr(error, "__dict__") and isinstance(error.__dict__, dict):
        d = error.__dict__
        if d.get("code") == 429:
            return True
        if "error" in d and isinstance(d["error"], dict):
            ne = d["error"]
            if ne.get("code") == 429 or ne.get("status") == "RESOURCE_EXHAUSTED":
                return True
    return False


def generate_video_from_summary_sync(summary: Dict[str, Any]) -> Optional[str]:
    """
    Generate a video summary using Gemini API (Veo). Synchronous version.
    Returns video URI if successful, None otherwise.
    """
    time.sleep(MIN_DELAY_BETWEEN_CALLS)

    for attempt in range(MAX_RETRIES):
        try:
            client = _get_genai_client()
            prompt = build_video_prompt(summary)

            if attempt > 0:
                logger.info(f"[Gemini/Veo] Retry attempt {attempt + 1}/{MAX_RETRIES} for video generation")
                print(f"[Gemini/Veo] Retry attempt {attempt + 1}/{MAX_RETRIES}")
            else:
                logger.info(f"[Gemini/Veo] Generating video with prompt: {prompt[:100]}...")
                print(f"[Gemini/Veo] Starting video generation with model: {VEO_MODEL}")

            operation = client.models.generate_videos(
                model=VEO_MODEL,
                prompt=prompt,
            )

            print("[Gemini/Veo] Operation started, polling for completion...")
            poll_count = 0
            while not operation.done:
                if poll_count >= MAX_POLL_ATTEMPTS:
                    logger.error("[Gemini/Veo] Video generation timed out")
                    print("[Gemini/Veo] Video generation timed out")
                    return None
                print(f"[Gemini/Veo] Waiting for video generation... (attempt {poll_count + 1}/{MAX_POLL_ATTEMPTS})")
                time.sleep(POLL_INTERVAL_SECONDS)
                try:
                    operation = client.operations.get(operation)
                except Exception as poll_error:
                    if _is_rate_limit_error(poll_error):
                        logger.warning(f"[Gemini/Veo] Rate limit during polling: {poll_error}")
                        raise poll_error
                    logger.warning(f"[Gemini/Veo] Polling error (non-fatal): {poll_error}")
                    continue
                poll_count += 1

            if not operation.response or not operation.response.generated_videos:
                logger.warning("[Gemini/Veo] No videos in response")
                print("[Gemini/Veo] No videos in response")
                return None

            generated_video = operation.response.generated_videos[0]
            if hasattr(generated_video, "video") and generated_video.video:
                video_uri = generated_video.video.uri if hasattr(generated_video.video, "uri") else None
                if video_uri:
                    logger.info(f"[Gemini/Veo] Video generated successfully: {video_uri}")
                    print(f"[Gemini/Veo] Video generated: {video_uri}")
                    return video_uri

            logger.warning("[Gemini/Veo] Could not extract video URI from response")
            print("[Gemini/Veo] Could not extract video URI from response")
            return None

        except Exception as e:
            if _is_rate_limit_error(e) and attempt < MAX_RETRIES - 1:
                wait_time = BASE_DELAY_SECONDS * (2 ** attempt)
                logger.warning(f"[Gemini/Veo] Rate limit error (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                print(f"[Gemini/Veo] Rate limit error detected. Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
                continue
            if attempt < MAX_RETRIES - 1:
                logger.error(f"[Gemini/Veo] Video generation failed (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                wait_time = BASE_DELAY_SECONDS * (2 ** attempt)
                time.sleep(wait_time)
                continue
            logger.error(f"[Gemini/Veo] Video generation failed after {MAX_RETRIES} attempts: {e}")
            print(f"[Gemini/Veo] Error after {MAX_RETRIES} attempts: {e}")
            return None

    logger.error("[Gemini/Veo] Video generation failed: Max retries exceeded")
    print("[Gemini/Veo] Video generation failed: Max retries exceeded")
    return None


async def generate_video_from_summary(
    summary: Dict[str, Any],
    api_key: Optional[str] = None,
) -> Optional[str]:
    """
    Generate a video summary using Gemini API (Veo). Async wrapper.
    api_key is ignored; uses GEMINI_API_KEY from environment.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, generate_video_from_summary_sync, summary)


def generate_video_sync(summary: Dict[str, Any]) -> Optional[str]:
    """Synchronous wrapper for generate_video_from_summary."""
    return generate_video_from_summary_sync(summary)
