"""MCP Docs server: read, create, append, create_meeting_notes. Logs to google_activity."""
from typing import Any, Dict, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.db.repository import log_google_activity


def _docs_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("docs", "v1", credentials=creds)


def _drive_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("drive", "v3", credentials=creds)


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({"user_id": user_id, "service": "docs", "action": action, "details": details})


def read_document(user_token: str, doc_id: str) -> str:
    """Get document content by doc id."""
    user_id = ""
    try:
        service = _docs_service(user_token)
        doc = service.documents().get(documentId=doc_id).execute()
        content = []
        for elem in doc.get("body", {}).get("content", []):
            if "paragraph" in elem:
                for run in elem["paragraph"].get("elements", []):
                    if "textRun" in run and run["textRun"].get("content"):
                        content.append(run["textRun"]["content"])
        _log_activity(user_id, "read_document", {"doc_id": doc_id})
        return "".join(content).strip() or "(empty)"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_document(user_token: str, title: str, content: str = "") -> str:
    """Create a new Google Doc with optional initial content. Returns doc id and webViewLink."""
    user_id = ""
    try:
        docs_svc = _docs_service(user_token)
        drive_svc = _drive_service(user_token)
        body = {"title": title}
        doc = docs_svc.documents().create(body=body).execute()
        doc_id = doc.get("documentId")
        if content:
            doc = docs_svc.documents().get(documentId=doc_id).execute()
            end_index = 1
            for elem in doc.get("body", {}).get("content", []):
                if "endIndex" in elem:
                    end_index = elem["endIndex"]
            docs_svc.documents().batchUpdate(documentId=doc_id, body={"requests": [{"insertText": {"location": {"index": end_index - 1}, "text": content}}]}).execute()
        file_meta = drive_svc.files().get(fileId=doc_id, fields="webViewLink").execute()
        link = file_meta.get("webViewLink", f"https://docs.google.com/document/d/{doc_id}/edit")
        _log_activity(user_id, "create_document", {"title": title, "doc_id": doc_id})
        return str({"id": doc_id, "webViewLink": link})
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def append_to_doc(user_token: str, doc_id: str, text: str) -> str:
    """Append text at the end of a document."""
    user_id = ""
    try:
        service = _docs_service(user_token)
        doc = service.documents().get(documentId=doc_id).execute()
        end_index = 1
        for elem in doc.get("body", {}).get("content", []):
            if "endIndex" in elem:
                end_index = elem["endIndex"]
        service.documents().batchUpdate(documentId=doc_id, body={"requests": [{"insertText": {"location": {"index": end_index - 1}, "text": text}}]}).execute()
        _log_activity(user_id, "append_to_doc", {"doc_id": doc_id})
        return "ok"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_meeting_notes(user_token: str, doc_id: Optional[str], session_summary: str) -> str:
    """Create or append meeting notes from session summary. If doc_id is empty, creates a new doc."""
    user_id = ""
    try:
        if doc_id:
            append_to_doc(user_token, doc_id, "\n\n---\n\n" + session_summary)
            _log_activity(user_id, "create_meeting_notes", {"doc_id": doc_id})
            return str({"doc_id": doc_id})
        return create_document(user_token, "Meeting Notes", session_summary)
    except Exception as e:
        return f"Error: {e}"
