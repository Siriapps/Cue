from typing import Any, Dict, Optional

from app.agents.gemini_client import call_gemini


PRISM_PROMPT = """
You are an Executive Assistant. Extract actionable tasks and key insights.
Return strict JSON:
{
  "summary_tldr": "One sentence overview.",
  "tasks": [
    {"action": "Email Sarah", "priority": "High"},
    {"action": "Review Q3 Report", "priority": "Medium"}
  ],
  "sentiment": "Urgent" | "Neutral" | "Positive"
}
"""


def summarize_context(
    text: str,
    source_url: Optional[str] = None,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    prompt_text = "Summarize and extract tasks from the following content."
    if title:
        prompt_text += f"\nTitle: {title}"
    if source_url:
        prompt_text += f"\nSource: {source_url}"
    prompt_text += f"\n\nContent:\n{text}"
    parts = [{"text": prompt_text}]
    return call_gemini(parts=parts, system_prompt=PRISM_PROMPT)
