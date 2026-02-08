from typing import Any, Dict

from app.agents.gemini_client import call_gemini


ASK_AI_PROMPT = """
You are a helpful AI assistant integrated into a browser extension.
Answer the user's question concisely and helpfully based on the context provided.
Be friendly, clear, and to the point (2-4 sentences unless more detail is needed).
"""


def ask_ai(query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Answer a user's question using Gemini 2.5 Flash. Uses conversation history for context."""
    page_title = context.get("page_title", "")
    current_url = context.get("current_url", "")
    selected_text = context.get("selected_text", "")
    context_blob = context.get("context_blob", "")
    conversation_history = context.get("conversation_history") or []
    
    context_text = f"You are on: {page_title}\nURL: {current_url}"
    if selected_text:
        context_text += f"\nSelected text: {selected_text[:500]}"

    if context_blob:
        # Explicitly provided context from the client (e.g. recent searches / AI chat snippets).
        # Keep it bounded to avoid excessively large prompts.
        context_text += f"\n\nExplicit user context:\n{str(context_blob)[:8000]}"
    
    prompt = f"{context_text}\n\nUser's question: {query}\n\nProvide a helpful answer."
    
    parts = [{"text": prompt}]
    result = call_gemini(
        parts=parts,
        system_prompt=ASK_AI_PROMPT,
        response_mime_type="text/plain",
        chat_history=conversation_history,
    )
    
    # Extract answer from result
    if "raw_text" in result:
        return {"success": True, "answer": result["raw_text"]}
    elif "error" in result:
        return {"success": False, "error": result["error"]}
    else:
        # Try to extract text from any format
        answer = result.get("answer") or result.get("text") or str(result)
        return {"success": True, "answer": answer}
