import asyncio
import json
import os
from typing import Any

from mcp.client import ClientSession
from mcp.client.sse import sse_client


class MCPClient:
    def __init__(self, sse_url: str | None = None) -> None:
        self.sse_url = sse_url or os.getenv("MCP_SSE_URL", "http://127.0.0.1:3333/sse")

    async def _call_tool_async(self, name: str, arguments: dict[str, Any]) -> Any:
        async with sse_client(self.sse_url) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(name, arguments)
        return self._unwrap(result)

    def _unwrap(self, result: Any) -> Any:
        content = getattr(result, "content", None)
        if isinstance(content, list) and content:
            item = content[0]
            text = getattr(item, "text", None)
            if text is None and isinstance(item, dict):
                text = item.get("text")
            if text is not None:
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return text
        return result

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            return asyncio.run_coroutine_threadsafe(
                self._call_tool_async(name, arguments), loop
            ).result()
        return asyncio.run(self._call_tool_async(name, arguments))
