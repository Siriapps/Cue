"""Supabase client for auth and future features."""
import os
from typing import Optional

try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = None


def get_supabase_client() -> Optional["Client"]:
    """Return Supabase client if SUPABASE_URL and SUPABASE_ANON_KEY are set."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key or create_client is None:
        return None
    return create_client(url, key)
