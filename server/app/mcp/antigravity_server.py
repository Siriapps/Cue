"""Antigravity IDE connection: open_file, create_project, paste_prompt, run_command.
Research: Antigravity is Google's AI IDE (VS Code fork). Integration via CLI or API if available.
Placeholder implementation: CLI subprocess for open/run; paste_prompt can write to a file or send via socket if API exists."""
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from app.db.repository import log_google_activity


def _log_activity(user_id: str, action: str, details: Dict[str, Any]) -> None:
    log_google_activity({"user_id": user_id, "service": "antigravity", "action": action, "details": details})


def open_file(path: str) -> str:
    """Open a file in Antigravity IDE. path: absolute or relative path. Uses CLI if available."""
    user_id = ""
    try:
        path_resolved = Path(path).resolve()
        if not path_resolved.exists():
            return f"Error: path does not exist: {path}"
        if sys.platform == "darwin":
            subprocess.run(["open", "-a", "Antigravity", str(path_resolved)], check=False, capture_output=True)
        elif sys.platform == "win32":
            os.startfile(str(path_resolved))
        else:
            subprocess.run(["xdg-open", str(path_resolved)], check=False, capture_output=True)
        _log_activity(user_id, "open_file", {"path": str(path_resolved)})
        return "ok"
    except Exception as e:
        return f"Error: {e}"


def create_project(name: str, files: str) -> str:
    """Create a project directory with initial files. files: JSON object of filename -> content."""
    user_id = ""
    try:
        import json
        base = Path(os.getenv("MCP_ROOT", os.getcwd()))
        project_path = base / name
        project_path.mkdir(parents=True, exist_ok=True)
        file_map = json.loads(files) if isinstance(files, str) else files
        for fname, content in (file_map or {}).items():
            out = project_path / fname
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(content, encoding="utf-8")
        _log_activity(user_id, "create_project", {"name": name, "files_count": len(file_map or {})})
        return str(project_path)
    except Exception as e:
        return f"Error: {e}"


def paste_prompt(content: str) -> str:
    """Paste content as prompt into Antigravity. Writes to temp file for now; IDE can watch or CLI can be extended."""
    user_id = ""
    try:
        import tempfile
        base = Path(os.getenv("MCP_ROOT", tempfile.gettempdir()))
        prompt_file = base / ".antigravity_prompt.txt"
        prompt_file.write_text(content, encoding="utf-8")
        _log_activity(user_id, "paste_prompt", {"length": len(content)})
        return "ok"
    except Exception as e:
        return f"Error: {e}"


def run_command(cmd: str) -> str:
    """Run a command (e.g. terminal command). Executes in MCP_ROOT or cwd."""
    user_id = ""
    try:
        base = os.getenv("MCP_ROOT", os.getcwd())
        result = subprocess.run(cmd, shell=True, cwd=base, capture_output=True, text=True, timeout=60)
        out = (result.stdout or "") + (result.stderr or "")
        _log_activity(user_id, "run_command", {"cmd": cmd[:200], "returncode": result.returncode})
        return out or f"Exit code: {result.returncode}"
    except subprocess.TimeoutExpired:
        return "Error: command timed out"
    except Exception as e:
        return f"Error: {e}"
