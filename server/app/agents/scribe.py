from typing import Any, Dict, Optional

from app.agents.gemini_client import call_gemini


SCRIBE_PROMPT = """
Analyze this audio segment. If the speaker explains a complex process or system,
output a JSON object representing a Mermaid flowchart or timeline. If it's general
chatter, return null.

Return strict JSON:
{
  "type": "diagram",
  "mermaid_code": "graph TD; A[Input] --> B[Process]...",
  "timestamp": "00:30",
  "node_timestamps": {
    "Node_A": "00:15",
    "Node_B": "00:25"
  }
}
"""


def process_audio_chunk(
    audio_base64: str,
    mime_type: str,
    chunk_start_seconds: Optional[int] = None,
    source_url: Optional[str] = None,
) -> Dict[str, Any]:
    prompt_text = "Analyze the audio segment and return Mermaid if needed."
    if chunk_start_seconds is not None:
        prompt_text += f"\nChunk start: {chunk_start_seconds} seconds."
    if source_url:
        prompt_text += f"\nSource URL: {source_url}"

    parts = [
        {"text": prompt_text},
        {
            "inlineData": {
                "mimeType": mime_type,
                "data": audio_base64,
            }
        },
    ]
    return call_gemini(parts=parts, system_prompt=SCRIBE_PROMPT)
