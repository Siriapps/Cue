"""
Transcriber Agent - Transcribes audio and generates session summaries using Gemini.
"""
from typing import Any, Dict, Optional
import json

from app.agents.gemini_client import call_gemini


TRANSCRIBE_PROMPT = """
You are a literal speech-to-text transcriber.

Rules:
- Transcribe ONLY what is actually spoken in the audio.
- Do NOT add commentary, interpretations, scene descriptions, or summaries.
- If audio is unclear, use [inaudible] rather than guessing.
- If there is music or non-speech audio, note it briefly in brackets (e.g. [music], [applause]).
- If you cannot hear any speech, output an empty string.

Output plain text only (no JSON, no markdown).
"""


SUMMARY_PROMPT = """
You are summarizing a recorded session.

IMPORTANT: You MUST be strictly grounded in the provided transcript.
- Only include information that is explicitly stated in the transcript.
- Do NOT guess, fill in missing details, invent names/companies, or add outside knowledge.
- If something is unclear or not mentioned, omit it.
- Action items must be things the speaker explicitly said they will do / need to do (otherwise action_items must be []).

Generate a structured summary including:
1) TL;DR (1-2 sentences) — only what the transcript clearly supports.
2) Key points (3-5 bullets) — prefer short, concrete statements; avoid interpretation.
3) Action items (0-5) — ONLY if explicitly mentioned.
4) Topic/theme — if not obvious, use "Unknown".
5) Sentiment — choose the closest label based on how the transcript reads; if unsure use "Informative".

Return strict JSON in this exact format:
{
  "tldr": "...",
  "key_points": ["..."],
  "action_items": [{"task": "...", "priority": "High|Medium|Low"}],
  "topic": "...",
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
        generation_config={
            "temperature": 0,
            "topP": 0,
            # Keep chunks short; avoids runaway generations.
            "maxOutputTokens": 1024,
        },
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
        generation_config={
            "temperature": 0,
            "topP": 0,
            "maxOutputTokens": 1024,
        },
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
