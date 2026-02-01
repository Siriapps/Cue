from typing import Any, Dict

from app.agents.gemini_client import call_gemini


ASK_AI_PROMPT = """
You are a helpful AI assistant integrated into a browser extension.
Answer the user's question concisely and helpfully based on the context provided.
Be friendly, clear, and to the point (2-4 sentences unless more detail is needed).
Do not reply with only a single word (e.g. "Done", "OK", "Yes"); always give a substantive, helpful answer.
"""


def ask_ai(query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Answer a user's question using Gemini 2.5 Flash."""
    page_title = context.get("page_title", "")
    current_url = context.get("current_url", "")
    selected_text = context.get("selected_text", "")
    user_display_name = context.get("user_display_name", "")
    user_email = context.get("user_email", "")
    recent_activity = context.get("recent_activity", "")

    context_text = f"You are on: {page_title}\nURL: {current_url}"
    if selected_text:
        context_text += f"\nSelected text: {selected_text[:500]}"
    if user_display_name or user_email:
        context_text += f"\nUser: {user_display_name or 'unknown'}" + (f" ({user_email})" if user_email else "")
    if recent_activity:
        context_text += f"\nRecent Google activity: {recent_activity}"

    prompt = f"{context_text}\n\nUser's question: {query}\n\nProvide a helpful answer."
    
    parts = [{"text": prompt}]
    result = call_gemini(parts=parts, system_prompt=ASK_AI_PROMPT, response_mime_type="text/plain")
    
    # Extract answer from result
    if "raw_text" in result:
        return {"success": True, "answer": result["raw_text"]}
    elif "error" in result:
        return {"success": False, "error": result["error"]}
    else:
        # Try to extract text from any format
        answer = result.get("answer") or result.get("text") or str(result)
        return {"success": True, "answer": answer}
