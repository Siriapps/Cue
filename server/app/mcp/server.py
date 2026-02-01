import json
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP  # type: ignore[import-untyped]

from app.mcp import antigravity_server
from app.mcp import calendar_server
from app.mcp import docs_server
from app.mcp import drive_server
from app.mcp import gmail_server
from app.mcp import sheets_server
from app.mcp import tasks_server


def _default_root() -> Path:
    return Path(os.getenv("MCP_ROOT", Path(__file__).resolve().parents[3])).resolve()


ROOT = _default_root()
MCP_HOST = os.getenv("MCP_HOST", "127.0.0.1")
MCP_PORT = int(os.getenv("MCP_PORT", "3333"))
mcp = FastMCP("cue-mcp", host=MCP_HOST, port=MCP_PORT)


def _safe_path(path: str) -> Path:
    target = (ROOT / path).resolve()
    if not str(target).startswith(str(ROOT)):
        raise ValueError("Path outside MCP root")
    return target


@mcp.tool()
def list_directory(path: str = ".") -> str:
    target = _safe_path(path)
    if not target.exists() or not target.is_dir():
        return json.dumps([])
    return json.dumps([p.name for p in target.iterdir()])


@mcp.tool()
def read_local_file(path: str) -> str:
    target = _safe_path(path)
    return target.read_text(encoding="utf-8")


@mcp.tool()
def write_local_file(path: str, content: str) -> str:
    target = _safe_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return "ok"


# Gmail MCP tools
@mcp.tool()
def list_emails(user_token: str, query: str = "", max_results: int = 10) -> str:
    """List/search emails. query: Gmail search string; max_results: max number to return."""
    return gmail_server.list_emails(user_token, query, max_results)


@mcp.tool()
def read_email(user_token: str, message_id: str) -> str:
    """Get full email content by message id."""
    return gmail_server.read_email(user_token, message_id)


@mcp.tool()
def send_email(user_token: str, to: str, subject: str, body: str) -> str:
    """Send an email. Returns message id or error."""
    return gmail_server.send_email(user_token, to, subject, body)


@mcp.tool()
def draft_reply(user_token: str, email_id: str, message: str) -> str:
    """Create a draft reply to an email. email_id: message id to reply to."""
    return gmail_server.draft_reply(user_token, email_id, message)


@mcp.tool()
def get_recent_threads(user_token: str, count: int = 10) -> str:
    """Get recent conversation threads."""
    return gmail_server.get_recent_threads(user_token, count)


# Calendar MCP tools
@mcp.tool()
def list_events(user_token: str, time_min: str = "", time_max: str = "", max_results: int = 20) -> str:
    """List calendar events. time_min/time_max: RFC3339; max_results: max events to return."""
    return calendar_server.list_events(user_token, time_min or None, time_max or None, max_results)


@mcp.tool()
def create_event(user_token: str, summary: str, start: str, end: str, description: str = "", attendees: str = "") -> str:
    """Create a calendar event. start/end: RFC3339 or date. attendees: comma-separated emails."""
    return calendar_server.create_event(user_token, summary, start, end, description, attendees or None)


@mcp.tool()
def update_event(user_token: str, event_id: str, updates: str) -> str:
    """Update a calendar event. updates: JSON string of fields to update."""
    return calendar_server.update_event(user_token, event_id, updates)


@mcp.tool()
def delete_event(user_token: str, event_id: str) -> str:
    """Delete a calendar event."""
    return calendar_server.delete_event(user_token, event_id)


@mcp.tool()
def find_free_slots(user_token: str, date: str, duration_minutes: int = 60) -> str:
    """Find free slots on a date. date: YYYY-MM-DD; duration_minutes: slot length."""
    return calendar_server.find_free_slots(user_token, date, duration_minutes)


@mcp.tool()
def get_next_event(user_token: str) -> str:
    """Get the next upcoming calendar event."""
    return calendar_server.get_next_event(user_token)


# Drive MCP tools
@mcp.tool()
def list_files(user_token: str, query: str = "", max_results: int = 20) -> str:
    """List/search Drive files. query: Drive search string; max_results: max to return."""
    return drive_server.list_files(user_token, query, max_results)


@mcp.tool()
def read_file_content(user_token: str, file_id: str) -> str:
    """Download file content by file id. Returns base64 or error."""
    return drive_server.read_file_content(user_token, file_id)


@mcp.tool()
def create_file(user_token: str, name: str, content: str, mime_type: str = "text/plain") -> str:
    """Upload a new file. content: file body; mime_type: MIME type."""
    return drive_server.create_file(user_token, name, content, mime_type)


@mcp.tool()
def share_file(user_token: str, file_id: str, email: str, role: str = "reader") -> str:
    """Share file with email. role: reader, writer, commenter."""
    return drive_server.share_file(user_token, file_id, email, role)


@mcp.tool()
def export_file(user_token: str, file_id: str, mime_type: str) -> str:
    """Export Google Doc/Sheet to PDF/DOCX. mime_type: e.g. application/pdf."""
    return drive_server.export_file(user_token, file_id, mime_type)


# Docs MCP tools
@mcp.tool()
def read_document(user_token: str, doc_id: str) -> str:
    """Get document content by doc id."""
    return docs_server.read_document(user_token, doc_id)


@mcp.tool()
def create_document(user_token: str, title: str, content: str = "") -> str:
    """Create a new Google Doc with optional initial content. Returns doc id and webViewLink."""
    return docs_server.create_document(user_token, title, content)


@mcp.tool()
def append_to_doc(user_token: str, doc_id: str, text: str) -> str:
    """Append text at the end of a document."""
    return docs_server.append_to_doc(user_token, doc_id, text)


@mcp.tool()
def create_meeting_notes(user_token: str, doc_id: str, session_summary: str) -> str:
    """Create or append meeting notes from session summary. doc_id empty to create new doc."""
    return docs_server.create_meeting_notes(user_token, doc_id or None, session_summary)


# Sheets MCP tools
@mcp.tool()
def read_sheet(user_token: str, sheet_id: str, range_name: str = "Sheet1!A1:Z100") -> str:
    """Get cell data from a sheet. range_name: A1 notation."""
    return sheets_server.read_sheet(user_token, sheet_id, range_name)


@mcp.tool()
def write_to_sheet(user_token: str, sheet_id: str, range_name: str, values: str) -> str:
    """Update cells. range_name: A1 notation; values: JSON string of 2D array."""
    return sheets_server.write_to_sheet(user_token, sheet_id, range_name, values)


@mcp.tool()
def create_sheet(user_token: str, title: str) -> str:
    """Create a new spreadsheet. Returns spreadsheet id and webViewLink."""
    return sheets_server.create_sheet(user_token, title)


@mcp.tool()
def append_row(user_token: str, sheet_id: str, values: str) -> str:
    """Append a row. values: JSON string array."""
    return sheets_server.append_row(user_token, sheet_id, values)


@mcp.tool()
def create_action_items_sheet(user_token: str, session_summary: str) -> str:
    """Create a spreadsheet with action items from session summary."""
    return sheets_server.create_action_items_sheet(user_token, session_summary)


# Tasks MCP tools
@mcp.tool()
def list_tasks(user_token: str, task_list: str = "@default") -> str:
    """List tasks. task_list: list id or @default."""
    return tasks_server.list_tasks(user_token, task_list)


@mcp.tool()
def create_task(user_token: str, title: str, notes: str = "", due: str = "", task_list: str = "@default") -> str:
    """Create a task. due: RFC3339; task_list: list id or @default."""
    return tasks_server.create_task(user_token, title, notes, due, task_list)


@mcp.tool()
def update_task(user_token: str, task_id: str, updates: str, task_list: str = "@default") -> str:
    """Update a task. updates: JSON string of fields."""
    return tasks_server.update_task(user_token, task_id, updates, task_list)


@mcp.tool()
def complete_task(user_token: str, task_id: str, task_list: str = "@default") -> str:
    """Mark a task complete."""
    return tasks_server.complete_task(user_token, task_id, task_list)


@mcp.tool()
def list_overdue_tasks(user_token: str) -> str:
    """List overdue tasks from default list."""
    return tasks_server.list_overdue_tasks(user_token)


@mcp.tool()
def create_tasks_from_action_items(user_token: str, action_items: str) -> str:
    """Create tasks from action items. action_items: JSON array of strings or objects with title."""
    return tasks_server.create_tasks_from_action_items(user_token, action_items)


# Antigravity IDE tools
@mcp.tool()
def open_file(path: str) -> str:
    """Open a file in Antigravity IDE. path: absolute or relative path."""
    return antigravity_server.open_file(path)


@mcp.tool()
def create_project(name: str, files: str) -> str:
    """Create a project directory with initial files. files: JSON object of filename -> content."""
    return antigravity_server.create_project(name, files)


@mcp.tool()
def paste_prompt(content: str) -> str:
    """Paste content as prompt into Antigravity."""
    return antigravity_server.paste_prompt(content)


@mcp.tool()
def run_command(cmd: str) -> str:
    """Run a command (e.g. terminal command)."""
    return antigravity_server.run_command(cmd)

