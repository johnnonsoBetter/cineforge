"""Final cut — stitch the shots into one deliverable file.

Until this existed the "film" only played as a sequence of clips inside the browser
session: nothing to download, nothing to submit, nothing to put in front of a judge. This
concatenates the shots in scene order (mixing each shot's voiceover over its own segment
when one was generated), writes an MP4, and pushes it to B2 alongside the assets it came
from.

Shots come from different providers at different resolutions, so we re-encode to a common
format rather than using ffmpeg's stream-copy concat, which silently produces a broken
file when the inputs don't match exactly.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from ..config import get_config
from ..models import NodeKind, NodeStatus, Project
from . import storage

cfg = get_config()

OUT_DIR = Path(cfg.DATA_DIR) / "exports"
_W, _H, _FPS = 1280, 720, 24


class ExportError(RuntimeError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _fetch(url: str, dest: Path) -> bool:
    """Pull a shot local. Remote URLs and already-local files both land as real files."""
    try:
        # App-relative media (locally rendered mock clips) is already on disk — read it
        # straight from the filesystem instead of round-tripping through our own server.
        if url.startswith("/api/media/"):
            src = Path(cfg.DATA_DIR) / "mock" / url.rsplit("/", 1)[-1]
            if not src.exists():
                return False
            shutil.copyfile(src, dest)
            return dest.stat().st_size > 0
        if url.startswith(("http://", "https://")):
            req = urllib.request.Request(url, headers={"User-Agent": "cineforge/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
        elif url.startswith("file://"):
            shutil.copyfile(url[7:], dest)
        else:
            p = Path(url)
            if not p.exists():
                return False
            shutil.copyfile(p, dest)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False


def _run(args: list[str], timeout: int = 900) -> None:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise ExportError(proc.stderr.strip().splitlines()[-1] if proc.stderr else "ffmpeg failed")


def ordered_shots(project: Project) -> list:
    """Shots in story order — the timeline's order, not creation order.

    A shot's scene number is reached through its keyframe parent, so a regenerated shot
    still cuts in the right place. Scene number alone is no longer enough: a scene is
    covered by several setups, and they have to stay in the order they were called for or
    the cut plays the scene's reactions before its actions.
    """
    def order(shot) -> tuple[float, float]:
        for pid in shot.parent_ids:
            kf = project.get(pid)
            if not kf:
                continue
            for spid in kf.parent_ids:
                s = project.get(spid)
                if s and s.kind == NodeKind.SCENE:
                    return (float(s.data.get("n", 1e6)), float(shot.data.get("i", 0)))
        return (1e6, float(shot.data.get("i", 0)))

    shots = [n for n in project.by_kind(NodeKind.SHOT)
             if n.asset and n.asset.url and n.status != NodeStatus.FAILED]
    return sorted(shots, key=order)


def export_film(project: Project) -> str:
    """Render the final cut. Returns a URL (B2 when configured, else a local API path)."""
    if not ffmpeg_available():
        raise ExportError("ffmpeg is not installed — `brew install ffmpeg`")

    shots = ordered_shots(project)
    if not shots:
        raise ExportError("no rendered shots to assemble yet")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{project.project_id}.mp4"

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        segments: list[Path] = []

        for i, shot in enumerate(shots):
            src = tmp / f"src{i}"
            if not _fetch(shot.asset.url, src):
                continue  # a shot we can't fetch shouldn't sink the whole export

            seg = tmp / f"seg{i}.mp4"
            # Normalise geometry/fps/audio so concat can't produce a corrupt stream.
            args = ["ffmpeg", "-y", "-i", str(src)]
            vo = tmp / f"vo{i}"
            has_vo = bool(shot.data.get("vo_url")) and _fetch(shot.data["vo_url"], vo)
            if has_vo:
                args += ["-i", str(vo)]

            vf = (f"scale={_W}:{_H}:force_original_aspect_ratio=decrease,"
                  f"pad={_W}:{_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={_FPS}")
            args += ["-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                     "-pix_fmt", "yuv420p"]
            if has_vo:
                # Voiceover replaces the clip's own audio for that segment.
                args += ["-map", "0:v:0", "-map", "1:a:0", "-shortest"]
            args += ["-c:a", "aac", "-ar", "48000", "-ac", "2", str(seg)]

            try:
                _run(args)
                segments.append(seg)
            except Exception:
                continue

        if not segments:
            raise ExportError("every shot failed to transcode")

        listing = tmp / "concat.txt"
        listing.write_text("".join(f"file '{s}'\n" for s in segments))
        _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
              "-c:a", "aac", str(out_path)])

    url = storage.put_bytes(f"exports/{project.project_id}.mp4",
                            out_path.read_bytes(), "video/mp4")
    project.export_url = url or f"/api/projects/{project.project_id}/export/download"
    storage.save(project)
    return project.export_url
