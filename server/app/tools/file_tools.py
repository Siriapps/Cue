from app.mcp.client import MCPClient


_client = MCPClient()


def read_local_file(path: str) -> str:
    return _client.call_tool("read_local_file", {"path": path})


def list_directory(path: str = ".") -> list[str]:
    return _client.call_tool("list_directory", {"path": path})


def write_local_file(path: str, content: str) -> str:
    return _client.call_tool("write_local_file", {"path": path, "content": content})
