"""MCP Calendar server: list, create, update, delete events; find free slots; get next event. Logs to google_activity."""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.db.repository import log_google_activity


def _calendar_service(user_token: str):
    creds = Credentials(token=user_token)
    return build("calendar", "v3", credentials=creds)


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({"user_id": user_id, "service": "calendar", "action": action, "details": details})


def list_events(user_token: str, time_min: Optional[str] = None, time_max: Optional[str] = None, max_results: int = 20) -> str:
    """List calendar events. time_min/time_max: RFC3339; max_results: max events to return."""
    user_id = ""
    try:
        service = _calendar_service(user_token)
        kwargs = {"calendarId": "primary", "maxResults": max_results, "singleEvents": True, "orderBy": "startTime"}
        if time_min:
            kwargs["timeMin"] = time_min
        if time_max:
            kwargs["timeMax"] = time_max
        result = service.events().list(**kwargs).execute()
        events = result.get("items", [])
        _log_activity(user_id, "list_events", {"count": len(events)})
        return str([{"id": e.get("id"), "summary": e.get("summary"), "start": e.get("start"), "end": e.get("end")} for e in events])
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def create_event(user_token: str, summary: str, start: str, end: str, description: str = "", attendees: Optional[str] = None) -> str:
    """Create a calendar event. start/end: RFC3339 or date string. attendees: comma-separated emails."""
    user_id = ""
    try:
        service = _calendar_service(user_token)
        body = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": start, "timeZone": "UTC"} if "T" in start else {"date": start},
            "end": {"dateTime": end, "timeZone": "UTC"} if "T" in end else {"date": end},
        }
        if attendees:
            body["attendees"] = [{"email": e.strip()} for e in attendees.split(",")]
        result = service.events().insert(calendarId="primary", body=body).execute()
        _log_activity(user_id, "create_event", {"summary": summary, "event_id": result.get("id")})
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def update_event(user_token: str, event_id: str, updates: str) -> str:
    """Update a calendar event. updates: JSON string of fields to update (e.g. summary, start, end)."""
    user_id = ""
    try:
        import json
        service = _calendar_service(user_token)
        event = service.events().get(calendarId="primary", eventId=event_id).execute()
        patch = json.loads(updates) if isinstance(updates, str) else updates
        for key, value in patch.items():
            if key in event:
                event[key] = value
        result = service.events().update(calendarId="primary", eventId=event_id, body=event).execute()
        _log_activity(user_id, "update_event", {"event_id": event_id})
        return str(result.get("id", "ok"))
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def delete_event(user_token: str, event_id: str) -> str:
    """Delete a calendar event."""
    user_id = ""
    try:
        service = _calendar_service(user_token)
        service.events().delete(calendarId="primary", eventId=event_id).execute()
        _log_activity(user_id, "delete_event", {"event_id": event_id})
        return "ok"
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def find_free_slots(user_token: str, date: str, duration_minutes: int = 60) -> str:
    """Find free slots on a date. date: YYYY-MM-DD; duration_minutes: slot length."""
    user_id = ""
    try:
        service = _calendar_service(user_token)
        time_min = f"{date}T00:00:00Z"
        time_max = f"{date}T23:59:59Z"
        result = service.events().list(calendarId="primary", timeMin=time_min, timeMax=time_max, singleEvents=True, orderBy="startTime").execute()
        events = result.get("items", [])
        busy = []
        for e in events:
            start_s = e.get("start", {}).get("dateTime") or e.get("start", {}).get("date")
            end_s = e.get("end", {}).get("dateTime") or e.get("end", {}).get("date")
            if start_s and end_s:
                try:
                    busy.append((datetime.fromisoformat(start_s.replace("Z", "+00:00")), datetime.fromisoformat(end_s.replace("Z", "+00:00"))))
                except Exception:
                    pass
        day_start = datetime.fromisoformat(f"{date}T09:00:00+00:00")
        day_end_dt = datetime.fromisoformat(f"{date}T17:00:00+00:00")
        free = []
        slot_start = day_start
        while slot_start + timedelta(minutes=duration_minutes) <= day_end_dt:
            slot_end = slot_start + timedelta(minutes=duration_minutes)
            overlap = any(slot_start < b[1] and slot_end > b[0] for b in busy)
            if not overlap:
                free.append({"start": slot_start.isoformat(), "end": slot_end.isoformat()})
            slot_start = slot_start + timedelta(minutes=30)
        _log_activity(user_id, "find_free_slots", {"date": date, "count": len(free)})
        return str(free[:10])
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"


def get_next_event(user_token: str) -> str:
    """Get the next upcoming calendar event."""
    user_id = ""
    try:
        service = _calendar_service(user_token)
        now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        result = service.events().list(calendarId="primary", timeMin=now, maxResults=1, singleEvents=True, orderBy="startTime").execute()
        events = result.get("items", [])
        if not events:
            return "No upcoming events"
        e = events[0]
        _log_activity(user_id, "get_next_event", {"event_id": e.get("id")})
        return str({"id": e.get("id"), "summary": e.get("summary"), "start": e.get("start"), "end": e.get("end")})
    except HttpError as e:
        return f"Error: {e.resp.status} - {e.content.decode()}"
    except Exception as e:
        return f"Error: {e}"
