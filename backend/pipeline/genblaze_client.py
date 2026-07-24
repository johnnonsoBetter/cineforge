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


@dataclass
class GenResult:
    url: str
    provenance: Provenance
    thumbnail: str | None = None
    duration_sec: float | None = None


def _storage():
    """Build the B2 sink (real mode only)."""
    from genblaze_core import ObjectStorageSink, KeyStrategy
    from genblaze_s3 import S3StorageBackend
    return ObjectStorageSink(
        S3StorageBackend.for_backblaze(cfg.B2_BUCKET),
        key_strategy=KeyStrategy.HIERARCHICAL,
    )


def _image_provider():
    if cfg.PROVIDER_STACK == "openai":
        from genblaze_openai import DalleProvider
        return DalleProvider(), "gpt-image-1"
    from genblaze_gmicloud import GMICloudImageProvider
    return GMICloudImageProvider(), cfg.IMAGE_MODEL


def _video_provider():
    if cfg.PROVIDER_STACK == "openai":
        from genblaze_openai import SoraProvider
        return SoraProvider(), "sora-2"
    from genblaze_gmicloud import GMICloudVideoProvider
    return GMICloudVideoProvider(), cfg.I2V_MODEL


# ---------------- Public API used by the AI layer ----------------

def generate_image(prompt: str, *, seed: str = "x", ref_urls: list[str] | None = None,
                   aspect_ratio: str = "16:9") -> GenResult:
    """Generate a still (character sheet, environment plate, or scene keyframe)."""
    if cfg.mock_media():
        time.sleep(0.2)
        model = cfg.IMAGE_MODEL if cfg.PROVIDER_STACK == "gmicloud" else "gpt-image-1"
        w, h = _ASPECT_PX.get(aspect_ratio, _ASPECT_PX["16:9"])
        url = _PLACEHOLDER_IMG.format(seed=seed, w=w, h=h)
        return GenResult(
            url=url,
            thumbnail=url,
            provenance=mock_provenance(cfg.PROVIDER_STACK, model, prompt),
        )

    from genblaze_core import Pipeline, Modality
    provider, model = _image_provider()
    step_kwargs = dict(model=model, prompt=prompt, modality=Modality.IMAGE,
                       aspect_ratio=aspect_ratio)
    # ref_urls -> image conditioning where the provider supports it (input routing).
    if ref_urls:
        step_kwargs["image"] = ref_urls[0]
    result = Pipeline("keyframe").step(provider, **step_kwargs).run(sink=_storage(), timeout=300)
    asset = result.run.steps[-1].assets[0]
    prov = summarize_manifest(result.manifest, prompt)
    prov.provider, prov.model, prov.sha256 = cfg.PROVIDER_STACK, model, getattr(asset, "sha256", None)
    return GenResult(url=asset.url, thumbnail=asset.url, provenance=prov)


def image_to_video(image_url: str, prompt: str, *, duration: int = 8,
                   aspect_ratio: str = "16:9", framing: str | None = None,
                   move: str | None = None) -> GenResult:
    """Animate an approved master frame into one shot — the consistency-preserving step.

    Every setup of a scene is animated from the same approved still, so the frame a human
    said yes to is the frame all of its coverage inherits. `framing`/`move` describe the
    setup being shot; the real providers read them out of the prompt, and the mock uses them
    to crop, so both paths actually differ per setup.
    """
    if cfg.mock_media():
        time.sleep(0.3)
        model = cfg.I2V_MODEL if cfg.PROVIDER_STACK == "gmicloud" else "sora-2"
        url = _mock_clip(image_url, prompt[:40], duration, framing=framing, move=move)
        return GenResult(
            url=url or image_url,  # no ffmpeg: fall back to the still so the UI still shows something
            thumbnail=image_url, duration_sec=float(duration),
            provenance=mock_provenance(cfg.PROVIDER_STACK, model, prompt),
        )

    from genblaze_core import Pipeline, Modality
    provider, model = _video_provider()
    step_kwargs = dict(model=model, prompt=prompt, modality=Modality.VIDEO,
                       image=image_url, duration=duration, aspect_ratio=aspect_ratio)
    result = Pipeline("image-to-video").step(provider, **step_kwargs).run(
        sink=_storage(), timeout=600)
    asset = result.run.steps[-1].assets[0]
    prov = summarize_manifest(result.manifest, prompt)
    prov.provider, prov.model, prov.sha256 = cfg.PROVIDER_STACK, model, getattr(asset, "sha256", None)
    return GenResult(url=asset.url, thumbnail=image_url,
                     duration_sec=float(duration), provenance=prov)


def tts(text: str, *, voice_id: str = "JBFqnCBsd6RMkjVDRZzb") -> GenResult:
    """Narration / dialogue via ElevenLabs (fallback path)."""
    if cfg.mock_media() or not cfg.ELEVENLABS_API_KEY:
        time.sleep(0.1)
        return GenResult(url="mock://audio.mp3",
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
    return GenResult(url=asset.url, provenance=prov)


def _post_json(url: str, payload: dict, api_key: str, timeout: int = 90) -> dict:
    """Minimal OpenAI-compatible POST on the stdlib — no SDK, no extra dependency."""
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
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
    if cfg.mock_text():
        return ""  # callers supply their own mock structure

    prefer_openai = cfg.PROVIDER_STACK == "openai" or bool(cfg.OPENAI_API_KEY)

    # 1) Genblaze adapters, if the packages are actually installed. Skipped for vision
    #    calls — their chat() helpers take plain strings, not multimodal content parts.
    try:
        if image_urls:
            raise ImportError
        if prefer_openai and cfg.OPENAI_API_KEY:
            from genblaze_openai import chat as oai_chat
            return oai_chat(model=model or cfg.CHAT_MODEL, system=system, user=user)
        if cfg.GMI_API_KEY:
            from genblaze_gmicloud import chat as gmi_chat
            return gmi_chat(model=model or "llama-3.3-70b", system=system, user=user)
    except ImportError:
        pass  # not installed yet — fall through to the direct wire call

    # 2) Direct OpenAI-compatible call. Vision pins to OpenAI: the GMI text model can't see,
    #    and a judge silently answering from the brief alone is worse than no judge.
    import os
    if (prefer_openai or image_urls) and cfg.OPENAI_API_KEY:
        base = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        key, model = cfg.OPENAI_API_KEY, model or cfg.CHAT_MODEL
    elif cfg.GMI_API_KEY and not image_urls:
        base = os.getenv("GMI_BASE_URL", "https://api.gmi-serving.com/v1")
        key = cfg.GMI_API_KEY
        model = model or os.getenv("GMI_CHAT_MODEL", "llama-3.3-70b")
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
