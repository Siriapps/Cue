"""
Temporary script to generate Veo 3 videos for existing sessions that don't have videos.

This script:
1. Fetches all sessions from MongoDB that don't have video_url
2. Generates videos using Veo 3 for each session's summary
3. Updates the sessions with the generated video_url
4. Can be deleted after running

Usage:
    cd server
    python scripts/generate_videos_for_existing_sessions.py
"""
import asyncio
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # type: ignore[import-untyped]
load_dotenv()

from app.db.mongo import get_db
from app.agents.gemini_client import generate_video_from_summary
from bson import ObjectId  # type: ignore[import-untyped]


async def generate_videos_for_sessions():
    """Generate Veo 3 videos for all sessions without videos."""
    db = get_db()

    # Find sessions without video_url or has_video=false
    query = {
        "$or": [
            {"video_url": None},
            {"video_url": {"$exists": False}},
            {"has_video": False},
            {"has_video": {"$exists": False}}
        ]
    }

    sessions_without_video = list(db.sessions.find(query))

    if not sessions_without_video:
        print("[Veo Script] No sessions found without videos. Exiting.")
        return

    print(f"[Veo Script] Found {len(sessions_without_video)} sessions without videos")

    # Track progress
    successful = 0
    failed = 0
    rate_limit_errors = 0
    skipped = 0

    for i, session in enumerate(sessions_without_video):
        session_id = str(session.get("_id"))
        title = session.get("title", "Untitled")
        summary = session.get("summary", {})

        # Double-check: Skip if video already exists (shouldn't happen due to query, but safety check)
        if session.get("video_url") or session.get("has_video"):
            print(f"[Veo Script] [{i+1}/{len(sessions_without_video)}] Skipping '{title}' - Video already exists")
            skipped += 1
            continue

        # Skip if no summary data
        if not summary or not summary.get("tldr"):
            print(f"[Veo Script] [{i+1}/{len(sessions_without_video)}] Skipping '{title}' - No summary data")
            skipped += 1
            continue

        print(f"[Veo Script] [{i+1}/{len(sessions_without_video)}] Generating video for: {title}")

        try:
            # Generate video from summary
            video_url = await generate_video_from_summary(summary)

            if video_url:
                # Update session in MongoDB
                db.sessions.update_one(
                    {"_id": ObjectId(session_id)},
                    {
                        "$set": {
                            "video_url": video_url,
                            "has_video": True
                        }
                    }
                )
                print(f"[Veo Script] Video generated and saved: {video_url[:80]}...")
                successful += 1
            else:
                print(f"[Veo Script] No video URL returned for '{title}'")
                failed += 1

        except Exception as e:
            error_str = str(e).lower()
            if "429" in error_str or "rate limit" in error_str or "quota" in error_str:
                rate_limit_errors += 1
                print(f"[Veo Script] Rate limit error for '{title}': {e}")
            else:
                print(f"[Veo Script] Error generating video for '{title}': {e}")
            failed += 1

        # Increased delay between API calls to avoid rate limiting
        if i < len(sessions_without_video) - 1:
            print("[Veo Script] Waiting 10 seconds before next request...")
            await asyncio.sleep(10)

    print(f"\n[Veo Script] Complete!")
    print(f"[Veo Script] Successful: {successful}")
    print(f"[Veo Script] Failed: {failed}")
    print(f"[Veo Script] Skipped: {skipped}")
    print(f"[Veo Script] Rate limit errors: {rate_limit_errors}")
    print(f"[Veo Script] Total processed: {len(sessions_without_video)}")

    return {
        "successful": successful,
        "failed": failed,
        "skipped": skipped,
        "rate_limit_errors": rate_limit_errors,
        "total": len(sessions_without_video)
    }


def main():
    """Main entry point."""
    print("[Veo Script] Starting video generation for existing sessions...")
    print("[Veo Script] This may take several minutes depending on the number of sessions.")
    print()

    # Check for API key
    if not os.getenv("GEMINI_API_KEY"):
        print("[Veo Script] ERROR: GEMINI_API_KEY not set in environment")
        print("[Veo Script] Please set GEMINI_API_KEY in your .env file")
        sys.exit(1)

    # Run the async function
    result = asyncio.run(generate_videos_for_sessions())

    if result:
        print()
        print("[Veo Script] You can now delete this script file:")
        print(f"[Veo Script]   del {__file__}")


if __name__ == "__main__":
    main()
