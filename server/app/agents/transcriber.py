"""
Transcriber Agent - Transcribes audio and generates session summaries using Gemini.
"""
from typing import Any, Dict, Optional
import json

from app.agents.gemini_client import call_gemini


TRANSCRIBE_PROMPT = """
Transcribe the audio content accurately. Include all spoken words.
If there is music or non-speech audio, note it briefly in brackets.

Output the transcription as plain text only, no JSON formatting.
"""


SUMMARY_PROMPT = """
You are an executive assistant analyzing a recorded session.

Generate a structured summary of the session including:
1. A brief TL;DR (1-2 sentences)
2. Key points discussed (3-5 bullet points)
3. Action items if any were mentioned
4. The overall topic/theme

Return strict JSON in this exact format:
{
    "tldr": "One or two sentence summary...",
    "key_points": [
        "First key point...",
        "Second key point...",
        "Third key point..."
    ],
    "action_items": [
        {"task": "Action to take", "priority": "High|Medium|Low"},
        {"task": "Another action", "priority": "Medium"}
    ],
    "topic": "Main topic or theme",
    "sentiment": "Informative|Educational|Casual|Professional|Entertainment"
}

If no action items were mentioned, return an empty array for action_items.
"""


def transcribe_audio(
    audio_base64: str,
    mime_type: str,
) -> str:
    """
    Transcribe audio using Gemini's multimodal capabilities.
    
    Args:
        audio_base64: Base64 encoded audio data
        mime_type: MIME type of the audio (e.g., "audio/webm")
    
    Returns:
        Transcribed text
    """
    parts = [
        {"text": "Transcribe this audio recording:"},
        {
            "inlineData": {
                "mimeType": mime_type,
                "data": audio_base64,
            }
        },
    ]
    
    result = call_gemini(
        parts=parts,
        system_prompt=TRANSCRIBE_PROMPT,
        response_mime_type="text/plain",
    )
    
    # Handle different response formats
    if isinstance(result, str):
        return result
    
    if "raw_text" in result:
        return result["raw_text"]
    
    if "error" in result:
        print(f"Transcription error: {result['error']}")
        return ""
    
    # Try to extract text from any format
    if "text" in result:
        return result["text"]
    
    return str(result) if result else ""


def generate_session_summary(
    transcript: str,
    title: Optional[str] = None,
    source_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate a structured summary from a transcript using Gemini.
    
    Args:
        transcript: The full transcription text
        title: Optional title/source of the recording
        source_url: Optional URL where the content was recorded
    
    Returns:
        Structured summary with tldr, key_points, action_items, etc.
    """
    context_parts = []
    
    if title:
        context_parts.append(f"Title: {title}")
    if source_url:
        context_parts.append(f"Source: {source_url}")
    
    context = "\n".join(context_parts) if context_parts else ""
    
    prompt = f"""
{context}

Transcript:
{transcript} 

Analyze this transcript and generate a summary.
"""
    
    parts = [{"text": prompt}]
    
    result = call_gemini(
        parts=parts,
        system_prompt=SUMMARY_PROMPT,
        response_mime_type="application/json",
    )
    
    # Ensure we have the expected format
    default_summary = {
        "tldr": "Session recorded but no clear summary could be generated.",
        "key_points": [],
        "action_items": [],
        "topic": "Unknown",
        "sentiment": "Neutral",
    }
    
    if isinstance(result, dict):
        # Validate and fill in missing fields
        return {
            "tldr": result.get("tldr", default_summary["tldr"]),
            "key_points": result.get("key_points", default_summary["key_points"]),
            "action_items": result.get("action_items", default_summary["action_items"]),
            "topic": result.get("topic", default_summary["topic"]),
            "sentiment": result.get("sentiment", default_summary["sentiment"]),
        }
    
    if "error" in result:
        print(f"Summary generation error: {result['error']}")
        return default_summary
    
    return default_summary
