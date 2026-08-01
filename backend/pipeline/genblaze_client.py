"""The generation spine. One place that knows how to talk to Genblaze (real) or fake it
(mock). Provider selection (GMICloud for Backblaze, OpenAI for Build Week) lives here, so the
rest of the app never imports a provider directly.

Real calls follow the Genblaze README:
    Pipeline(name, chain=True).step(image_provider, ...).step(video_provider, ...).run(sink=storage)
    result.run.steps[-1].assets[0].url / .sha256 ; result.manifest.canonical_hash / .verify()
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from ..config import get_config
from ..models import Asset, NodeKind, Provenance
from .provenance import summarize_manifest, mock_provenance

cfg = get_config()


# ---- per-account key (bring-your-own Genblaze key) ------------------------
#
# The hosted demo runs on a shared, credit-capped key. When a caller has stored their own
# GMICloud key (see keyvault), it overrides the host key *and* flips media to real for that
# caller — so hitting the shared credit wall becomes "add your key and keep going" rather than
# a dead end. With no user key, every path below behaves exactly as it did: host key or mock.

def _user_key() -> str | None:
    """The current caller's own GMICloud key, or None. Resolved off the request identity, so it
    rides the auth contextvar the fan-out copies into its render threads (director._fanout)."""
    try:
        from .. import auth
        from . import keyvault
        return keyvault.get_key(auth.current_user().id)
    except Exception:
        return None


def _active_key() -> str | None:
    """The GMICloud key to bill this render to: the caller's own if present, else the host's."""
    return _user_key() or cfg.GMI_API_KEY


def _mock_media() -> bool:
    """Media is mocked unless the host turned it on OR the caller brought their own key."""
    return cfg.mock_media() and not _user_key()


def _mock_text() -> bool:
    """Text goes live on any usable key — the host's, or the caller's own."""
    return cfg.mock_text() and not _user_key()


# HTTP statuses and message fragments a provider uses to say "you're out of credits / over
# quota". Kept broad on purpose: the point is to route the caller to the bring-your-own-key
# prompt rather than show a generic failure, and a false positive there is cheap.
_CREDIT_STATUSES = {402, 429}
_CREDIT_PHRASES = ("insufficient", "credit", "quota", "billing", "balance",
                   "payment required", "out of funds", "exceeded your", "rate limit")


def is_credit_error(exc: BaseException) -> bool:
    """Whether an exception reads as a credit/quota wall (vs. a bad slug, timeout, outage)."""
    status = (getattr(exc, "status", None) or getattr(exc, "status_code", None)
              or getattr(exc, "code", None))
    if isinstance(status, int) and status in _CREDIT_STATUSES:
        return True
    msg = str(exc).lower()
    if any(str(s) in msg for s in _CREDIT_STATUSES):
        return True
    return any(p in msg for p in _CREDIT_PHRASES)


# Deterministic-ish placeholder media for mock mode. Mock frames follow the project's
# aspect ratio too — a vertical film whose stills come back 16:9 would hide exactly the
# layout bugs the mock exists to catch.
_PLACEHOLDER_IMG = "https://picsum.photos/seed/{seed}/{w}/{h}"
_ASPECT_PX = {"16:9": (768, 432), "9:16": (432, 768), "1:1": (600, 600)}

# Mock clips are rendered locally from the keyframe rather than pointed at a public sample
# video: the old sample URL now 403s, and a mock that doesn't actually play is a mock that
# hides bugs in playback and export. Rendering real files means the whole demo — timeline,
# cinema mode, stitched final cut — works offline and exercises the same code paths as a
# paid run.
_MOCK_DIR = __import__("pathlib").Path(cfg.DATA_DIR) / "mock"
_MOCK_W, _MOCK_H, _MOCK_FPS = 1280, 720, 24


def _fetch_still(url: str, dest) -> bool:
    import shutil
    import urllib.request
    try:
        if url.startswith(("http://", "https://")):
            req = urllib.request.Request(url, headers={"User-Agent": "cineforge/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
        else:
            shutil.copyfile(url, dest)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False


# How tight each shot type sits on the master frame. Every setup of a scene is animated
# from the same still, so without this the mock would render three "different angles" as
# three identical clips — and hide whether coverage was ever wired through at all.
_FRAMING_ZOOM = {
    "insert": 2.0, "close-up": 1.75, "closeup": 1.75, "over-the-shoulder": 1.45,
    "medium two-shot": 1.15, "medium shot": 1.3, "medium": 1.3, "wide shot": 1.02,
    "wide": 1.02, "establishing": 1.0,
}


def _framing_zoom(framing: str | None) -> float:
    f = (framing or "").strip().lower()
    return _FRAMING_ZOOM.get(f) or next(
        (z for k, z in _FRAMING_ZOOM.items() if k in f), 1.2)


def _mock_clip(image_url: str, seed: str, duration: int,
               framing: str | None = None, move: str | None = None) -> str | None:
    """Render a real MP4 from the master frame. Returns a served URL, or None if ffmpeg can't.

    The crop follows the requested shot type and the drift follows the requested move, so a
    close-up genuinely reads as a close-up of the same frame the wide shot came from. That
    is the whole claim of the coverage model — the mock has to be able to demonstrate it,
    or it hides the bug it exists to catch.
    """
    import hashlib
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        return None
    _MOCK_DIR.mkdir(parents=True, exist_ok=True)
    key = f"{image_url}|{framing or ''}|{move or ''}|{seed}|{duration}"
    name = hashlib.sha256(key.encode()).hexdigest()[:16] + ".mp4"
    out = _MOCK_DIR / name
    if out.exists() and out.stat().st_size > 0:
        return f"/api/media/{name}"  # cache: regenerating identical clips wastes demo time

    a = _MOCK_DIR / f".{name}.a"
    try:
        if not _fetch_still(image_url, a):
            return None

        frames = duration * _MOCK_FPS
        base = _framing_zoom(framing)
        # A pull-back opens tight and widens; everything else drifts gently inward.
        pulling = "pull" in (move or "").lower()
        start, end = (base * 1.18, base) if pulling else (base, base * 1.14)
        step = abs(end - start) / max(frames, 1)
        z = (f"max(zoom-{step:.6f},{end:.3f})" if pulling
             else f"min(zoom+{step:.6f},{end:.3f})")

        silence = ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        vf = (f"scale={_MOCK_W*2}:-2,"
              f"zoompan=z='{z}':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
              f"s={_MOCK_W}x{_MOCK_H}:fps={_MOCK_FPS},format=yuv420p")
        args = (["ffmpeg", "-y", "-loop", "1", "-i", str(a)] + silence +
                ["-t", str(duration), "-vf", vf,
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
                 "-c:a", "aac", "-shortest", str(out)])

        proc = subprocess.run(args, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0 or not out.exists():
            return None
        return f"/api/media/{name}"
    except Exception:
        return None
    finally:
        a.unlink(missing_ok=True)


def _local_path(url: str | None):
    """Disk path for a locally-served mock asset, else None. Mock clips and audio come back as
    /api/media/<name> and live in _MOCK_DIR; the ffmpeg mock reads the file, not the URL."""
    if url and url.startswith("/api/media/"):
        return _MOCK_DIR / url.rsplit("/", 1)[-1]
    return None


def _probe_duration(path) -> float | None:
    """Measured length of a media file in seconds, or None if ffprobe can't read it."""
    import shutil
    import subprocess
    if not path or not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nokey=1:noprint_wrappers=1", str(path)],
            capture_output=True, text=True, timeout=30)
        return round(float(out.stdout.strip()), 3)
    except Exception:
        return None


@dataclass
class GenResult:
    url: str
    provenance: Provenance
    thumbnail: str | None = None
    duration_sec: float | None = None


def _chain(pipeline, parent_run_id: str | None):
    """Link this render to the run it descends from, so the manifest carries the lineage.

    Genblaze's public hook is `from_result(prev_result)`, but that needs a live
    `PipelineResult` in hand — and cineforge only keeps the *summarized* provenance (a run_id
    string that survives the SSE boundary, disk, and B2). `from_result` does nothing but set
    `_parent_run_id = result.run.run_id`, and `run()` reads that attr directly (pipeline.py
    consumes `self._parent_run_id`), so seeding it from the persisted id is the same edge with
    one fewer object to hold.
    """
    if parent_run_id:
        pipeline._parent_run_id = parent_run_id
    return pipeline


def _first_asset(result, what: str):
    """The step's output asset, or a clear error explaining why there isn't one.

    A failed step (quota, moderation, a bad model id, a provider outage) comes back with an
    empty `assets` list, not an exception — so a bare `.assets[0]` turns every real failure
    into a cryptic IndexError. Surface the provider's own message instead; the QC gate and the
    SSE stream both depend on knowing *why* a render didn't happen.
    """
    step = result.run.steps[-1]
    if not step.assets:
        reason = (getattr(step, "error", None) or getattr(result, "error_summary", None)
                  or "no asset returned")
        raise RuntimeError(f"{what} failed: {reason}")
    return step.assets[0]


def _image_asset(url: str):
    """Wrap a still URL as a Genblaze input Asset for image conditioning.

    Genblaze routes conditioning frames off ``Step.inputs`` (``route_images``), keyed by
    MIME prefix — not off a prompt/param string. So a reference sheet or master frame has to
    enter the step as an ``external_inputs`` Asset whose ``media_type`` starts with ``image/``,
    or the provider generates unconditioned and the whole consistency claim silently breaks.
    The extension is only a hint for the MIME type; the URL is what the provider fetches.
    """
    from genblaze_core import Asset
    ext = url.rsplit(".", 1)[-1].lower().split("?")[0]
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}.get(ext, "image/png")
    return Asset(url=url, media_type=mime)


def _storage():
    """Build the B2 sink (real mode only)."""
    from genblaze_core import ObjectStorageSink, KeyStrategy
    from genblaze_s3 import S3StorageBackend
    return ObjectStorageSink(
        S3StorageBackend.for_backblaze(cfg.B2_BUCKET),
        key_strategy=KeyStrategy.HIERARCHICAL,
    )


def _seed_int(seed: str) -> int:
    """Fold the director's per-attempt seed string into a stable int the image model accepts.

    The retry/regen loop varies this string per attempt (`{n}-{i}-{attempt}`) to force a fresh
    frame, but that only reaches the model as `Step.seed` (`int | None`) — genblaze lifts it
    out of the step params and `BaseProvider.prepare_payload` re-injects it into the request,
    and the GMICloud image surface allows `seed`. Hashing keeps the mapping deterministic (the
    same string reproduces the same frame — the point of a seed) while distinct strings stay
    distinct. Bounded to signed-32-bit so a provider that caps the seed range can't reject it.
    """
    import hashlib
    return int.from_bytes(hashlib.sha256(seed.encode()).digest()[:4], "big") % 2_147_483_647


def _image_provider():
    if cfg.PROVIDER_STACK == "openai":
        from genblaze_openai import DalleProvider
        return DalleProvider(), "gpt-image-1"
    from genblaze_gmicloud import GMICloudImageProvider
    # api_key= overrides the GMI_API_KEY env fallback, so a caller's own key bills their
    # account; None keeps the provider's env fallback (the host key) untouched.
    return GMICloudImageProvider(api_key=_active_key()), cfg.IMAGE_MODEL


def _video_provider():
    if cfg.PROVIDER_STACK == "openai":
        from genblaze_openai import SoraProvider
        return SoraProvider(), "sora-2"
    from genblaze_gmicloud import GMICloudVideoProvider
    return GMICloudVideoProvider(api_key=_active_key()), cfg.I2V_MODEL


# ---------------- Public API used by the AI layer ----------------

def generate_image(prompt: str, *, seed: str = "x", ref_urls: list[str] | None = None,
                   aspect_ratio: str = "16:9", parent_run_id: str | None = None) -> GenResult:
    """Generate a still (character sheet, environment plate, or scene keyframe).

    `seed` is the retry/regen loop's per-attempt handle: it picks the mock placeholder in mock
    mode and is forwarded to the real image model as `Step.seed` (see `_seed_int`), so a
    re-render genuinely differs instead of leaning on provider randomness. `parent_run_id`
    links this render to the take it was regenerated from, so the manifest carries the lineage
    (see `_chain`).
    """
    if _mock_media():
        time.sleep(0.2)
        model = cfg.IMAGE_MODEL if cfg.PROVIDER_STACK == "gmicloud" else "gpt-image-1"
        w, h = _ASPECT_PX.get(aspect_ratio, _ASPECT_PX["16:9"])
        url = _PLACEHOLDER_IMG.format(seed=seed, w=w, h=h)
        return GenResult(
            url=url,
            thumbnail=url,
            provenance=mock_provenance(cfg.PROVIDER_STACK, model, prompt, parent_run_id),
        )

    from genblaze_core import Pipeline, Modality
    provider, model = _image_provider()
    # The per-attempt seed the retry/regen loop varies has to reach the model to make a
    # re-render actually differ; forwarded as Step.seed (see _seed_int), not left in mock mode.
    step_kwargs = dict(model=model, prompt=prompt, modality=Modality.IMAGE,
                       aspect_ratio=aspect_ratio, seed=_seed_int(seed))
    if cfg.image_fallbacks():
        step_kwargs["fallback_models"] = cfg.image_fallbacks()
    # ref sheets condition the still. Genblaze reads conditioning images off the step's
    # inputs, not a prompt param, so they enter as external_inputs (see _image_asset).
    if ref_urls:
        step_kwargs["external_inputs"] = [_image_asset(u) for u in ref_urls]
    pipe = _chain(Pipeline("keyframe").step(provider, **step_kwargs), parent_run_id)
    result = pipe.run(sink=_storage(), timeout=300)
    asset = _first_asset(result, f"image ({model})")
    prov = summarize_manifest(result.manifest, prompt)
    prov.provider, prov.model, prov.sha256 = cfg.PROVIDER_STACK, model, getattr(asset, "sha256", None)
    return GenResult(url=asset.url, thumbnail=asset.url, provenance=prov)


def image_to_video(image_url: str, prompt: str, *, duration: int = 8,
                   aspect_ratio: str = "16:9", framing: str | None = None,
                   move: str | None = None, parent_run_id: str | None = None,
                   on_progress=None) -> GenResult:
    """Animate an approved master frame into one shot — the consistency-preserving step.

    Every setup of a scene is animated from the same approved still, so the frame a human
    said yes to is the frame all of its coverage inherits. `framing`/`move` describe the
    setup being shot; the real providers read them out of the prompt, and the mock uses them
    to crop, so both paths actually differ per setup. `parent_run_id` links a re-shoot to the
    take it descends from (see `_chain`).
    """
    if _mock_media():
        time.sleep(0.3)
        model = cfg.I2V_MODEL if cfg.PROVIDER_STACK == "gmicloud" else "sora-2"
        url = _mock_clip(image_url, prompt[:40], duration, framing=framing, move=move)
        return GenResult(
            url=url or image_url,  # no ffmpeg: fall back to the still so the UI still shows something
            thumbnail=image_url, duration_sec=float(duration),
            provenance=mock_provenance(cfg.PROVIDER_STACK, model, prompt, parent_run_id),
        )

    from genblaze_core import Pipeline, Modality
    provider, model = _video_provider()
    # The approved master frame is the conditioning input, not a prompt param — Genblaze's
    # image->video providers read it off the step's inputs (see _image_asset). This is the
    # frame the human said yes to, and every setup's coverage inherits it.
    step_kwargs = dict(model=model, prompt=prompt, modality=Modality.VIDEO,
                       duration=duration, aspect_ratio=aspect_ratio,
                       external_inputs=[_image_asset(image_url)])
    if cfg.video_fallbacks():
        step_kwargs["fallback_models"] = cfg.video_fallbacks()
    pipe = _chain(Pipeline("image-to-video").step(provider, **step_kwargs), parent_run_id)
    result = pipe.run(sink=_storage(), timeout=600, on_progress=on_progress)
    asset = _first_asset(result, f"video ({model})")
    prov = summarize_manifest(result.manifest, prompt)
    prov.provider, prov.model, prov.sha256 = cfg.PROVIDER_STACK, model, getattr(asset, "sha256", None)
    return GenResult(url=asset.url, thumbnail=image_url,
                     duration_sec=float(duration), provenance=prov)


def tts(text: str, *, voice_id: str = "JBFqnCBsd6RMkjVDRZzb") -> GenResult:
    """Narration / dialogue via ElevenLabs — returns the clip AND its measured length.

    The duration is load-bearing for lip-sync: a line is placed at an offset inside the shot
    and synced over ``[start, start+duration]``, so a bare URL isn't enough. The mock returns a
    real (tone) file of a plausible length rather than a ``mock://`` sentinel, so timelined
    dialogue is demonstrable offline the same way ``_mock_clip`` demos coverage.
    """
    if cfg.mock_media() or not cfg.ELEVENLABS_API_KEY:
        url, dur = _mock_tts(text)
        return GenResult(url=url, duration_sec=dur,
                         provenance=mock_provenance("elevenlabs", cfg.TTS_MODEL, text))
    from genblaze_core import Pipeline, Modality
    from genblaze_elevenlabs import ElevenLabsTTSProvider
    result = Pipeline("narration").step(
        ElevenLabsTTSProvider(output_dir="output/"), model=cfg.TTS_MODEL,
        prompt=text, modality=Modality.AUDIO, voice_id=voice_id,
    ).run(sink=_storage())
    asset = result.run.steps[-1].assets[0]
    prov = summarize_manifest(result.manifest, text)
    prov.provider, prov.model = "elevenlabs", cfg.TTS_MODEL
    return GenResult(url=asset.url, duration_sec=getattr(asset, "duration_sec", None),
                     provenance=prov)


def _mock_tts(text: str) -> tuple[str, float]:
    """A cached sine-tone stand-in whose length tracks the line (~2.6 words/sec speech).

    Not a voice — just a real, correctly-sized audio file so the dialogue mock can place
    something audible at its start offset and exercise the true playback/export path. Falls
    back to the ``mock://`` sentinel (no placement) only when ffmpeg is absent.
    """
    import hashlib
    import shutil
    import subprocess
    dur = round(max(0.8, len(text.split()) / 2.6), 2)
    if not shutil.which("ffmpeg"):
        return "mock://audio.mp3", dur
    _MOCK_DIR.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(f"tts|{text}".encode()).hexdigest()[:16] + ".m4a"
    out = _MOCK_DIR / name
    if not (out.exists() and out.stat().st_size > 0):
        subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
                        f"sine=frequency=200:duration={dur}", "-c:a", "aac", str(out)],
                       capture_output=True, timeout=60)
    return f"/api/media/{name}", dur


def lipsync(clip_url: str, audio_url: str, *, start: float = 0.0,
            duration: float | None = None, parent_run_id: str | None = None) -> GenResult:
    """Sync a character's mouth to a line, over one window of an already-rendered clip.

    Approach B (layer-after-i2v): the seedance clip keeps its camera move; this pass drives the
    mouth from the dialogue audio placed at ``start``, so the line "plugs in at that spot"
    rather than replacing the whole render. Returns a new clip URL of the same length.
    """
    if cfg.mock_media():
        # The mock can't move lips — and shouldn't pretend to. What it proves is the timing
        # contract: mux the line onto the clip at `start`, clip length preserved, so the
        # timeline, cinema mode and export all exercise the real playback path.
        url = _mock_lipsync(clip_url, audio_url, start)
        return GenResult(
            url=url or clip_url, thumbnail=clip_url,
            duration_sec=_probe_duration(_local_path(clip_url)),
            provenance=mock_provenance(cfg.PROVIDER_STACK, "sync-mock",
                                       f"lipsync @{start:.2f}s", parent_run_id))

    # Real path: Sync.so drives the mouth for the whole clip against the audio it's given.
    # Placement at `start` is the mock's job today; in real mode the caller passes an audio
    # track already positioned in the shot's window (see _sync_dialogue). Verify the model slug
    # and request/response shape against docs.sync.so before a paid run.
    if not cfg.SYNC_API_KEY:
        raise RuntimeError("lipsync: SYNC_API_KEY is not set")
    out_url, job_id = _sync_generate(clip_url, audio_url)
    prov = Provenance(provider="sync.so", model=cfg.LIPSYNC_MODEL,
                      prompt=f"lipsync @{start:.2f}s", run_id=job_id,
                      parent_run_id=parent_run_id)
    return GenResult(url=out_url, thumbnail=clip_url, duration_sec=duration, provenance=prov)


def _mock_lipsync(clip_url: str, audio_url: str, start: float) -> str | None:
    """Mux the dialogue onto the silent clip at `start`, clip length unchanged. Cached like
    _mock_clip. Returns a served URL, or None if ffmpeg/inputs are unavailable."""
    import hashlib
    import shutil
    import subprocess
    clip, audio = _local_path(clip_url), _local_path(audio_url)
    if not shutil.which("ffmpeg") or not (clip and clip.exists()) or not (audio and audio.exists()):
        return None
    _MOCK_DIR.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(f"ls|{clip_url}|{audio_url}|{start}".encode()).hexdigest()[:16] + ".mp4"
    out = _MOCK_DIR / name
    if out.exists() and out.stat().st_size > 0:
        return f"/api/media/{name}"
    dur = _probe_duration(clip) or 8.0
    delay = int(max(0.0, start) * 1000)
    # Video untouched; the line is delayed to `start`, then mixed under the clip's own (silent)
    # track so the muxer keeps one stereo stream. Trim back to the clip's length.
    args = ["ffmpeg", "-y", "-i", str(clip), "-i", str(audio),
            "-filter_complex",
            f"[1:a]adelay={delay}|{delay}[d];[0:a][d]amix=inputs=2:duration=first[a]",
            "-map", "0:v", "-map", "[a]", "-t", str(dur),
            "-c:v", "copy", "-c:a", "aac", str(out)]
    proc = subprocess.run(args, capture_output=True, text=True, timeout=180)
    return f"/api/media/{name}" if proc.returncode == 0 and out.exists() else None


def _sync_generate(clip_url: str, audio_url: str) -> tuple[str, str]:
    """Submit a Sync.so lip-sync job and poll to completion. Returns (output_url, job_id).

    Sync.so authenticates with `x-api-key` (not Bearer) and returns a job to poll, so it can't
    reuse `_post_json`. Model slug and field names must be verified against docs.sync.so — a
    dead slug fails the whole pass, same as the GMICloud queue slugs.
    """
    import os
    base = os.getenv("SYNC_BASE_URL", "https://api.sync.so/v2")
    payload = {"model": cfg.LIPSYNC_MODEL,
               "input": [{"type": "video", "url": clip_url},
                         {"type": "audio", "url": audio_url}],
               "options": {"sync_mode": "cut_off"}}
    job = _sync_request("POST", f"{base}/generate", payload)
    job_id = job.get("id")
    if not job_id:
        raise RuntimeError(f"sync.so: no job id in response ({job})")
    for _ in range(120):  # up to ~10 min at 5s
        time.sleep(5)
        st = _sync_request("GET", f"{base}/generate/{job_id}")
        status = st.get("status")
        if status == "COMPLETED":
            url = st.get("outputUrl") or st.get("output_url")
            if not url:
                raise RuntimeError(f"sync.so job {job_id} completed without an output url")
            return url, job_id
        if status in ("FAILED", "CANCELED", "REJECTED", "TIMED_OUT"):
            raise RuntimeError(f"sync.so job {job_id} {status}: {st.get('error')}")
    raise RuntimeError(f"sync.so job {job_id} did not finish in time")


def _sync_request(method: str, url: str, payload: dict | None = None, timeout: int = 90) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json", "x-api-key": cfg.SYNC_API_KEY,
                 "User-Agent": "cineforge/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _post_json(url: str, payload: dict, api_key: str, timeout: int = 90) -> dict:
    """Minimal OpenAI-compatible POST on the stdlib — no SDK, no extra dependency."""
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}",
                 # GMICloud sits behind Cloudflare, which 403s the default urllib agent
                 # ("error code: 1010"); a named agent clears it (same as _fetch_still).
                 "User-Agent": "cineforge/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def chat(system: str, user: str, *, json_mode: bool = False, temperature: float = 0.8,
         image_urls: list[str] | None = None, model: str | None = None) -> str:
    """LLM call for the planner/story/route/QC agents (structured reasoning).

    Text is the cheap half of this product, so it goes live on any key — independent of
    MOCK_MODE, which governs only images/video. Genblaze is preferred when installed so the
    provider story stays consistent; otherwise we talk the OpenAI-compatible wire protocol
    directly, which both OpenAI and GMI Cloud speak.

    `image_urls` makes this a vision call: every entry becomes its own image content part,
    in order, so the QC agent can hand over the generated frames *and* the reference sheets
    they must match in one comparison. Entries may be https URLs or `data:` URIs — the
    latter is how locally-rendered clips get seen without being published first.

    Returns "" when there is no key — every caller treats that as "use your fallback".
    """
    if _mock_text():
        return ""  # callers supply their own mock structure

    prefer_openai = cfg.PROVIDER_STACK == "openai" or bool(cfg.OPENAI_API_KEY)
    # json_mode maps to the OpenAI-compatible response_format both providers speak. A full
    # film synthesis is a long, large JSON, so the planner lifts the adapter's defaults (60s,
    # a low token cap) that would otherwise truncate the bible mid-object.
    rformat = {"type": "json_object"} if json_mode else None

    # 1) Genblaze adapters, if the packages are actually installed. Skipped for vision
    #    calls — their chat() helpers take plain strings, not multimodal content parts.
    #    These are thin wrappers over the provider's OpenAI-compatible endpoint and return a
    #    ChatResponse; the reasoning agents want the raw text off `.text`.
    try:
        if image_urls:
            raise ImportError
        if prefer_openai and cfg.OPENAI_API_KEY:
            from genblaze_openai import chat as oai_chat
            return oai_chat(model=model or cfg.CHAT_MODEL, system=system, prompt=user,
                            temperature=temperature, response_format=rformat,
                            max_tokens=16000, timeout=300).text
        if _active_key():
            from genblaze_gmicloud import chat as gmi_chat
            return gmi_chat(model=model or cfg.GMI_CHAT_MODEL, system=system, prompt=user,
                            temperature=temperature, response_format=rformat,
                            max_tokens=16000, timeout=300, api_key=_active_key()).text
    except ImportError:
        pass  # not installed yet — fall through to the direct wire call

    # 2) Direct OpenAI-compatible call. Both OpenAI and GMICloud speak the multimodal wire,
    #    so vision routes to whichever key we have rather than pinning to OpenAI: GMICloud's
    #    chat catalog carries vision-capable models (Claude, GPT-4o, Gemini), so the judge on
    #    the Backblaze stack can see without an OpenAI key. The caller pins the model
    #    (QC_MODEL); for GMI that must be a namespaced vision slug or the frames come back
    #    unseen — which surfaces as an unreadable reply (SKIPPED), not a rubber-stamped PASS.
    import os
    if prefer_openai and cfg.OPENAI_API_KEY:
        base = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        key, model = cfg.OPENAI_API_KEY, model or cfg.CHAT_MODEL
    elif _active_key():
        base = os.getenv("GMI_BASE_URL", "https://api.gmi-serving.com/v1")
        key = _active_key()
        model = model or cfg.GMI_CHAT_MODEL
    else:
        return ""

    content = user
    if image_urls:  # multimodal content parts — this is what makes the QC gate actually see
        content = [{"type": "text", "text": user}] + [
            {"type": "image_url", "image_url": {"url": u}} for u in image_urls]

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
        "temperature": temperature,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    # Vision calls carry several inlined frames and think for longer than a text turn does.
    data = _post_json(f"{base}/chat/completions", payload, key,
                      timeout=240 if image_urls else 90)
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""


def chat_stream(system: str, user: str, *, json_mode: bool = False,
                temperature: float = 0.8, model: str | None = None, timeout: int = 300):
    """Streaming sibling of chat() for the planner's one long synthesis call.

    Yields text deltas as the model writes them; the concatenation of everything yielded is
    the same string chat() would return in one blocking piece. It talks the OpenAI-compatible
    SSE wire directly — both OpenAI and GMICloud speak it — because the genblaze adapters'
    chat() helpers hand back a settled string with no per-token hook, and the whole point here
    is to see the tokens arrive.

    Text-only by design (the planner never sends images), so it skips the vision plumbing in
    chat(). Yields nothing when there is no key, exactly as chat() returns "" — the caller
    falls back to its own path either way.
    """
    if _mock_text():
        return

    import os
    prefer_openai = cfg.PROVIDER_STACK == "openai" or bool(cfg.OPENAI_API_KEY)
    if prefer_openai and cfg.OPENAI_API_KEY:
        base = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        key, model = cfg.OPENAI_API_KEY, model or cfg.CHAT_MODEL
    elif _active_key():
        base = os.getenv("GMI_BASE_URL", "https://api.gmi-serving.com/v1")
        key, model = _active_key(), model or cfg.GMI_CHAT_MODEL
    else:
        return

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": temperature,
        "stream": True,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}",
                 "User-Agent": "cineforge/1.0"},  # named agent clears Cloudflare (see _post_json)
        method="POST",
    )
    # The response is line-iterable and SSE frames are line-delimited, so reading line by line
    # is enough — no need to buffer for the blank-line frame separator the wire also sends.
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                delta = json.loads(data)["choices"][0]["delta"].get("content")
            except (json.JSONDecodeError, LookupError):
                continue  # keep-alive comment or a frame without a content delta
            if delta:
                yield delta
