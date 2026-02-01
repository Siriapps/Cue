"""MCP Gmail server: list, read, send, draft, get recent threads. Logs to google_activity."""
from typing import Any, Dict, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import base64
import email.mime.text
import email.mime.multipart

from app.db.repository import log_google_activity


def _gmail_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("gmail", "v1", credentials=creds)


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({
        "user_id": user_id,
        "service": "gmail",
        "action": action,
        "details": details,
    })


def list_emails(user_token: str, query: str = "", max_results: int = 10) -> str:
    """List/search emails. query: Gmail search string; max_results: max number to return."""
    user_id = ""
    try:
        service = _gmail_service(user_token)
        result = service.users().messages().list(userId="me", q=query or None, maxResults=max_results).execute()
        messages = result.get("messages", [])
        ids = [m["id"] for m in messages]
        _log_activity(user_id, "list_emails", {"query": query, "count": len(ids)})
        return str(ids)
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def read_email(user_token: str, message_id: str) -> str:
    """Get full email content by message id."""
    user_id = ""
    try:
        service = _gmail_service(user_token)
        msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
        payload = msg.get("payload", {})
        headers = {h["name"]: h["value"] for h in payload.get("headers", [])}
        body = ""
        if "body" in payload and payload["body"].get("data"):
            body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
        _log_activity(user_id, "read_email", {"message_id": message_id})
        return str({"headers": headers, "snippet": msg.get("snippet", ""), "body_preview": body[:500] if body else ""})
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def send_email(user_token: str, to: str, subject: str, body: str) -> str:
    """Send an email. Returns message id or error."""
    user_id = ""
    try:
        service = _gmail_service(user_token)
        message = email.mime.text.MIMEText(body, "plain", "utf-8")
        message["to"] = to
        message["subject"] = subject
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
        _log_activity(user_id, "send_email", {"to": to, "subject": subject, "message_id": result.get("id")})
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_draft(user_token: str, to: str, subject: str, body: str) -> str:
    """Create a new draft email with To, Subject, and body as proper fields."""
    user_id = ""
    try:
        service = _gmail_service(user_token)
        draft_msg = email.mime.text.MIMEText(body, "plain", "utf-8")
        draft_msg["to"] = to
        draft_msg["subject"] = subject
        raw = base64.urlsafe_b64encode(draft_msg.as_bytes()).decode()
        result = service.users().drafts().create(userId="me", body={"message": {"raw": raw}}).execute()
        # Do not log create_draft to activity (user requested draft generation not recorded)
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def draft_reply(user_token: str, email_id: str, message: str) -> str:
    """Create a draft reply to an email. email_id: message id to reply to."""
    user_id = ""
    try:
        service = _gmail_service(user_token)
        msg = service.users().messages().get(userId="me", id=email_id, format="metadata").execute()
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        reply_to = headers.get("From", "")
        subject = headers.get("Subject", "Re:")
        if not subject.startswith("Re:"):
            subject = "Re: " + subject
        draft_msg = email.mime.text.MIMEText(message, "plain", "utf-8")
        draft_msg["to"] = reply_to
        draft_msg["subject"] = subject
        raw = base64.urlsafe_b64encode(draft_msg.as_bytes()).decode()
        result = service.users().drafts().create(userId="me", body={"message": {"raw": raw, "threadId": msg.get("threadId")}}).execute()
        _log_activity(user_id, "draft_reply", {"email_id": email_id, "draft_id": result.get("id")})
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def get_recent_threads(user_token: str, count: int = 10) -> str:
    """Get recent conversation threads."""
    user_id = ""
    try:
        service = _gmail_service(user_token)
        result = service.users().threads().list(userId="me", maxResults=count).execute()
        threads = result.get("threads", [])
        ids = [t["id"] for t in threads]
        _log_activity(user_id, "get_recent_threads", {"count": len(ids)})
        return str(ids)
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"
