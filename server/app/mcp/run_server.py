from app.mcp.server import mcp


def main() -> None:
    mcp.run(transport="sse")


if __name__ == "__main__":
    main()
