"""Per-account provider keys — a place for a user to bring their own Genblaze (GMICloud) key.

Why this exists: the hosted demo runs on a shared GMICloud key with a capped credit pool, so a
judge trying the app out can hit a "credit limit" wall mid-film. Rather than dead-ending, they
can paste their own key here and keep generating for real on their own credits (see
`genblaze_client._active_key`). With no user key, everything behaves exactly as before — the
host key (or mock mode) drives generation.

Storage mirrors `storage.py`'s tiering: local disk always, B2 when configured, an in-memory
cache in front. The key is a live secret, so it is **encrypted at rest** — never written or
uploaded in the clear. Encryption is an authenticated HMAC-CTR construction on the standard
library (no new dependency): a random per-record nonce keys an HMAC-SHA256 keystream XORed over
the plaintext, then the whole thing is sealed with an encrypt-then-MAC tag so a tampered or
truncated record decrypts to nothing rather than garbage. The vault secret comes from
`KEYVAULT_SECRET` when set, else a random file persisted under `DATA_DIR` on first use.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from pathlib import Path
from threading import Lock

from ..config import get_config
from . import storage

cfg = get_config()

_KEY_DIR = Path(cfg.DATA_DIR) / "keys"
_KEY_PREFIX = "keys/"  # B2

# user_id -> plaintext key (or None = looked up and absent). Fronts disk/B2 so the hot render
# loop doesn't decrypt on every node. Written under _lock; reads are dict-atomic.
_cache: dict[str, str | None] = {}
_lock = Lock()


# ---------------- vault secret ----------------

_secret: bytes | None = None


def _vault_secret() -> bytes:
    """The master secret for at-rest encryption. Env wins; else a persisted random file.

    A persisted random file means encryption works out of the box on a single host with no
    configuration — the same "configured means better, unconfigured still works" posture the
    rest of the app takes. Set KEYVAULT_SECRET in a multi-host deployment so every instance
    can read every record.
    """
    global _secret
    if _secret is not None:
        return _secret
    env = os.getenv("KEYVAULT_SECRET")
    if env:
        _secret = hashlib.sha256(env.encode()).digest()
        return _secret
    path = Path(cfg.DATA_DIR) / ".keyvault_secret"
    try:
        if path.exists():
            _secret = bytes.fromhex(path.read_text().strip())
            return _secret
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = secrets.token_bytes(32)
        path.write_text(raw.hex())
        os.chmod(path, 0o600)
        _secret = raw
    except Exception:
        # Last resort: a process-lifetime secret. Records won't survive a restart, but the
        # feature degrades to "re-enter your key" rather than crashing.
        _secret = secrets.token_bytes(32)
    return _secret


def _subkey(label: bytes) -> bytes:
    return hashlib.sha256(label + _vault_secret()).digest()


def _keystream(nonce: bytes, n: int) -> bytes:
    enc = _subkey(b"enc")
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hmac.new(enc, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:n])


def _seal(plaintext: str) -> str:
    nonce = secrets.token_bytes(16)
    pt = plaintext.encode()
    ct = bytes(a ^ b for a, b in zip(pt, _keystream(nonce, len(pt))))
    tag = hmac.new(_subkey(b"mac"), nonce + ct, hashlib.sha256).digest()
    return base64.b64encode(nonce + ct + tag).decode()


def _open(blob: str) -> str | None:
    try:
        raw = base64.b64decode(blob)
        nonce, ct, tag = raw[:16], raw[16:-32], raw[-32:]
        expected = hmac.new(_subkey(b"mac"), nonce + ct, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            return None
        return bytes(a ^ b for a, b in zip(ct, _keystream(nonce, len(ct)))).decode()
    except Exception:
        return None


# ---------------- record persistence ----------------

def _safe_id(user_id: str) -> str:
    """A filesystem/B2-safe stem for a user id. Supabase ids are UUIDs and `local`/`anon` are
    plain, but hash anything with an unexpected character rather than trust it in a path."""
    return user_id if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", user_id) else \
        hashlib.sha256(user_id.encode()).hexdigest()


def _record_path(user_id: str) -> Path:
    return _KEY_DIR / f"{_safe_id(user_id)}.json"


def _write_record(user_id: str, sealed: str | None) -> None:
    """Persist (or clear) a sealed record locally, and to B2 when configured."""
    _KEY_DIR.mkdir(parents=True, exist_ok=True)
    path = _record_path(user_id)
    if sealed is None:
        path.unlink(missing_ok=True)
    else:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"key": sealed}))
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    if cfg.has_b2():
        b2_key = f"{_KEY_PREFIX}{_safe_id(user_id)}.json"
        if sealed is None:
            _b2_delete(b2_key)
        else:
            storage.put_bytes(b2_key, json.dumps({"key": sealed}).encode(), "application/json")


def _b2_delete(key: str) -> None:
    c = storage.b2()
    if not c:
        return
    try:
        c.delete_object(Bucket=cfg.B2_BUCKET, Key=key)
    except Exception:
        pass


def _read_record(user_id: str) -> str | None:
    """The sealed blob for a user, disk first then B2, or None."""
    path = _record_path(user_id)
    if path.exists():
        try:
            return json.loads(path.read_text()).get("key")
        except Exception:
            pass
    c = storage.b2()
    if c:
        try:
            data = c.get_object(Bucket=cfg.B2_BUCKET,
                                Key=f"{_KEY_PREFIX}{_safe_id(user_id)}.json")["Body"].read()
            return json.loads(data).get("key")
        except Exception:
            return None
    return None


# ---------------- public API ----------------

def get_key(user_id: str) -> str | None:
    """The user's decrypted Genblaze key, or None. Cached after the first lookup."""
    if user_id in _cache:
        return _cache[user_id]
    sealed = _read_record(user_id)
    key = _open(sealed) if sealed else None
    with _lock:
        _cache[user_id] = key
    return key


def has_key(user_id: str) -> bool:
    return bool(get_key(user_id))


def set_key(user_id: str, key: str) -> None:
    """Store a user's key (encrypted). Strips surrounding whitespace pasted with the token."""
    key = key.strip()
    if not key:
        raise ValueError("empty key")
    _write_record(user_id, _seal(key))
    with _lock:
        _cache[user_id] = key


def clear_key(user_id: str) -> None:
    _write_record(user_id, None)
    with _lock:
        _cache[user_id] = None


def masked(user_id: str) -> str | None:
    """A display-safe fingerprint of the stored key (last 4 chars), or None. Never the key."""
    key = get_key(user_id)
    if not key:
        return None
    tail = key[-4:] if len(key) >= 4 else key
    return f"…{tail}"
