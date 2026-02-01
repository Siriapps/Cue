"""Router Agent: classify intent from tab trajectory and current URL."""
from typing import Any, Dict, List

from app.agents.gemini_client import call_gemini

INTENT_LABELS = ["Researching", "Stuck", "Ready to Build", "Email/Communication", "Planning"]


def classify_intent(trajectory: List[Dict[str, Any]], current_url: str) -> Dict[str, Any]:
    """Classify user intent. Returns intent, confidence, evidence."""
    if not trajectory and not current_url:
        return {"intent": "Unknown", "confidence": 0.0, "evidence": []}
    trajectory_text = "\n".join(
        [f"- {t.get('url', '')} ({t.get('title', '')})" for t in (trajectory or [])[-10:]]
    )
    prompt = f"""Given this browsing trajectory and current URL, classify the user's intent into one of: {', '.join(INTENT_LABELS)}.

Trajectory (recent pages):
{trajectory_text or '(none)'}

Current URL: {current_url or '(none)'}

Respond with JSON: {"intent": "<label>", "confidence": <0-1>, "evidence": ["<short reason>"]}"""
    parts = [{"text": prompt}]
    system = "You are an intent classifier. Output only valid JSON."
    try:
        result = call_gemini(parts=parts, system_prompt=system, response_mime_type="application/json")
        if "error" in result:
            return {"intent": "Unknown", "confidence": 0.0, "evidence": [result["error"]]}
        intent = result.get("intent", "Unknown")
        if intent not in INTENT_LABELS:
            intent = INTENT_LABELS[0]
        return {
            "intent": intent,
            "confidence": float(result.get("confidence", 0.5)),
            "evidence": result.get("evidence", []),
        }
    except Exception as e:
        return {"intent": "Unknown", "confidence": 0.0, "evidence": [str(e)]}
