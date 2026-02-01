"""MCP Drive server: list, read, create, share, export. Logs to google_activity."""
from typing import Any, Dict, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
import io

from app.db.repository import log_google_activity


def _drive_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("drive", "v3", credentials=creds)


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({"user_id": user_id, "service": "drive", "action": action, "details": details})


def list_files(user_token: str, query: str = "", max_results: int = 20) -> str:
    """List/search Drive files. query: Drive search string; max_results: max to return."""
    user_id = ""
    try:
        service = _drive_service(user_token)
        kwargs = {"pageSize": max_results, "fields": "nextPageToken, files(id, name, mimeType, webViewLink)"}
        if query:
            kwargs["q"] = query
        result = service.files().list(**kwargs).execute()
        files = result.get("files", [])
        _log_activity(user_id, "list_files", {"count": len(files)})
        return str([{"id": f.get("id"), "name": f.get("name"), "mimeType": f.get("mimeType"), "webViewLink": f.get("webViewLink")} for f in files])
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def read_file_content(user_token: str, file_id: str) -> str:
    """Download file content by file id. Returns base64 or error."""
    user_id = ""
    try:
        service = _drive_service(user_token)
        request = service.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        content = buf.getvalue()
        _log_activity(user_id, "read_file_content", {"file_id": file_id})
        import base64
        return base64.b64encode(content).decode("utf-8")
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_file(user_token: str, name: str, content: str, mime_type: str = "text/plain") -> str:
    """Upload a new file. content: file body; mime_type: MIME type."""
    user_id = ""
    try:
        service = _drive_service(user_token)
        from googleapiclient.http import MediaIoBaseUpload
        file_metadata = {"name": name}
        media = MediaIoBaseUpload(io.BytesIO(content.encode("utf-8")), mimetype=mime_type, resumable=False)
        result = service.files().create(body=file_metadata, media_body=media, fields="id, webViewLink").execute()
        _log_activity(user_id, "create_file", {"name": name, "file_id": result.get("id")})
        return str({"id": result.get("id"), "webViewLink": result.get("webViewLink")})
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def share_file(user_token: str, file_id: str, email: str, role: str = "reader") -> str:
    """Share file with email. role: reader, writer, commenter."""
    user_id = ""
    try:
        service = _drive_service(user_token)
        body = {"type": "user", "role": role, "emailAddress": email}
        service.permissions().create(fileId=file_id, body=body, sendNotificationEmail=False).execute()
        _log_activity(user_id, "share_file", {"file_id": file_id, "email": email, "role": role})
        return "ok"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def export_file(user_token: str, file_id: str, mime_type: str) -> str:
    """Export Google Doc/Sheet to PDF/DOCX etc. mime_type: e.g. application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document."""
    user_id = ""
    try:
        import base64
        service = _drive_service(user_token)
        request = service.files().export_media(fileId=file_id, mimeType=mime_type)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        content = buf.getvalue()
        _log_activity(user_id, "export_file", {"file_id": file_id, "mime_type": mime_type})
        return base64.b64encode(content).decode("utf-8")
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"
