"""Smoke test for the real (non-mock) generation path.

Two parts, run in order:

* **Part A — API shape (no keys).** Asserts every Genblaze symbol/shape the client depends
  on still exists in the installed packages: Pipeline/Modality/Asset, PipelineResult(run,
  manifest), route_images reading Step.inputs, S3StorageBackend.for_backblaze's env
  fallback. This is the guard against silent API drift on a package bump — it needs no keys
  and no network, so CI and every dev can run it.

* **Part B — one real round-trip (needs keys).** Only runs when cfg.ready_for_real(): a real
  generate_image -> image_to_video, asserting a durable URL, a duration, and a canonical
  provenance hash come back. Prints the B2 URLs and the manifest verify() result.

Usage:
    .venv/bin/python -m backend.scripts.smoke_real            # Part A always; Part B if keys
    .venv/bin/python -m backend.scripts.smoke_real --shape    # Part A only
"""
from __future__ import annotations

import sys


def _ok(msg: str) -> None:
    print(f"  \033[32mok\033[0m   {msg}")


def part_a_shape() -> None:
    """Assert the installed Genblaze API matches what genblaze_client.py assumes."""
    print("Part A — API shape (no keys)")
    import inspect

    from genblaze_core import Asset, Modality, Pipeline
    from genblaze_core.pipeline.result import PipelineResult
    from genblaze_core.providers.input_mapping import route_images
    from genblaze_s3 import S3StorageBackend

    # Pipeline.step accepts external_inputs + the params the client sends.
    step_sig = inspect.signature(Pipeline.step)
    assert "external_inputs" in step_sig.parameters, "Pipeline.step lost external_inputs"
    _ok("Pipeline.step(external_inputs=...) present")

    # PipelineResult carries .run and .manifest (client reads result.run.steps[-1] / .manifest).
    pr_params = inspect.signature(PipelineResult.__init__).parameters
    assert "run" in pr_params and "manifest" in pr_params, "PipelineResult(run, manifest) changed"
    _ok("PipelineResult(run, manifest)")

    # Modality members the client uses.
    for m in ("IMAGE", "VIDEO", "AUDIO"):
        assert hasattr(Modality, m), f"Modality.{m} missing"
    _ok("Modality.IMAGE/VIDEO/AUDIO")

    # Asset carries url + sha256 (client reads asset.url / asset.sha256).
    for f in ("url", "sha256", "media_type"):
        assert f in Asset.model_fields, f"Asset.{f} missing"
    _ok("Asset.url/.sha256/.media_type")

    # route_images pulls conditioning frames off Step.inputs, keyed by image/* MIME —
    # this is *why* the client must pass frames as external_inputs, not a params string.
    mapper = route_images(slots=("image",))
    routed = mapper([Asset(url="https://x/y.png", media_type="image/png")])
    assert routed == {"image": "https://x/y.png"}, f"route_images changed: {routed}"
    dropped = mapper([Asset(url="https://x/y.txt", media_type="text/plain")])
    assert dropped == {}, "route_images should ignore non-image inputs"
    _ok("route_images(slots=('image',)) routes Step.inputs, ignores non-images")

    # for_backblaze falls back to the B2_* env vars the app already sets.
    fb_doc = (S3StorageBackend.for_backblaze.__doc__ or "")
    assert "B2_KEY_ID" in fb_doc and "B2_APP_KEY" in fb_doc, "for_backblaze env fallback changed"
    _ok("S3StorageBackend.for_backblaze reads B2_* env vars")

    print("Part A: PASS\n")


def part_b_real() -> None:
    """One real still -> video -> B2 round-trip. Requires B2 + a generation key."""
    from backend.config import get_config
    from backend.pipeline import genblaze_client as gen

    cfg = get_config()
    if not cfg.ready_for_real():
        print("Part B — SKIPPED (no B2 + generation key; set them in backend/.env)")
        print("         needs: B2_KEY_ID, B2_APP_KEY, B2_BUCKET, and GMI_API_KEY or OPENAI_API_KEY")
        return
    if cfg.mock_media():
        print("Part B — SKIPPED (MOCK_MODE/MOCK_MEDIA still on; set MOCK_MEDIA=false to run real)")
        return

    print(f"Part B — real round-trip  (stack={cfg.PROVIDER_STACK}, bucket={cfg.B2_BUCKET})")

    img = gen.generate_image(
        "A wide establishing shot of a sunlit Lagos wedding hall, cinematic, 35mm.",
        seed="smoke", aspect_ratio="16:9",
    )
    assert img.url and img.url.startswith(("http://", "https://")), f"no durable image url: {img.url}"
    assert img.provenance.canonical_hash, "image provenance missing canonical_hash"
    _ok(f"image -> {img.url}")
    _ok(f"image provenance: hash={img.provenance.canonical_hash[:16]}… verified={img.provenance.verified}")

    clip = gen.image_to_video(
        img.url, "Slow push-in on the hall as guests settle. No slow motion.",
        duration=8, aspect_ratio="16:9", framing="wide shot", move="push-in",
    )
    assert clip.url and clip.url.startswith(("http://", "https://")), f"no durable clip url: {clip.url}"
    assert clip.duration_sec, "clip missing duration"
    _ok(f"video -> {clip.url}  ({clip.duration_sec}s)")
    _ok(f"video provenance: hash={(clip.provenance.canonical_hash or '')[:16]}… verified={clip.provenance.verified}")

    print("Part B: PASS")


def main() -> int:
    shape_only = "--shape" in sys.argv
    try:
        part_a_shape()
    except AssertionError as e:
        print(f"Part A: FAIL — {e}")
        return 1
    if shape_only:
        return 0
    try:
        part_b_real()
    except Exception as e:  # a real run can fail on creds/model-id/quota — surface it plainly
        print(f"Part B: FAIL — {type(e).__name__}: {e}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
