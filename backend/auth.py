"""Identity — rented from Supabase, verified locally.

Auth is *optional*: with no Supabase env the whole app runs as a single `local` user, so the
zero-key dev/mock loop and `vite.mock.config.js` keep working exactly as before. This mirrors
how the rest of the codebase treats keys/B2/mock mode — configured means live, unconfigured
means degrade, never break.

Verification tries the classic HS256 path first (the project's JWT secret, if you set one),
and falls back to asking Supabase's own `/auth/v1/user` endpoint — which is signing-algorithm
agnostic, so it works whether the project uses the legacy shared secret or the newer
asymmetric signing keys, with nothing to configure but the URL.
"""
from __future__ import annotations

import contextvars
import os
from dataclasses import dataclass
from typing import Optional

import urllib.request
import urllib.error
import json

try:
    from pathlib import Path as _Path

    from dotenv import load_dotenv
    # Load backend/.env by its own path — same as config.py. This module is imported before
    # config in app.py, so we can't rely on config having loaded the file first; read it here
    # so AUTH_ENABLED reflects the .env no matter the import order.
    load_dotenv(_Path(__file__).with_name(".env"))
except Exception:  # dotenv optional
    pass

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

# Auth turns on the moment there's any way to verify a token — a shared secret, or a URL to
# check tokens against. Off otherwise, and the app is single-user `local`.
AUTH_ENABLED = bool(SUPABASE_JWT_SECRET or SUPABASE_URL)


@dataclass(frozen=True)
class User:
    id: str
    email: Optional[str] = None


LOCAL_USER = User(id="local")

# The caller on a public route who presented no (or an invalid) token, when auth is on.
# Its id matches no owner, so it can read public films and nothing else.
ANON_USER = User(id="anon")

# Set by the auth middleware per request; read by _require()/create_project without having to
# thread a parameter through every route.
_current: contextvars.ContextVar[User] = contextvars.ContextVar("current_user", default=LOCAL_USER)


def set_current_user(user: User) -> None:
    _current.set(user)


def current_user() -> User:
    return _current.get()


def _verify_hs256(token: str) -> Optional[User]:
    """Decode with the project JWT secret (legacy HS256). Returns None if unusable."""
    if not SUPABASE_JWT_SECRET:
        return None
    try:
        import jwt
        claims = jwt.decode(
            token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated",
        )
    except Exception:
        return None
    sub = claims.get("sub")
    return User(id=sub, email=claims.get("email")) if sub else None


def _verify_remote(token: str) -> Optional[User]:
    """Ask GoTrue who this token belongs to. Algorithm-agnostic — the authority is Supabase
    itself — so it covers projects using asymmetric signing keys with no key material here."""
    if not SUPABASE_URL:
        return None
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"Authorization": f"Bearer {token}", "apikey": os.getenv("SUPABASE_ANON_KEY", "")},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
    except Exception:
        return None
    uid = data.get("id")
    return User(id=uid, email=data.get("email")) if uid else None


def verify_token(token: str) -> Optional[User]:
    """Resolve a bearer token to a user, or None if it doesn't check out."""
    return _verify_hs256(token) or _verify_remote(token)
