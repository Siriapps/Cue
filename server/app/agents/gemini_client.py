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

# Public API: call_gemini and generate_content (alias) for text; image; video helpers for Veo
__all__ = ["call_gemini", "generate_content", "generate_session_image", "generate_video_from_summary", "generate_video_from_summary_sync"]

# API call counter for tracking
_api_call_count = 0

# Video (Veo) configuration - same API key as text
VEO_MODEL = "veo-3.1-generate-preview"
MAX_POLL_ATTEMPTS = 60
POLL_INTERVAL_SECONDS = 5
MAX_RETRIES = 3
BASE_DELAY_SECONDS = 10
MIN_DELAY_BETWEEN_CALLS = 10


# Fallback models if env model fails (e.g. not yet available)
FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"]


def _get_model() -> str:
    """Use GEMINI_MODEL from env; if unset, default to gemini-2.5-flash."""
    configured = os.getenv("GEMINI_MODEL", "").strip()
    if configured:
        return configured
    return "gemini-2.5-flash"


def _model_from_env() -> bool:
    """True if GEMINI_MODEL is explicitly set in .env (no fallback in that case)."""
    return bool(os.getenv("GEMINI_MODEL", "").strip())


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
    # #region agent log
    try:
        _log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), ".cursor", "debug.log")
        with open(_log_path, "a", encoding="utf-8") as _f:
            _f.write('{"location":"gemini_client.py:call_gemini","message":"call_gemini invoked","data":{"parts_len":%d},"timestamp":%d,"sessionId":"debug-session","hypothesisId":"H4"}\n' % (len(parts), int(time.time() * 1000)))
    except Exception:
        pass
    # #endregion
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

    # Only allow fallback when no model is declared in .env; if GEMINI_MODEL is set, use it only (no fallback on 429 or any error).
    if _model_from_env():
        models_to_try = [model]
    else:
        models_to_try = [model] + [m for m in FALLBACK_MODELS if m != model]
    last_error: Optional[Exception] = None
    data: Optional[Dict[str, Any]] = None

    for try_model in models_to_try:
        try_url = f"https://generativelanguage.googleapis.com/v1beta/models/{try_model}:generateContent"
        try:
            response = requests.post(try_url, params={"key": api_key}, json=payload, timeout=90)
            response.raise_for_status()
            data = response.json()
            break
        except requests.RequestException as e:
            last_error = e
            err_msg = str(e).lower()
            err_body = ""
            status = getattr(getattr(e, "response", None), "status_code", None)
            if hasattr(e, "response") and e.response is not None:
                try:
                    err_body = (e.response.text or "").lower()
                except Exception:
                    pass
            # Only fallback on model-not-available (404). Never fallback on 429 (rate limit).
            if try_model == models_to_try[-1]:
                raise
            if status == 429:
                raise  # Rate limit: do not try another model
            is_model_not_found = status == 404 or (status == 400 and ("not found" in err_body or "invalid" in err_body or "unknown" in err_body))
            if not is_model_not_found:
                raise
            if try_model != model:
                logger.warning(f"[Gemini] Model {try_model} unavailable, trying fallback")
            continue

    if data is None:
        raise last_error or RuntimeError("No response from Gemini")

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


# Alias for callers that expect the old name (e.g. generate_content)
generate_content = call_gemini


# ================== Image generation (session card thumbnails) ==================


def _get_image_model() -> str:
    """Use GEMINI_IMAGE_MODEL from env; default nano-banana-pro-preview."""
    configured = os.getenv("GEMINI_IMAGE_MODEL", "").strip()
    if configured:
        return configured
    return "nano-banana-pro-preview"


def generate_session_image(prompt: str) -> Dict[str, Any]:
    """
    Generate a single image from a text prompt using the image model.
    Returns {"image_base64": str, "mime_type": str} or {"error": str}.
    Uses same API key as text; URL pattern: .../models/{model}:generateContent.
    """
    api_key = _get_api_key()
    model = _get_image_model()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload: Dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt[:2000]}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    try:
        response = requests.post(url, params={"key": api_key}, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as e:
        logger.warning("[Gemini] Session image request failed: %s", e)
        return {"error": str(e)}
    candidates = data.get("candidates", [])
    if not candidates:
        return {"error": "No candidates returned from image model"}
    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline = part.get("inlineData")
        if inline and inline.get("data"):
            mime = inline.get("mimeType", "image/png")
            return {"image_base64": inline["data"], "mime_type": mime}
    return {"error": "No image in response"}


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
