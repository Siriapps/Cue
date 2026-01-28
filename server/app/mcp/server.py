import json
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP


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


