"""
Veo 3 Video Generation Service

Generates video summaries from session data using Google's Veo API via the GenAI SDK.
"""
import asyncio
import os
import logging
import time
from typing import Any, Dict, Optional

from google import genai

logger = logging.getLogger(__name__)

# Veo API configuration
VEO_MODEL = "veo-3.1-generate-preview"

# Polling configuration
MAX_POLL_ATTEMPTS = 60  # Max 5 minutes (60 * 5 seconds)
POLL_INTERVAL_SECONDS = 5

# Rate limiting and retry configuration
MAX_RETRIES = 3
BASE_DELAY_SECONDS = 10  # Increased from 5 to handle quota exhaustion
MIN_DELAY_BETWEEN_CALLS = 10  # Increased from 5 to reduce API call frequency


def _get_client() -> genai.Client:
    """Get GenAI client configured with API key."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def build_video_prompt(summary: Dict[str, Any]) -> str:
    """
    Build a descriptive video prompt from session summary.
    Creates a concise, visual prompt suitable for Veo video generation.
    """
    tldr = summary.get("tldr", "")
    key_points = summary.get("key_points", [])
    topic = summary.get("topic", "Meeting Summary")
    sentiment = summary.get("sentiment", "Professional")

    # Format key points for the prompt
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


def is_rate_limit_error(error: Exception) -> bool:
    """
    Check if an error is a rate limit error (429) or quota exhausted error.
    
    Args:
        error: Exception to check
        
    Returns:
        True if error is a rate limit/quota error, False otherwise
    """
    error_str = str(error).lower()
    error_type = type(error).__name__.lower()
    
    # Check error message for rate limit indicators
    rate_limit_indicators = [
        "429",
        "rate limit",
        "quota",
        "too many requests",
        "resource exhausted",
        "exceeded",
        "throttle",
        "resource_exhausted"
    ]
    
    # Check if any indicator is in the error string
    for indicator in rate_limit_indicators:
        if indicator in error_str:
            return True
    
    # Check error type (Google GenAI SDK may raise specific exceptions)
    if "rate" in error_type or "quota" in error_type or "throttle" in error_type:
        return True
    
    # Check for HTTP status codes in error
    if hasattr(error, 'status_code') and error.status_code == 429:
        return True
    
    if hasattr(error, 'code') and error.code == 429:
        return True
    
    # Check for error dict structure (Google GenAI SDK format)
    if hasattr(error, '__dict__'):
        error_dict = error.__dict__
        if isinstance(error_dict, dict):
            # Check for error code 429
            if error_dict.get('code') == 429:
                return True
            # Check nested error dict
            if 'error' in error_dict:
                nested_error = error_dict['error']
                if isinstance(nested_error, dict):
                    if nested_error.get('code') == 429 or nested_error.get('status') == 'RESOURCE_EXHAUSTED':
                        return True
    
    return False


def generate_video_from_summary_sync(
    summary: Dict[str, Any],
) -> Optional[str]:
    """
    Generate a video summary using Google's Veo API (synchronous version).
    Includes retry logic with exponential backoff for rate limit errors.

    Args:
        summary: Session summary dict with tldr, key_points, topic, sentiment

    Returns:
        Video file path if successful, None otherwise
    """
    # Minimum delay before making any API call
    time.sleep(MIN_DELAY_BETWEEN_CALLS)
    
    for attempt in range(MAX_RETRIES):
        try:
            client = _get_client()
            prompt = build_video_prompt(summary)

            if attempt > 0:
                logger.info(f"[Veo] Retry attempt {attempt + 1}/{MAX_RETRIES} for video generation")
                print(f"[Veo] Retry attempt {attempt + 1}/{MAX_RETRIES}")
            else:
                logger.info(f"[Veo] Generating video with prompt: {prompt[:100]}...")
                print(f"[Veo] Starting video generation with model: {VEO_MODEL}")

            # Start video generation operation
            operation = client.models.generate_videos(
                model=VEO_MODEL,
                prompt=prompt,
            )

            print(f"[Veo] Operation started, polling for completion...")

            # Poll the operation status until the video is ready
            poll_count = 0
            while not operation.done:
                if poll_count >= MAX_POLL_ATTEMPTS:
                    logger.error("[Veo] Video generation timed out")
                    print("[Veo] Video generation timed out")
                    return None

                print(f"[Veo] Waiting for video generation... (attempt {poll_count + 1}/{MAX_POLL_ATTEMPTS})")
                time.sleep(POLL_INTERVAL_SECONDS)
                
                try:
                    operation = client.operations.get(operation)
                except Exception as poll_error:
                    # If polling fails with rate limit, retry the whole operation
                    if is_rate_limit_error(poll_error):
                        logger.warning(f"[Veo] Rate limit during polling: {poll_error}")
                        print(f"[Veo] Rate limit during polling, will retry operation")
                        raise poll_error
                    # Other polling errors are non-fatal, continue
                    logger.warning(f"[Veo] Polling error (non-fatal): {poll_error}")
                    continue
                
                poll_count += 1

            # Check if we have generated videos
            if not operation.response or not operation.response.generated_videos:
                logger.warning("[Veo] No videos in response")
                print("[Veo] No videos in response")
                return None

            # Get the first generated video
            generated_video = operation.response.generated_videos[0]

            # Get the video URI (this is the URL we can use)
            if hasattr(generated_video, 'video') and generated_video.video:
                video_uri = generated_video.video.uri if hasattr(generated_video.video, 'uri') else None
                if video_uri:
                    logger.info(f"[Veo] Video generated successfully: {video_uri}")
                    print(f"[Veo] Video generated: {video_uri}")
                    return video_uri

            # If no URI, try to get the video data directly
            logger.warning("[Veo] Could not extract video URI from response")
            print("[Veo] Could not extract video URI from response")
            return None

        except Exception as e:
            # Check if this is a rate limit error
            if is_rate_limit_error(e) and attempt < MAX_RETRIES - 1:
                wait_time = BASE_DELAY_SECONDS * (2 ** attempt)
                logger.warning(f"[Veo] Rate limit error (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                logger.info(f"[Veo] Waiting {wait_time} seconds before retry...")
                print(f"[Veo] Rate limit error detected. Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
                continue
            else:
                # Not a rate limit error, or max retries reached
                if attempt < MAX_RETRIES - 1:
                    logger.error(f"[Veo] Video generation failed (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                    print(f"[Veo] Error (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                    # Wait a bit before retrying even non-rate-limit errors
                    wait_time = BASE_DELAY_SECONDS * (2 ** attempt)
                    time.sleep(wait_time)
                    continue
                else:
                    logger.error(f"[Veo] Video generation failed after {MAX_RETRIES} attempts: {e}")
                    print(f"[Veo] Error after {MAX_RETRIES} attempts: {e}")
                    return None
    
    # Should not reach here, but just in case
    logger.error("[Veo] Video generation failed: Max retries exceeded")
    print("[Veo] Video generation failed: Max retries exceeded")
    return None


async def generate_video_from_summary(
    summary: Dict[str, Any],
    api_key: Optional[str] = None
) -> Optional[str]:
    """
    Generate a video summary using Google's Veo API (async wrapper).

    Args:
        summary: Session summary dict with tldr, key_points, topic, sentiment
        api_key: Optional API key (defaults to GEMINI_API_KEY env var)

    Returns:
        Video URL string if successful, None otherwise
    """
    # Run the synchronous version in a thread pool to not block the event loop
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        generate_video_from_summary_sync,
        summary
    )


# Convenience function for synchronous contexts
def generate_video_sync(summary: Dict[str, Any]) -> Optional[str]:
    """Synchronous wrapper for generate_video_from_summary."""
    return generate_video_from_summary_sync(summary)
