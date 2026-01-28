from typing import Any, Dict

from app.agents.gemini_client import call_gemini


INTENT_PROMPT = """
You are a predictive intent agent. Classify user state based on browsing context.
Return strict JSON:
{
  "prediction": "BROWSING" | "FOCUSED" | "STUCK" | "TRANSITIONING",
  "confidence": 0.0-1.0,
  "suggested_action": "none" | "open_ide" | "summarize" | "start_session",
  "reason": "short explanation"
}
"""


def analyze_intent(context: Dict[str, Any]) -> Dict[str, Any]:
    parts = [
        {
            "text": (
                "Analyze the following context for user intent:\n"
                f"{context}"
            )
        }
    ]
    return call_gemini(parts=parts, system_prompt=INTENT_PROMPT)
