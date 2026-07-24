"""Project + library store — durable in three tiers.

1. **memory** — the hot copy the SSE generators mutate in place.
2. **local disk** — always on, so a restart (or `--reload` mid-demo) never loses a film.
3. **B2** — the canonical record when credentials exist. Projects, their Genblaze manifests
   and their exports all land in the same bucket, and the library reads back from it.

Writes are best-effort and layered: a B2 outage degrades to local disk rather than losing
the project. Local writes are atomic (tmp + replace) so a crash mid-write can't leave a
truncated JSON that would poison the library on next boot.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from threading import Lock

from .. import models
from ..config import get_config

cfg = get_config()

_projects: dict[str, models.Project] = {}
_lock = Lock()

_ROOT = Path(cfg.DATA_DIR)
_PROJ_DIR = _ROOT / "projects"
_PROJ_PREFIX = "projects/"


def _ensure_dirs() -> None:
    _PROJ_DIR.mkdir(parents=True, exist_ok=True)


# ---------------- B2 (S3-compatible) ----------------

_s3 = None
_s3_tried = False


def b2():
    """Lazy boto3 client for Backblaze B2. Returns None when unconfigured/unavailable."""
    global _s3, _s3_tried
    if _s3 is not None or _s3_tried:
        return _s3
    _s3_tried = True
    if not cfg.has_b2():
        return None
    try:
        import boto3
        from botocore.config import Config as BotoConfig
        _s3 = boto3.client(
            "s3",
            endpoint_url=cfg.b2_endpoint(),
            aws_access_key_id=cfg.B2_KEY_ID,
            aws_secret_access_key=cfg.B2_APP_KEY,
            region_name=cfg.B2_REGION,
            config=BotoConfig(retries={"max_attempts": 3, "mode": "standard"},
                              s3={"addressing_style": "path"}),
        )
    except Exception:
        _s3 = None
    return _s3


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str | None:
    """Upload to B2, returning a durable URL (None when B2 isn't configured)."""
    c = b2()
    if not c:
        return None
    try:
        c.put_object(Bucket=cfg.B2_BUCKET, Key=key, Body=data, ContentType=content_type)
        return f"{cfg.b2_endpoint()}/{cfg.B2_BUCKET}/{key}"
    except Exception:
        return None


def _b2_get_json(key: str) -> dict | None:
    c = b2()
    if not c:
        return None
    try:
        return json.loads(c.get_object(Bucket=cfg.B2_BUCKET, Key=key)["Body"].read())
    except Exception:
        return None


# ---------------- project persistence ----------------

def _local_path(project_id: str) -> Path:
    return _PROJ_DIR / f"{project_id}.json"


def _write_local(project: models.Project) -> None:
    """Atomic local write — a crash mid-write must not leave half a JSON document."""
    _ensure_dirs()
    p = _local_path(project.project_id)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(project.model_dump_json())
    os.replace(tmp, p)


def save(project: models.Project, *, remote: bool = True) -> None:
    """Persist a project. `remote=False` skips B2 for hot per-node checkpoints during a
    stream, where we want disk durability without an upload on every single node."""
    with _lock:
        _projects[project.project_id] = project
        try:
            _write_local(project)
        except Exception:
            pass
    if remote:
        put_bytes(f"{_PROJ_PREFIX}{project.project_id}.json",
                  project.model_dump_json().encode(), "application/json")


def save_async(project: models.Project) -> None:
    """Checkpoint to disk now, push to B2 off the request thread.

    Called after every node during generation: an SSE client that disconnects halfway
    must not cost the user the half-film that was already generated and paid for.
    """
    save(project, remote=False)
    if cfg.has_b2():
        threading.Thread(
            target=put_bytes,
            args=(f"{_PROJ_PREFIX}{project.project_id}.json",
                  project.model_dump_json().encode(), "application/json"),
            daemon=True,
        ).start()


def _load(project_id: str) -> models.Project | None:
    """Disk first (fast), then B2 (authoritative across machines)."""
    p = _local_path(project_id)
    if p.exists():
        try:
            return models.Project.model_validate_json(p.read_text())
        except Exception:
            pass
    data = _b2_get_json(f"{_PROJ_PREFIX}{project_id}.json")
    if data:
        try:
            return models.Project.model_validate(data)
        except Exception:
            return None
    return None


def get(project_id: str) -> models.Project | None:
    hot = _projects.get(project_id)
    if hot:
        return hot
    loaded = _load(project_id)
    if loaded:
        with _lock:
            _projects[project_id] = loaded
    return loaded


def _all_projects() -> list[models.Project]:
    """Every project we can see: memory ∪ disk (memory wins — it's the live copy)."""
    out: dict[str, models.Project] = {}
    if _PROJ_DIR.exists():
        for f in sorted(_PROJ_DIR.glob("*.json")):
            try:
                p = models.Project.model_validate_json(f.read_text())
                out[p.project_id] = p
            except Exception:
                continue  # skip a corrupt file rather than break the whole library
    out.update(_projects)
    return list(out.values())


def list_projects() -> list[dict]:
    """Library view — one card per project with a cover thumbnail."""
    out = []
    for p in _all_projects():
        cover = next((n.asset.thumbnail for n in p.nodes
                      if n.asset and n.asset.thumbnail), None)
        out.append({
            "project_id": p.project_id,
            "title": p.title,
            "idea": p.idea,
            "cover": cover,
            "node_count": len(p.nodes),
            "export_url": p.export_url,
        })
    return out


def all_assets() -> list[dict]:
    """Flat asset library with provenance — powers the provenance drawer / search."""
    out = []
    for p in _all_projects():
        for n in p.nodes:
            if n.asset:
                out.append({
                    "project_id": p.project_id,
                    "node_id": n.node_id,
                    "kind": n.kind,
                    "title": n.title,
                    "url": n.asset.url,
                    "thumbnail": n.asset.thumbnail,
                    "provenance": n.asset.provenance.model_dump(),
                })
    return out
