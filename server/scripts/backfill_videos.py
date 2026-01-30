"""
Temporary script to generate videos for existing sessions.
Run once to backfill video summaries, then delete this file.

Usage:
    cd server
    python -m scripts.backfill_videos

Requirements:
    - GEMINI_API_KEY environment variable must be set
    - MongoDB must be running with existing sessions
"""
import asyncio
import os
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.db.repository import list_sessions, update_session
from app.agents.gemini_client import generate_video_from_summary


async def backfill_videos(dry_run: bool = False):
    """
    Generate videos for all sessions that don't have one.

    Args:
        dry_run: If True, only show what would be done without making changes
    """
    print("=" * 60)
    print("Veo Video Backfill Script")
    print("=" * 60)

    # Get all sessions
    print("\nFetching sessions from MongoDB...")
    sessions = list_sessions(limit=1000)
    print(f"Total sessions found: {len(sessions)}")

    # Filter sessions without videos
    sessions_without_video = [
        s for s in sessions
        if not s.get('video_url') and s.get('summary')
    ]

    print(f"Sessions without videos: {len(sessions_without_video)}")

    if not sessions_without_video:
        print("\nNo sessions need video generation. Exiting.")
        return

    if dry_run:
        print("\n[DRY RUN] Would process the following sessions:")
        for i, session in enumerate(sessions_without_video, 1):
            print(f"  {i}. {session.get('title', 'Untitled')} (ID: {session.get('_id')})")
        print("\nRun without --dry-run to actually generate videos.")
        return

    print(f"\nStarting video generation for {len(sessions_without_video)} sessions...")
    print("-" * 60)

    success_count = 0
    error_count = 0

    for i, session in enumerate(sessions_without_video, 1):
        title = session.get('title', 'Untitled')
        session_id = str(session.get('_id'))

        print(f"\n[{i}/{len(sessions_without_video)}] Processing: {title}")
        print(f"    Session ID: {session_id}")

        try:
            summary = session.get('summary', {})
            if not summary:
                print("    SKIP: No summary available")
                continue

            print("    Generating video...")
            video_url = await generate_video_from_summary(summary)

            if video_url:
                # Update session in MongoDB
                update_result = update_session(session_id, {
                    'video_url': video_url,
                    'has_video': True,
                    'video_generated_at': datetime.utcnow(),
                })

                if update_result:
                    print(f"    SUCCESS: {video_url}")
                    success_count += 1
                else:
                    print(f"    ERROR: Failed to update MongoDB")
                    error_count += 1
            else:
                print("    FAILED: No video URL returned from Veo API")
                error_count += 1

        except Exception as e:
            print(f"    ERROR: {str(e)}")
            error_count += 1

        # Rate limiting - wait between requests to avoid API throttling
        if i < len(sessions_without_video):
            print("    Waiting 3 seconds before next request...")
            await asyncio.sleep(3)

    print("\n" + "=" * 60)
    print("Backfill Complete!")
    print(f"  Successful: {success_count}")
    print(f"  Failed: {error_count}")
    print(f"  Total processed: {success_count + error_count}")
    print("=" * 60)

    if success_count > 0:
        print("\nYou can now delete this script file:")
        print(f"  del {__file__}")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate Veo videos for existing sessions"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )

    args = parser.parse_args()

    # Check for API key
    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY environment variable is not set")
        print("Please set it in your .env file or environment")
        sys.exit(1)

    # Run the backfill
    asyncio.run(backfill_videos(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
