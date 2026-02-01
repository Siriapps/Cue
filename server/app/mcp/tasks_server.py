"""MCP Tasks server: list, create, update, complete, list_overdue, create_tasks_from_action_items. Logs to google_activity."""
import json
from typing import Any, Dict, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.db.repository import log_google_activity


def _tasks_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("tasks", "v1", credentials=creds)


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({"user_id": user_id, "service": "tasks", "action": action, "details": details})


def list_tasks(user_token: str, task_list: str = "@default") -> str:
    """List tasks. task_list: list id or @default for default list."""
    user_id = ""
    try:
        service = _tasks_service(user_token)
        if task_list == "@default":
            lists_result = service.tasklists().list(maxResults=1).execute()
            task_lists = lists_result.get("items", [])
            task_list = task_lists[0]["id"] if task_lists else ""
        if not task_list:
            return "[]"
        result = service.tasks().list(tasklist=task_list, showCompleted=True).execute()
        items = result.get("items", [])
        _log_activity(user_id, "list_tasks", {"task_list": task_list, "count": len(items)})
        return str([{"id": t.get("id"), "title": t.get("title"), "status": t.get("status")} for t in items])
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_task(user_token: str, title: str, notes: str = "", due: str = "", task_list: str = "@default") -> str:
    """Create a task. due: RFC3339; task_list: list id or @default."""
    user_id = ""
    try:
        service = _tasks_service(user_token)
        if task_list == "@default":
            lists_result = service.tasklists().list(maxResults=1).execute()
            task_lists = lists_result.get("items", [])
            task_list = task_lists[0]["id"] if task_lists else ""
        if not task_list:
            return "Error: No task list"
        body = {"title": title}
        if notes:
            body["notes"] = notes
        if due:
            body["due"] = due
        result = service.tasks().insert(tasklist=task_list, body=body).execute()
        _log_activity(user_id, "create_task", {"title": title, "task_id": result.get("id")})
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def update_task(user_token: str, task_id: str, updates: str, task_list: str = "@default") -> str:
    """Update a task. updates: JSON string of fields (title, notes, due, status)."""
    user_id = ""
    try:
        service = _tasks_service(user_token)
        if task_list == "@default":
            lists_result = service.tasklists().list(maxResults=1).execute()
            task_lists = lists_result.get("items", [])
            task_list = task_lists[0]["id"] if task_lists else ""
        if not task_list:
            return "Error: No task list"
        patch = json.loads(updates) if isinstance(updates, str) else updates
        result = service.tasks().patch(tasklist=task_list, task=task_id, body=patch).execute()
        _log_activity(user_id, "update_task", {"task_id": task_id})
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def complete_task(user_token: str, task_id: str, task_list: str = "@default") -> str:
    """Mark a task complete."""
    user_id = ""
    try:
        service = _tasks_service(user_token)
        if task_list == "@default":
            lists_result = service.tasklists().list(maxResults=1).execute()
            task_lists = lists_result.get("items", [])
            task_list = task_lists[0]["id"] if task_lists else ""
        if not task_list:
            return "Error: No task list"
        service.tasks().patch(tasklist=task_list, task=task_id, body={"status": "completed"}).execute()
        _log_activity(user_id, "complete_task", {"task_id": task_id})
        return "ok"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def list_overdue_tasks(user_token: str) -> str:
    """List overdue tasks from default list."""
    user_id = ""
    try:
        from datetime import datetime
        service = _tasks_service(user_token)
        lists_result = service.tasklists().list(maxResults=1).execute()
        task_lists = lists_result.get("items", [])
        if not task_lists:
            return "[]"
        task_list = task_lists[0]["id"]
        result = service.tasks().list(tasklist=task_list, showCompleted=False).execute()
        items = result.get("items", [])
        now = datetime.utcnow().isoformat() + "Z"
        overdue = [t for t in items if t.get("due") and t.get("due", "") < now]
        _log_activity(user_id, "list_overdue_tasks", {"count": len(overdue)})
        return str([{"id": t.get("id"), "title": t.get("title"), "due": t.get("due")} for t in overdue])
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_tasks_from_action_items(user_token: str, action_items: str) -> str:
    """Create tasks from action items. action_items: JSON array of strings or [{title, notes?}]."""
    user_id = ""
    try:
        items = json.loads(action_items) if isinstance(action_items, str) else action_items
        ids = []
        for item in items[:50]:
            if isinstance(item, dict):
                title = item.get("title", item.get("task", str(item)))
                notes = item.get("notes", "")
            else:
                title = str(item)
                notes = ""
            tid = create_task(user_token, title, notes=notes)
            if not tid.startswith("Error"):
                ids.append(tid)
        _log_activity(user_id, "create_tasks_from_action_items", {"count": len(ids)})
        return str(ids)
    except Exception as e:
        return f"Error: {e}"
