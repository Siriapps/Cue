"""Predictor Agent: predict next step from intent, trajectory, and vector search over past sessions."""
from typing import Any, Dict, List

from app.agents.embeddings import generate_embedding
from app.agents.gemini_client import call_gemini
from app.db.repository import search_sessions_by_embedding

CONFIDENCE_THRESHOLD = 0.8


def predict_next_step(
    intent: str,
    confidence: float,
    trajectory: List[Dict[str, Any]],
    current_url: str,
) -> Dict[str, Any]:
    """Predict next step. If confidence < 0.8 return no prediction. Uses vector search + Gemini."""
    if confidence < CONFIDENCE_THRESHOLD:
        return {"next_step": None, "mcp_tool": None, "reasoning": "Low confidence", "confidence": confidence}
    trajectory_text = "\n".join(
        [f"- {t.get('url', '')} ({t.get('title', '')})" for t in (trajectory or [])[-10:]]
    )
    context_query = f"Intent: {intent}. Current: {current_url}. Recent: {trajectory_text}"
    query_vector = generate_embedding(context_query)
    past_sessions = search_sessions_by_embedding(query_vector, limit=3)
    past_context = "\n".join(
        [f"- {s.get('title', '')}: {str(s.get('summary', {}).get('tldr', ''))[:200]}" for s in past_sessions]
    )
    prompt = f"""Intent: {intent} (confidence {confidence})
Current URL: {current_url}
Recent trajectory:
{trajectory_text or '(none)'}

Relevant past sessions:
{past_context or '(none)'}

Suggest the user's next step and an MCP tool to use. Respond with JSON:
{"next_step": "<one sentence>", "mcp_tool": "<tool name or null>", "reasoning": "<short>", "confidence": <0-1>}"""
    parts = [{"text": prompt}]
    system = "You are a predictor. Output only valid JSON."
    try:
        result = call_gemini(parts=parts, system_prompt=system, response_mime_type="application/json")
        if "error" in result:
            return {"next_step": None, "mcp_tool": None, "reasoning": result["error"], "confidence": 0.0}
        return {
            "next_step": result.get("next_step"),
            "mcp_tool": result.get("mcp_tool"),
            "reasoning": result.get("reasoning", ""),
            "confidence": float(result.get("confidence", 0.5)),
        }
    except Exception as e:
        return {"next_step": None, "mcp_tool": None, "reasoning": str(e), "confidence": 0.0}
