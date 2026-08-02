"""Central config.

Two independent mock switches, because text and pixels have wildly different economics:

* **text** (planner / scene / QC reasoning) costs cents — it goes live the moment *any* LLM
  key exists, so a judge who types their own idea gets a bespoke screenplay, not a fixture.
* **media** (image / video / audio) costs real money and minutes — it stays mocked until
  you explicitly turn it on.

`MOCK_MODE` is the master default for media; `MOCK_MEDIA` overrides it. With zero keys the
whole app still runs exactly as before.
"""
import os
from functools import lru_cache

try:
    from pathlib import Path as _Path

    from dotenv import load_dotenv
    # Load backend/.env by its own path, not the CWD. `uvicorn backend.app:app` and
    # `python -m backend.scripts.smoke_real` both run from the repo root, where a bare
    # load_dotenv() would look for ./.env and silently miss the file that lives here.
    load_dotenv(_Path(__file__).with_name(".env"))
except Exception:  # dotenv optional
    pass


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    MOCK_MODE: bool = _bool(os.getenv("MOCK_MODE"), default=True)
    PROVIDER_STACK: str = os.getenv("PROVIDER_STACK", "gmicloud")  # gmicloud | openai

    # Backblaze B2
    B2_KEY_ID = os.getenv("B2_KEY_ID")
    B2_APP_KEY = os.getenv("B2_APP_KEY")
    B2_BUCKET = os.getenv("B2_BUCKET", "cineforge")
    B2_REGION = os.getenv("B2_REGION", "us-west-004")
    B2_ENDPOINT = os.getenv("B2_ENDPOINT")  # derived from region when unset

    # Providers
    GMI_API_KEY = os.getenv("GMI_API_KEY")
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    SYNC_API_KEY = os.getenv("SYNC_API_KEY")  # Sync.so lip-sync (x-api-key auth)

    # Model defaults (overridable). See genblaze provider matrix.
    # Model slugs are the GMICloud request-queue catalog (console.gmicloud.ai/.../requestqueue),
    # which is a different namespace from the chat catalog and moves on its own — the older
    # kling i2v slugs 404 there now. Image and video are kept in the ByteDance seed* family so
    # a still and the shot animated from it share a look. Verify a slug with GET /models on the
    # queue before changing it; a dead slug fails the whole render pass, not just one frame.
    IMAGE_MODEL = os.getenv("IMAGE_MODEL", "seedream-5.0-lite")
    I2V_MODEL = os.getenv("I2V_MODEL", "seedance-1-0-pro-250528")
    TTS_MODEL = os.getenv("TTS_MODEL", "eleven_v3")
    # Lip-sync (Sync.so) — a windowed mouth-edit over an already-rendered clip, so a shot
    # keeps its seedance camera move and only the mouth is driven by the dialogue audio. This
    # is Sync.so's own REST API (api.sync.so/v2), not a GMICloud queue slug: verify the model
    # id and request/response shape against docs.sync.so before a paid run — a wrong slug fails
    # the whole lip-sync pass, same caution as the image/video queue slugs above.
    LIPSYNC_MODEL = os.getenv("LIPSYNC_MODEL", "lipsync-2.0.0")
    CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o")
    # GMICloud namespaces its model ids ("anthropic/claude-sonnet-4.5"); the bare OpenAI
    # slugs the OpenAI stack uses 404 there, so the GMI planner model is its own setting.
    GMI_CHAT_MODEL = os.getenv("GMI_CHAT_MODEL", "anthropic/claude-sonnet-4.5")

    # Provider fallback — when the primary model errors mid-run, Genblaze retries the step on
    # the next model in this list (same provider). Same-family defaults keep the param
    # contract stable (a fallback that itself rejects `duration`/`aspect_ratio` is no fallback
    # at all). All defaults are verified-present in the genblaze model matrix.
    _FALLBACKS = {
        "gmicloud": {"image": ["gemini-2.5-flash-image"],
                     "video": ["seedance-1-5-pro-251215"]},
        "openai": {"image": ["gpt-image-1-mini"], "video": []},
    }

    # QC — the review agent. It looks at pixels, so it needs a vision-capable model of its
    # own: the planner's model may be text-only (llama-3.3-70b on GMI is), and a judge that
    # can't see would silently degrade into rubber-stamping every frame.
    # Default to a vision-capable slug for the active stack. GMICloud namespaces its ids and
    # 404s the bare `gpt-4o`, so the Backblaze stack points QC at a GMI multimodal model
    # (Claude Sonnet sees) — no OpenAI key required for the judge to actually look.
    QC_MODEL = os.getenv("QC_MODEL") or (
        "anthropic/claude-sonnet-4.5" if PROVIDER_STACK == "gmicloud" else "gpt-4o")
    QC_MAX_REGENS = int(os.getenv("QC_MAX_REGENS", "2"))
    # A re-animation costs minutes and real money where a re-frame costs cents, so the
    # video gate gets a tighter budget than the still gate.
    QC_MAX_VIDEO_REGENS = int(os.getenv("QC_MAX_VIDEO_REGENS", "1"))
    QC_FRAME_SAMPLES = int(os.getenv("QC_FRAME_SAMPLES", "3"))  # frames sampled per clip

    # How many reference images a single keyframe render may condition on. A frame is built
    # from the sheets of the characters actually in it plus the scene's location plate, and
    # image models commonly honour only the first few reference inputs — so this bounds the
    # set, faces first and the plate reserved, rather than letting a crowd scene overflow it
    # and drop identities at the provider's discretion. See director._unit_refs.
    MAX_REF_IMAGES = int(os.getenv("MAX_REF_IMAGES", "4"))

    # How many independent renders a generation pass runs at once. The sheets and keyframe
    # passes fan their units out across a small thread pool — each unit is a blocking provider
    # call that spends most of its time waiting on the network, so a handful in flight cuts a
    # pass's wall time without touching cost. Kept small by default so a burst never trips the
    # provider's own concurrency/rate cap; raise it once you know your plan's limit.
    GEN_CONCURRENCY = int(os.getenv("GEN_CONCURRENCY", "3"))
    # Video is the longest pass and benefits most from overlap, but each request is expensive
    # and providers commonly enforce a tighter cap. Keep its independent default conservative.
    VIDEO_CONCURRENCY = int(os.getenv("VIDEO_CONCURRENCY", "2"))

    # Where projects + exports land when B2 isn't configured (and the local cache when it is).
    DATA_DIR = os.getenv("DATA_DIR", ".data")

    # ---- capability probes -------------------------------------------------

    @classmethod
    def has_llm(cls) -> bool:
        """Any key that can answer a chat() call."""
        return bool(cls.OPENAI_API_KEY or cls.GMI_API_KEY)

    @classmethod
    def mock_text(cls) -> bool:
        """Text is live whenever we have a key — MOCK_MODE does not gate it."""
        return not cls.has_llm()

    @classmethod
    def can_see(cls) -> bool:
        """Whether QC can actually look at an image.

        Vision goes over the OpenAI-compatible multimodal wire format, which both OpenAI and
        GMICloud speak — GMICloud's chat catalog carries vision-capable models, so a GMI key
        alone is enough (with a vision QC_MODEL). Without any such key QC still runs — it just
        says so in the report instead of pretending to have looked. A vision model that ignores
        the images degrades to an unreadable reply → SKIPPED, never a false PASS.
        """
        return bool(cls.OPENAI_API_KEY or cls.GMI_API_KEY)

    @classmethod
    def mock_media(cls) -> bool:
        """Images/video/audio: explicit MOCK_MEDIA wins, else follow MOCK_MODE."""
        return _bool(os.getenv("MOCK_MEDIA"), default=cls.MOCK_MODE)

    @classmethod
    def _fallbacks(cls, kind: str) -> list[str]:
        """Fallback model list for `kind` ("image" | "video"). Env overrides the default:
        a comma-separated `IMAGE_FALLBACK_MODELS` / `I2V_FALLBACK_MODELS` (empty string
        disables fallback), else the stack's verified defaults."""
        env = os.getenv("IMAGE_FALLBACK_MODELS" if kind == "image" else "I2V_FALLBACK_MODELS")
        if env is not None:
            return [m.strip() for m in env.split(",") if m.strip()]
        return list(cls._FALLBACKS.get(cls.PROVIDER_STACK, {}).get(kind, []))

    @classmethod
    def image_fallbacks(cls) -> list[str]:
        return cls._fallbacks("image")

    @classmethod
    def video_fallbacks(cls) -> list[str]:
        return cls._fallbacks("video")

    @classmethod
    def has_b2(cls) -> bool:
        return bool(cls.B2_KEY_ID and cls.B2_APP_KEY and cls.B2_BUCKET)

    @classmethod
    def b2_endpoint(cls) -> str:
        return cls.B2_ENDPOINT or f"https://s3.{cls.B2_REGION}.backblazeb2.com"

    @classmethod
    def ready_for_real(cls) -> bool:
        return bool(cls.has_b2() and (cls.GMI_API_KEY or cls.OPENAI_API_KEY))


@lru_cache
def get_config() -> Config:
    return Config()
