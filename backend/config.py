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
    from dotenv import load_dotenv
    load_dotenv()
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

    # Model defaults (overridable). See genblaze provider matrix.
    IMAGE_MODEL = os.getenv("IMAGE_MODEL", "seedream-5.0-lite")
    I2V_MODEL = os.getenv("I2V_MODEL", "kling-image2video-v2.1-master")
    TTS_MODEL = os.getenv("TTS_MODEL", "eleven_v3")
    CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o")

    # QC — the review agent. It looks at pixels, so it needs a vision-capable model of its
    # own: the planner's model may be text-only (llama-3.3-70b on GMI is), and a judge that
    # can't see would silently degrade into rubber-stamping every frame.
    QC_MODEL = os.getenv("QC_MODEL", "gpt-4o")
    QC_MAX_REGENS = int(os.getenv("QC_MAX_REGENS", "2"))
    # A re-animation costs minutes and real money where a re-frame costs cents, so the
    # video gate gets a tighter budget than the still gate.
    QC_MAX_VIDEO_REGENS = int(os.getenv("QC_MAX_VIDEO_REGENS", "1"))
    QC_FRAME_SAMPLES = int(os.getenv("QC_FRAME_SAMPLES", "3"))  # frames sampled per clip

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

        Vision goes over the OpenAI-compatible multimodal wire format, so it needs a key
        that speaks it. Without one QC still runs — it just says so in the report instead
        of pretending to have looked.
        """
        return bool(cls.OPENAI_API_KEY)

    @classmethod
    def mock_media(cls) -> bool:
        """Images/video/audio: explicit MOCK_MEDIA wins, else follow MOCK_MODE."""
        return _bool(os.getenv("MOCK_MEDIA"), default=cls.MOCK_MODE)

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
