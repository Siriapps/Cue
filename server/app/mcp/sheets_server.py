"""MCP Sheets server: read, write, create, append, create_action_items_sheet. Logs to google_activity."""
import json
from typing import Any, Dict, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.db.repository import log_google_activity


def _sheets_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("sheets", "v4", credentials=creds)


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({"user_id": user_id, "service": "sheets", "action": action, "details": details})


def read_sheet(user_token: str, sheet_id: str, range_name: str = "Sheet1!A1:Z100") -> str:
    """Get cell data from a sheet. range_name: A1 notation, e.g. Sheet1!A1:D10."""
    user_id = ""
    try:
        service = _sheets_service(user_token)
        result = service.spreadsheets().values().get(spreadsheetId=sheet_id, range=range_name).execute()
        values = result.get("values", [])
        _log_activity(user_id, "read_sheet", {"sheet_id": sheet_id, "range": range_name})
        return str(values)
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def write_to_sheet(user_token: str, sheet_id: str, range_name: str, values: str) -> str:
    """Update cells. range_name: A1 notation; values: JSON string of 2D array (e.g. [[a,b],[c,d]])."""
    user_id = ""
    try:
        import json
        service = _sheets_service(user_token)
        data = json.loads(values) if isinstance(values, str) else values
        body = {"values": data}
        service.spreadsheets().values().update(spreadsheetId=sheet_id, range=range_name, valueInputOption="USER_ENTERED", body=body).execute()
        _log_activity(user_id, "write_to_sheet", {"sheet_id": sheet_id, "range": range_name})
        return "ok"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_sheet(user_token: str, title: str) -> str:
    """Create a new spreadsheet. Returns spreadsheet id and webViewLink."""
    user_id = ""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build as build_drive
        creds = Credentials(token=user_token)
        drive_svc = build_drive("drive", "v3", credentials=creds)
        file_metadata = {"name": title, "mimeType": "application/vnd.google-apps.spreadsheet"}
        file = drive_svc.files().create(body=file_metadata, fields="id, webViewLink").execute()
        sheet_id = file.get("id")
        link = file.get("webViewLink", f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit")
        _log_activity(user_id, "create_sheet", {"title": title, "sheet_id": sheet_id})
        return str({"id": sheet_id, "webViewLink": link})
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def append_row(user_token: str, sheet_id: str, values: str) -> str:
    """Append a row. values: JSON string array (e.g. [a, b, c])."""
    user_id = ""
    try:
        service = _sheets_service(user_token)
        data = json.loads(values) if isinstance(values, str) else values
        body = {"values": [data]}
        service.spreadsheets().values().append(spreadsheetId=sheet_id, range="Sheet1!A:Z", valueInputOption="USER_ENTERED", insertDataOption="INSERT_ROWS", body=body).execute()
        _log_activity(user_id, "append_row", {"sheet_id": sheet_id})
        return "ok"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_action_items_sheet(user_token: str, session_summary: str) -> str:
    """Create a spreadsheet with action items parsed from session summary. Returns sheet id and webViewLink."""
    user_id = ""
    try:
        result = create_sheet(user_token, "Action Items")
        out = json.loads(result)
        sheet_id = out.get("id")
        if not sheet_id:
            return result
        lines = [line.strip() for line in session_summary.split("\n") if line.strip()]
        rows = [["Action", "Notes"]] + [[line, ""] for line in lines[:50]]
        write_to_sheet(user_token, sheet_id, "Sheet1!A1:B" + str(len(rows)), json.dumps(rows))
        _log_activity(user_id, "create_action_items_sheet", {"sheet_id": sheet_id})
        return result
    except Exception as e:
        return f"Error: {e}"
